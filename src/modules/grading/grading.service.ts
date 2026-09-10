import vm from 'node:vm';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { gradingRepository } from './grading.repository.js';
import { QuestionType, ExecutionStatus } from '@prisma/client';

const execFileAsync = promisify(execFile);

/**
 * Converts test case input JSON into competitive-programming style stdin for C++/Java.
 * Arrays → first line: count, second line: space-separated (numbers) or one-per-line (strings).
 * Strings → plain value (no quotes). Scalars → string form. Raw text → pass-through.
 */
function normalizeStdinForNative(input: string): string {
  const raw = (input ?? '').trim();
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const count = parsed.length;
      const isStringArray = parsed.every((x: any) => typeof x === 'string');
      if (isStringArray) {
        return `${count}\n${parsed.join('\n')}`;
      } else {
        return `${count}\n${parsed.join(' ')}`;
      }
    } else if (typeof parsed === 'string') {
      return parsed;
    } else {
      return String(parsed);
    }
  } catch {
    return raw;
  }
}

export class GradingService {
  // Simple in-memory queue to prevent Judge0 rate limit exhaustion
  private static gradingQueue: string[] = [];
  private static isGrading = false;

  async gradeSession(sessionId: string) {
    GradingService.gradingQueue.push(sessionId);
    this.processQueue();
  }

  private async processQueue() {
    if (GradingService.isGrading || GradingService.gradingQueue.length === 0) return;
    GradingService.isGrading = true;

    while (GradingService.gradingQueue.length > 0) {
      const sessionId = GradingService.gradingQueue.shift();
      if (sessionId) {
        try {
          await this.executeGrading(sessionId);
        } catch (e) {
          console.error(`Error grading session ${sessionId}:`, e);
        }
        // Add a 2-second cooldown between grading candidates to let Judge0 breathe
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    GradingService.isGrading = false;
  }

  async executeGrading(sessionId: string) {
    try {
      const data = await gradingRepository.getUnscoredSessionData(sessionId);
      if (!data) return;
      if (data.status !== 'COMPLETED') return;

      const result = await gradingRepository.createResult(sessionId);
      
      let totalScore = 0;
      let maxScore = 0;

      // Iterate through attempts and evaluate
      for (const attempt of data.attempts) {
        const question = attempt.question;
        const qMaxScore = question.points || 10; // Use actual question points instead of hardcoded 10
        maxScore += qMaxScore;

        let qScore = 0;
        let isCorrect = false;

        if (question.type === QuestionType.MULTIPLE_CHOICE) {
          const selectedOption = question.options.find(opt => opt.id === (attempt.answer || ''));
          if (selectedOption && selectedOption.isCorrect) {
            isCorrect = true;
            qScore = qMaxScore;
          }
          await gradingRepository.createQuestionResult(result.id, question.id, qScore, qMaxScore, isCorrect);
        } 
        else if (question.type === QuestionType.CODING) {
          // Execution logic
          const executionResult = await this.executeCode(attempt.answer || '', attempt.language || 'javascript', question.testCases);
          
          await gradingRepository.createExecution(
            attempt.id,
            attempt.language || 'javascript',
            attempt.answer || '',
            executionResult.status,
            executionResult.output,
            executionResult.testCaseResults,
            executionResult.executionTimeMs
          );

          if (executionResult.status === ExecutionStatus.PASSED) {
            // For MVP, all test cases must pass to get points.
            isCorrect = true;
            qScore = qMaxScore;
          } else if (executionResult.status === ExecutionStatus.FAILED && executionResult.passCount > 0) {
             // Partial credit MVP: 
             qScore = Math.round((executionResult.passCount / question.testCases.length) * qMaxScore);
          }

          await gradingRepository.createQuestionResult(result.id, question.id, qScore, qMaxScore, isCorrect);
        }

        totalScore += qScore;
      }

      await gradingRepository.finalizeResult(result.id, totalScore, maxScore);

    } catch (error) {
      console.error('Error during auto-grading:', error);
    }
  }

  private async executeCode(code: string, language: string, testCases: any[]) {
    let globalOutput = '';
    let passCount = 0;
    let globalExecutionTimeMs = 0;
    const testCaseResults = [];
    
    const JUDGE0_LANGUAGE_MAP: Record<string, { id: number; label: string }> = {
      javascript: { id: 97,  label: 'JavaScript (Node.js v20)' },
      python:     { id: 100, label: 'Python (v3.12)' },
      cpp:        { id: 105, label: 'C++ (GCC v14.1)' },
      java:       { id: 91,  label: 'Java (JDK v17)' },
      sql:        { id: 82,  label: 'SQL (SQLite 3)' },
    };

    const langConfig = JUDGE0_LANGUAGE_MAP[language] || JUDGE0_LANGUAGE_MAP.javascript;

    try {
      for (const tc of testCases) {
        let tcPassed = false;
        let tcOutput = null;
        let tcError = null;
        let wrappedCode = '';
        let stdinPayload = '';

        if (language === 'cpp') {
          const hasMain = /\b(?:int|void|auto)\s+main\s*\(/.test(code);
          if (hasMain) {
            wrappedCode = code;
            stdinPayload = normalizeStdinForNative(tc.input);
          } else {
            let cppFn = 'solution';
            if (/\b(?:solution)\s*\(/.test(code)) {
              cppFn = 'solution';
            } else if (/\b(?:solve)\s*\(/.test(code)) {
              cppFn = 'solve';
            } else {
              const cppMatch = code.match(/(?:[\w:<>*&]+)\s+([a-zA-Z0-9_]+)\s*\([^)]*\)\s*\{/);
              if (cppMatch && !['if', 'while', 'for', 'switch', 'catch', 'main'].includes(cppMatch[1])) {
                cppFn = cppMatch[1];
              }
            }

            let cppArg = '';
            if (tc.input) {
              let trimmed = tc.input.trim();
              if (trimmed.endsWith(';')) trimmed = trimmed.slice(0, -1).trim();
              const solveMatch = trimmed.match(/^solve\((.*)\)$/);
              if (solveMatch) trimmed = solveMatch[1].trim();

              if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
                cppArg = trimmed.replace(/\[/g, '{').replace(/\]/g, '}');
              } else {
                cppArg = trimmed;
              }
            }

            wrappedCode = `
#include <iostream>
#include <vector>
#include <string>
#include <algorithm>
#include <map>
#include <unordered_map>
#include <set>
#include <unordered_set>

${code}

template<typename T> void __print_res(const T& val) { std::cout << val; }
inline void __print_res(bool val) { std::cout << (val ? "true" : "false"); }
inline void __print_res(char val) { std::cout << "\\"" << val << "\\""; }
inline void __print_res(const std::string& val) { std::cout << "\\"" << val << "\\""; }
template<typename T> void __print_res(const std::vector<T>& vec) {
    std::cout << "[";
    for (size_t i = 0; i < vec.size(); ++i) {
        __print_res(vec[i]);
        if (i + 1 < vec.size()) std::cout << ", ";
    }
    std::cout << "]";
}

int main() {
    try {
        auto res = ${cppFn}(${cppArg});
        std::cout << "\\n---AGY_RESULT_DELIM---\\n";
        __print_res(res);
        std::cout << std::endl;
    } catch (const std::exception& e) {
        std::cerr << e.what() << std::endl;
        return 1;
    } catch (...) {
        std::cerr << "Runtime error" << std::endl;
        return 1;
    }
    return 0;
}
`;
          }
        } else if (language === 'java') {
          const hasMain = /\bpublic\s+static\s+void\s+main\s*\(/.test(code) || /\bvoid\s+main\s*\(/.test(code);
          if (hasMain) {
            wrappedCode = code;
            stdinPayload = normalizeStdinForNative(tc.input);
          } else {
            let javaArg = '';
            if (tc.input) {
              let trimmed = tc.input.trim();
              if (trimmed.endsWith(';')) trimmed = trimmed.slice(0, -1).trim();
              const solveMatch = trimmed.match(/^solve\((.*)\)$/);
              if (solveMatch) trimmed = solveMatch[1].trim();

              if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
                try {
                  const parsed = JSON.parse(trimmed);
                  if (parsed.every((x: any) => typeof x === 'number')) {
                    javaArg = `new int[]{${parsed.join(', ')}}`;
                  } else if (parsed.every((x: any) => typeof x === 'string')) {
                    javaArg = `new String[]{${parsed.map((s: any) => JSON.stringify(s)).join(', ')}}`;
                  } else {
                    javaArg = `new Object[]{${parsed.map((x: any) => JSON.stringify(x)).join(', ')}}`;
                  }
                } catch {
                  javaArg = `new int[]{${trimmed.slice(1, -1)}}`;
                }
              } else {
                javaArg = trimmed;
              }
            }

            let sanitizedCode = code.replace(/public\s+class\s+([A-Za-z0-9_]+)/g, 'class $1');
            let className = 'Solution';
            const classMatch = sanitizedCode.match(/class\s+([A-Za-z0-9_]+)/);
            if (classMatch) className = classMatch[1];

            let javaFn = 'solution';
            if (/\b(?:solution)\s*\(/.test(sanitizedCode)) {
              javaFn = 'solution';
            } else if (/\b(?:solve)\s*\(/.test(sanitizedCode)) {
              javaFn = 'solve';
            } else {
              const methodMatch = sanitizedCode.match(/(?:public|static|final|[\w<>\[\],]+)\s+([a-zA-Z0-9_]+)\s*\([^)]*\)\s*\{/);
              if (methodMatch && !['if', 'while', 'for', 'switch', 'catch', 'main', className].includes(methodMatch[1])) {
                javaFn = methodMatch[1];
              }
            }

            const isStatic = new RegExp(`static\\s+[\\w<>\[\\],]+\\s+${javaFn}\\s*\\(`).test(sanitizedCode);
            const callExpr = isStatic ? `${className}.${javaFn}(${javaArg})` : `new ${className}().${javaFn}(${javaArg})`;

            wrappedCode = `
import java.util.*;
import java.io.*;

${sanitizedCode}

public class Main {
    public static void main(String[] args) {
        try {
            Object res = ${callExpr};
            String output;
            if (res instanceof int[]) {
                output = Arrays.toString((int[]) res);
            } else if (res instanceof Object[]) {
                output = Arrays.deepToString((Object[]) res);
            } else {
                output = String.valueOf(res);
            }
            System.out.println("\\n---AGY_RESULT_DELIM---\\n" + output);
        } catch (Exception e) {
            e.printStackTrace();
            System.exit(1);
        }
    }
}
`;
          }
        } else {
          // Javascript and Python wrappers
          let fnName = 'solution';
          if (language === 'python') {
            if (/\bdef\s+solution\s*\(/.test(code)) {
              fnName = 'solution';
            } else if (/\bdef\s+solve\s*\(/.test(code)) {
              fnName = 'solve';
            } else {
              const pyMatch = code.match(/def\s+([a-zA-Z0-9_]+)\s*\(/);
              if (pyMatch) fnName = pyMatch[1];
            }
          } else {
            if (/\b(?:function\s+solution\s*\(|(?:const|let|var)\s+solution\s*=)/.test(code)) {
              fnName = 'solution';
            } else if (/\b(?:function\s+solve\s*\(|(?:const|let|var)\s+solve\s*=)/.test(code)) {
              fnName = 'solve';
            } else {
              const jsMatch = code.match(/(?:function\s+([a-zA-Z0-9_]+)\s*\()|(?:(?:const|let|var)\s+([a-zA-Z0-9_]+)\s*=\s*(?:function|\(.*=>|.*=>))/);
              if (jsMatch) fnName = jsMatch[1] || jsMatch[2] || 'solution';
            }
          }

          if (language === 'python') {
            wrappedCode = `
${code}
import sys
import json
try:
  fn_name = '${fnName}'
  fn = locals().get(fn_name)
  if fn and callable(fn):
      args = (${tc.input},)
      result = fn(*args)
      print("\\n---AGY_RESULT_DELIM---\\n" + json.dumps(result), end='')
  else:
      pass
except Exception as e:
  print(e)
`;
          } else {
            wrappedCode = `
${code}
try {
  let __fn = null;
  if (typeof module !== 'undefined' && typeof module.exports === 'function') {
    __fn = module.exports;
  } else if (typeof ${fnName} === 'function') {
    __fn = ${fnName};
  }
  
  if (__fn) {
    let args = [ ${tc.input} ];
    const result = __fn(...args);
    if (result !== undefined) {
      process.stdout.write("\\n---AGY_RESULT_DELIM---\\n" + JSON.stringify(result));
    }
  } else {
    // If no function, assume they are just printing or we gracefully ignore
  }
} catch (e) {
  process.stdout.write(e.toString());
}
`;
          }
        }

        let tcStart = performance.now();
        let stdout = '';
        let stderr = '';
        let isSuccess = false;

        let retries = 3;
        let delay = 1500;
        while (retries > 0) {
          try {
            const response = await fetch('https://ce.judge0.com/submissions?wait=true&base64_encoded=true', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                source_code: Buffer.from(wrappedCode).toString('base64'),
                language_id: langConfig.id,
                stdin: Buffer.from(stdinPayload).toString('base64'),
              }),
            });
            
            if (response.status === 429) {
                retries--;
                await new Promise(r => setTimeout(r, delay));
                delay *= 2;
                continue;
            }
            
            if (!response.ok) {
              stderr = await response.text();
            } else {
              const data = await response.json();
              const decodeB64 = (val: string | null | undefined) => val ? Buffer.from(val, 'base64').toString('utf8') : '';
              stdout = decodeB64(data.stdout);
              const compileOutput = decodeB64(data.compile_output);
              stderr = decodeB64(data.stderr) || compileOutput || data.message || '';
              isSuccess = data.status?.id === 3; // 3 = Accepted
            }
            break;
          } catch (e: any) {
            retries--;
            if (retries === 0) {
                stderr = e.message || 'Execution failed';
            } else {
                await new Promise(r => setTimeout(r, delay));
                delay *= 2;
            }
          }
        }

        let rawOutput = stdout.trim();
        let cleanOutput = rawOutput;
        if (rawOutput.includes('---AGY_RESULT_DELIM---')) {
           const parts = rawOutput.split('---AGY_RESULT_DELIM---');
           cleanOutput = parts[1].trim();
        }
        tcOutput = cleanOutput;
        globalOutput += stdout.trim() + '\n';
        
        // Hard error = runtime/compile error (status != Accepted AND != Wrong Answer)
        // JVM/compiler warnings in stderr are OK as long as code ran (isSuccess or at least produced output)
        const hasHardError = !isSuccess && !cleanOutput;
        if (stderr && hasHardError) {
           tcError = stderr.trim();
           globalOutput += tcError + '\n';
        }

        const normalizeOut = (s: string) => s.trim().split('\n').map(l => l.trim()).filter(l => l !== '').join('\n');
        const expectedClean = normalizeOut(tc.expectedOutput);
        const actualClean = normalizeOut(cleanOutput);
        let isMatch = false;
        
        let expectedObj, actualObj;
        try { expectedObj = JSON.parse(expectedClean); } catch(e) { expectedObj = expectedClean; }
        try { actualObj = JSON.parse(actualClean); } catch(e) { actualObj = actualClean; }
        
        isMatch = JSON.stringify(expectedObj) === JSON.stringify(actualObj);

        // Pass if output matches and no hard error (ignore stderr warnings for C++/Java)
        if (isMatch && !hasHardError) {
          tcPassed = true;
          passCount++;
        }

        let tcEnd = performance.now();
        globalExecutionTimeMs += (tcEnd - tcStart);

        testCaseResults.push({
          testCaseId: tc.id,
          passed: tcPassed,
          output: tcOutput,
          error: tcError
        });
      }

      const status = passCount === testCases.length ? ExecutionStatus.PASSED : ExecutionStatus.FAILED;

      return {
        status,
        output: globalOutput.trim(),
        testCaseResults,
        passCount,
        executionTimeMs: Math.round(globalExecutionTimeMs)
      };

    } catch (e: any) {
      console.error('Execution error', e);
      return {
        status: ExecutionStatus.ERROR,
        output: e.message,
        testCaseResults: [],
        passCount: 0,
        executionTimeMs: 0
      };
    }
  }
}

export const gradingService = new GradingService();
