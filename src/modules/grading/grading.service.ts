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
export class GradingService {
  async gradeSession(sessionId: string) {
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

        if (language === 'cpp' || language === 'java') {
          wrappedCode = code; // No wrapper, reads from stdin
          try {
            const parsedArgs = JSON.parse(tc.input);
            if (Array.isArray(parsedArgs)) {
              stdinPayload = parsedArgs.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join('\n');
            } else {
              stdinPayload = String(parsedArgs);
            }
          } catch (e) {
            stdinPayload = String(tc.input);
          }
        } else {
          // Javascript and Python wrappers
          let fnName = 'solution';
          const pyMatch = code.match(/def\s+([a-zA-Z0-9_]+)\s*\(/);
          const jsMatch = code.match(/(?:function\s+([a-zA-Z0-9_]+)\s*\()|(?:(?:const|let|var)\s+([a-zA-Z0-9_]+)\s*=\s*(?:function|\(.*=>|.*=>))/);
          if (language === 'python' && pyMatch) {
            fnName = pyMatch[1];
          } else if (jsMatch) {
            fnName = jsMatch[1] || jsMatch[2] || 'solution';
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
      print("\\n---AGY_RESULT_DELIM---\\n" + (json.dumps(result) if isinstance(result, (dict, list, tuple)) else str(result).lower() if isinstance(result, bool) else str(result)), end='')
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
      process.stdout.write("\\n---AGY_RESULT_DELIM---\\n" + (typeof result === 'object' ? JSON.stringify(result) : String(result)));
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

        try {
          const response = await fetch('https://ce.judge0.com/submissions?wait=true', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              source_code: wrappedCode,
              language_id: langConfig.id,
              stdin: stdinPayload,
            }),
          });
          
          if (!response.ok) {
            stderr = await response.text();
          } else {
            const data = await response.json();
            stdout = data.stdout || '';
            const compileOutput = data.compile_output || '';
            stderr = data.stderr || compileOutput || data.message || '';
            isSuccess = data.status?.id === 3; // 3 = Accepted
          }
        } catch (e: any) {
          stderr = e.message || 'Execution failed';
        }

        let rawOutput = stdout.trim();
        let cleanOutput = rawOutput;
        if (rawOutput.includes('---AGY_RESULT_DELIM---')) {
           const parts = rawOutput.split('---AGY_RESULT_DELIM---');
           cleanOutput = parts[1].trim();
        }
        tcOutput = cleanOutput;
        globalOutput += stdout.trim() + '\n';
        
        if (stderr && !isSuccess) {
           tcError = stderr.trim();
           globalOutput += tcError + '\n';
        }

        const expectedClean = tc.expectedOutput.trim();
        const isMatch = cleanOutput === expectedClean || cleanOutput.includes(expectedClean);
        if (isSuccess && isMatch) {
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
