export const FLOAT_TOLERANCE = 1e-6;
/**
 * Shared Execution Engine
 *
 * This is the SINGLE authoritative implementation of code execution for the
 * averyselect platform. Both the candidate "Run Code" endpoint and the final
 * grading pipeline invoke this engine.
 *
 * Rules:
 *  - executionMode is ALWAYS sourced from Question.executionMode (DB).
 *  - functionContract is ALWAYS sourced from Question.functionContract (DB).
 *  - NO source-code inference (no solve/solution/main detection).
 *  - FULL_PROGRAM → raw TestCase.input piped as stdin, no wrapper.
 *  - FUNCTION      → JSON.parse(TestCase.input), spread as args, language wrapper.
 */

const JUDGE0_LANGUAGE_MAP: Record<string, { id: number; label: string }> = {
  javascript: { id: 97,  label: 'JavaScript (Node.js v20)' },
  python:     { id: 100, label: 'Python (v3.12)' },
  cpp:        { id: 105, label: 'C++ (GCC v14.1)' },
  java:       { id: 91,  label: 'Java (JDK v17)' },
  sql:        { id: 82,  label: 'SQL (SQLite 3)' },
};

/** Valid identifier guard — prevents code injection via functionName */
const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

const DELIM = '---AGY_RESULT_DELIM---';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FunctionParameter {
  name: string;
  type: string;
}

export interface FunctionContract {
  functionName: string;
  parameters: FunctionParameter[];
  returnType: string;
}

export interface EngineTestCase {
  id: string;
  input: string;
  expectedOutput: string;
  isHidden?: boolean;
}

export interface EngineInput {
  code: string;
  /** Lowercase language key: 'javascript' | 'python' | 'java' | 'cpp' */
  language: string;
  executionMode: 'FULL_PROGRAM' | 'FUNCTION';
  functionContract: FunctionContract | null;
  comparisonMode: 'EXACT' | 'TRIMMED' | 'TOKENIZED' | 'JSON' | 'FLOAT';
  testCases: EngineTestCase[];
}

export type TestCaseStatus =
  | 'PASSED'
  | 'FAILED'
  | 'CONFIGURATION_ERROR'
  | 'INVALID_CONTRACT'
  | 'INVALID_TEST_CASE'
  | 'COMPILE_ERROR'
  | 'RUNTIME_ERROR'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'MEMORY_LIMIT'
  | 'WRONG_ANSWER'
  | 'INTERNAL_ERROR';

export enum Judge0Status {
  IN_QUEUE = 1,
  PROCESSING = 2,
  ACCEPTED = 3,
  WRONG_ANSWER = 4,
  TIME_LIMIT_EXCEEDED = 5,
  COMPILATION_ERROR = 6,
  RUNTIME_ERROR_SIGSEGV = 7,
  RUNTIME_ERROR_SIGXFSZ = 8,
  RUNTIME_ERROR_SIGFPE = 9,
  RUNTIME_ERROR_SIGABRT = 10,
  RUNTIME_ERROR_NZEC = 11,
  RUNTIME_ERROR_OTHER = 12,
  INTERNAL_ERROR = 13,
  EXEC_FORMAT_ERROR = 14,
}

function mapJudge0Status(id: number | undefined): TestCaseStatus {
  switch (id) {
    case Judge0Status.ACCEPTED: return 'PASSED'; // Handled specially later
    case Judge0Status.WRONG_ANSWER: return 'WRONG_ANSWER';
    case Judge0Status.TIME_LIMIT_EXCEEDED: return 'TIMEOUT';
    case Judge0Status.COMPILATION_ERROR: return 'COMPILE_ERROR';
    case Judge0Status.RUNTIME_ERROR_SIGSEGV:
    case Judge0Status.RUNTIME_ERROR_SIGXFSZ:
    case Judge0Status.RUNTIME_ERROR_SIGFPE:
    case Judge0Status.RUNTIME_ERROR_SIGABRT:
    case Judge0Status.RUNTIME_ERROR_NZEC:
    case Judge0Status.RUNTIME_ERROR_OTHER:
      return 'RUNTIME_ERROR';
    case Judge0Status.INTERNAL_ERROR:
    case Judge0Status.EXEC_FORMAT_ERROR:
      return 'INTERNAL_ERROR';
    default:
      return 'INTERNAL_ERROR'; // Unknown status
  }
}


export interface TestCaseResult {
  testCaseId: string;
  passed: boolean;
  output: string | null;
  error: string | null;
  status: TestCaseStatus;
  executionTimeMs: number;
}

export interface EngineResult {
  status: 'PASSED' | 'FAILED' | 'ERROR';
  testCaseResults: TestCaseResult[];
  passCount: number;
  totalCount: number;
  output: string;
  executionTimeMs: number;
  fatalError?: string;
}

// ── Canonicalize ─────────────────────────────────────────────────────────────

function canonicalize(val: unknown): unknown {
  if (Array.isArray(val)) return val.map(canonicalize);
  if (val !== null && typeof val === 'object') {
    return Object.keys(val as object)
      .sort()
      .reduce((acc: Record<string, unknown>, key) => {
        acc[key] = canonicalize((val as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return val;
}

export function normalizeOutput(s: string): string {
  return s.replace(/\r\n/g, '\n').trim();
}

function normalizeStdinForFullProgram(input: string): string {
  return (input ?? '').trim();
}

// ── Judge0 caller ─────────────────────────────────────────────────────────────

interface Judge0Result {
  stdout: string;
  stderr: string;
  isAccepted: boolean;
  statusId: number | undefined;
  executionTimeMs: number;
}

async function callJudge0(
  langId: number,
  sourceCode: string,
  stdin: string,
  compilerOptions?: string
): Promise<Judge0Result> {
  let retries = 3;
  let delay = 1500;

  while (retries > 0) {
    try {
      const response = await fetch(
        'https://ce.judge0.com/submissions?wait=true&base64_encoded=true',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source_code: Buffer.from(sourceCode).toString('base64'),
            language_id: langId,
            stdin: Buffer.from(stdin).toString('base64'),
            ...(compilerOptions ? { compiler_options: compilerOptions } : {}),
          }),
        }
      );

      if (response.status === 429) {
        retries--;
        await new Promise(r => setTimeout(r, delay));
        delay *= 2;
        continue;
      }

      if (!response.ok) {
        const text = await response.text();
        return { stdout: '', stderr: text, isAccepted: false, statusId: undefined, executionTimeMs: 0 };
      }

      const data = await response.json();
      const decodeB64 = (v: string | null | undefined) =>
        v ? Buffer.from(v, 'base64').toString('utf8') : '';

      const stdout = decodeB64(data.stdout);
      const compileOutput = decodeB64(data.compile_output);
      const stderr = decodeB64(data.stderr) || compileOutput || data.message || '';
      const isAccepted = data.status?.id === 3;
      const executionTimeMs = Math.round((parseFloat(data.time) || 0) * 1000);

      return { stdout, stderr, isAccepted, statusId: data.status?.id, executionTimeMs };
    } catch (e: any) {
      retries--;
      if (retries === 0) {
        return { stdout: '', stderr: e?.message || 'Network error', isAccepted: false, statusId: undefined, executionTimeMs: 0 };
      }
      await new Promise(r => setTimeout(r, delay));
      delay *= 2;
    }
  }

  return { stdout: '', stderr: 'Max retries exceeded', isAccepted: false, statusId: undefined, executionTimeMs: 0 };
}

// ── Delimiter parser ──────────────────────────────────────────────────────────

interface ParsedOutput {
  consoleLogs: string;
  result: string;
}

function parseDelimitedOutput(rawStdout: string): ParsedOutput {
  const trimmed = rawStdout.trim();
  const idx = trimmed.lastIndexOf(DELIM);
  if (idx === -1) return { consoleLogs: trimmed, result: trimmed };
  return {
    consoleLogs: trimmed.substring(0, idx).trim(),
    result: trimmed.substring(idx + DELIM.length).trim(),
  };
}

// ── Wrapper generators ────────────────────────────────────────────────────────

function buildCppWrapper(code: string, fnName: string, inputArgs: unknown[]): string {
  const cppArgsList: string[] = [];
  for (const val of inputArgs) {
    if (Array.isArray(val)) {
      const toBraces = (arr: unknown[]): string =>
        '{' + arr.map(v => Array.isArray(v) ? toBraces(v as unknown[]) : typeof v === 'string' ? `std::string(${JSON.stringify(v)})` : String(v)).join(', ') + '}';
      cppArgsList.push(toBraces(val));
    } else if (typeof val === 'string') {
      cppArgsList.push(`std::string(${JSON.stringify(val)})`);
    } else if (typeof val === 'boolean') {
      cppArgsList.push(val ? 'true' : 'false');
    } else {
      cppArgsList.push(String(val));
    }
  }
  const cppArg = cppArgsList.join(', ');

  return `
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
inline void __print_res(const std::string& val) {
    std::cout << "\\"";
    for (char c : val) {
        switch (c) {
            case '"':  std::cout << "\\\\\\""; break;
            case '\\\\': std::cout << "\\\\\\\\"; break;
            case '\\b': std::cout << "\\\\b"; break;
            case '\\f': std::cout << "\\\\f"; break;
            case '\\n': std::cout << "\\\\n"; break;
            case '\\r': std::cout << "\\\\r"; break;
            case '\\t': std::cout << "\\\\t"; break;
            default:
                if ('\\x00' <= c && c <= '\\x1f') {
                    std::cout << "\\\\u00";
                    int num = c;
                    if (num < 16) std::cout << "0";
                    std::cout << std::hex << num << std::dec;
                } else { std::cout << c; }
        }
    }
    std::cout << "\\"";
}
inline void __print_res(char val) { __print_res(std::string(1, val)); }
template<typename T> void __print_res(const std::vector<T>& vec) {
    std::cout << "[";
    for (size_t i = 0; i < vec.size(); ++i) {
        __print_res(vec[i]);
        if (i + 1 < vec.size()) std::cout << ",";
    }
    std::cout << "]";
}

int main() {
    try {
        auto res = ${fnName}(${cppArg});
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

function buildJavaWrapper(
  code: string,
  fnName: string,
  parameters: FunctionParameter[],
  inputArgs: unknown[]
): string {
  const javaArgsList: string[] = [];
  for (let i = 0; i < inputArgs.length; i++) {
    const type = parameters[i].type;
    const val = inputArgs[i];
    if (Array.isArray(val)) {
      const toJavaBraces = (arr: unknown[]): string =>
        '{' + arr.map(v => Array.isArray(v) ? toJavaBraces(v as unknown[]) : typeof v === 'string' ? JSON.stringify(v) : String(v)).join(', ') + '}';
      let javaType = type;
      if (type.toLowerCase().startsWith('string')) javaType = type.replace(/string/i, 'String');
      javaArgsList.push(`new ${javaType}${toJavaBraces(val)}`);
    } else if (typeof val === 'string') {
      javaArgsList.push(JSON.stringify(val));
    } else {
      javaArgsList.push(String(val));
    }
  }
  const javaArg = javaArgsList.join(', ');

  const sanitizedCode = code.replace(
    /\bpublic\s+(?:final\s+|abstract\s+)?class\s+(Solution)\b/g,
    'class $1'
  );
  const className = 'Solution';
  const isStatic = new RegExp(`static\\s+[\\w<>\\[\\],]+\\s+${fnName}\\s*\\(`).test(sanitizedCode);
  const callExpr = isStatic
    ? `${className}.${fnName}(${javaArg})`
    : `new ${className}().${fnName}(${javaArg})`;

  return `
import java.util.*;
import java.io.*;

${sanitizedCode}

public class Main {
    public static void main(String[] args) {
        try {
            Object res = ${callExpr};
            System.out.println("\\n---AGY_RESULT_DELIM---\\n" + toJson(res));
        } catch (Exception e) {
            e.printStackTrace();
            System.exit(1);
        }
    }

    private static String toJson(Object o) {
        if (o == null) return "null";
        if (o instanceof String) {
            String s = (String) o;
            s = s.replace("\\\\", "\\\\\\\\")
                 .replace("\\"", "\\\\\\"")
                 .replace("\\b", "\\\\b")
                 .replace("\\f", "\\\\f")
                 .replace("\\n", "\\\\n")
                 .replace("\\r", "\\\\r")
                 .replace("\\t", "\\\\t");
            return "\\"" + s + "\\"";
        }
        if (o instanceof Number || o instanceof Boolean) return String.valueOf(o);
        if (o instanceof Character) return toJson(String.valueOf(o));
        if (o.getClass().isArray()) {
            StringBuilder sb = new StringBuilder();
            sb.append("[");
            int length = java.lang.reflect.Array.getLength(o);
            for (int i = 0; i < length; i++) {
                sb.append(toJson(java.lang.reflect.Array.get(o, i)));
                if (i < length - 1) sb.append(",");
            }
            sb.append("]");
            return sb.toString();
        }
        return "\\"" + o.toString() + "\\"";
    }
}
`;
}

function buildPythonWrapper(code: string, fnName: string, inputArgs: unknown[]): string {
  // JSON.stringify then escape for safe embedding inside a single-quoted Python string
  const argsJson = JSON.stringify(inputArgs)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'");

  return `
${code}
import sys
import json
fn_name = '${fnName}'
fn = locals().get(fn_name)

if not fn or not callable(fn):
    raise RuntimeError(
        f'Configured function "{fn_name}" is not defined or is not callable.'
    )

args = json.loads('${argsJson}')
result = fn(*args)

print("\\n---AGY_RESULT_DELIM---\\n" + json.dumps(result), end='')
`;
}

function buildJsWrapper(code: string, fnName: string, inputArgs: unknown[]): string {
  const jsArgs = JSON.stringify(inputArgs);

  return `
${code}
{
  // functionContract.functionName is authoritative — never use module.exports to override it.
  if (typeof ${fnName} !== 'function') {
    throw new ReferenceError('Configured function "' + '${fnName}' + '" is not defined or is not callable.');
  }
  const __fn = ${fnName};
  let args = ${jsArgs};
  const result = __fn(...args);
  if (result !== undefined) {
    process.stdout.write("\\n---AGY_RESULT_DELIM---\\n" + JSON.stringify(result, (k, v) => typeof v === 'bigint' ? v.toString() : v));
  }
}
`;
}

// ── Engine ────────────────────────────────────────────────────────────────────


export function compareOutput(mode: 'EXACT' | 'TRIMMED' | 'TOKENIZED' | 'JSON' | 'FLOAT', expected: string, actual: string): boolean {
  const normExpected = expected.replace(/\r\n/g, '\n');
  const normActual = actual.replace(/\r\n/g, '\n');

  switch (mode) {
    case 'EXACT': {
      return normExpected === normActual;
    }
    case 'TRIMMED': {
      // Try JSON comparison first: if both sides parse as valid JSON,
      // compare the parsed structures (key-order-independent for objects,
      // order-preserved for arrays). This prevents whitespace-only differences
      // (e.g. [[70,30]] vs [[70, 30]]) from incorrectly failing.
      const trimmedExp = normExpected.trim();
      const trimmedAct = normActual.trim();
      try {
        const expObj = JSON.parse(trimmedExp);
        const actObj = JSON.parse(trimmedAct);
        return JSON.stringify(canonicalize(expObj)) === JSON.stringify(canonicalize(actObj));
      } catch {
        // Either side is not valid JSON — fall back to trimmed string comparison
        return trimmedExp === trimmedAct;
      }
    }
    case 'TOKENIZED': {
      const tokenize = (s: string) => s.trim().split(/\s+/).filter(Boolean);
      const expTokens = tokenize(normExpected);
      const actTokens = tokenize(normActual);
      return expTokens.length === actTokens.length && expTokens.every((t, i) => t === actTokens[i]);
    }
    case 'JSON': {
      try {
        const expObj = JSON.parse(expected);
        const actObj = JSON.parse(actual);
        return JSON.stringify(canonicalize(expObj)) === JSON.stringify(canonicalize(actObj));
      } catch {
        return false;
      }
    }
    case 'FLOAT': {
      const floatsMatch = (exp: unknown, act: unknown): boolean => {
        if (typeof exp === 'number' && typeof act === 'number') {
          return Number.isFinite(exp) && Number.isFinite(act) && Math.abs(exp - act) <= FLOAT_TOLERANCE;
        }
        if (Array.isArray(exp) && Array.isArray(act)) {
          if (exp.length !== act.length) return false;
          // MVP: Reject nested arrays
          if (exp.some(e => Array.isArray(e)) || act.some(a => Array.isArray(a))) return false;
          return exp.every((e, i) => floatsMatch(e, act[i]));
        }
        return false;
      };

      try {
        const expObj = JSON.parse(expected);
        const actObj = JSON.parse(actual);
        return floatsMatch(expObj, actObj);
      } catch {
        return false;
      }
    }
    default:
      return false;
  }
}

export class ExecutionEngine {
  async execute(input: EngineInput): Promise<EngineResult> {
    const { code, executionMode, functionContract, testCases } = input;
    const language = input.language.toLowerCase();
    const langConfig = JUDGE0_LANGUAGE_MAP[language];
    if (!langConfig) {
      return this.fatalResult(input.testCases, `CONFIGURATION_ERROR: Unsupported language '${language}'.`);
    }
    const compilerOptions = langConfig.id === 105 ? '-std=c++20 -O2' : undefined;

    // 1. Validate executionMode
    if (executionMode !== 'FULL_PROGRAM' && executionMode !== 'FUNCTION') {
      return this.fatalResult(testCases, `CONFIGURATION_ERROR: Invalid executionMode '${executionMode}'.`);
    }

    // 2. Defensive Contract Validation
    let fnName = '';
    let parameters: FunctionParameter[] = [];
    const VALID_TYPES = new Set(['int', 'double', 'boolean', 'string', 'int[]', 'double[]', 'boolean[]', 'string[]']);

    if (executionMode === 'FULL_PROGRAM') {
      if (functionContract !== null && functionContract !== undefined) {
        return this.fatalResult(testCases, 'CONFIGURATION_ERROR: FULL_PROGRAM must not have a functionContract.');
      }
    } else if (executionMode === 'FUNCTION') {
      if (!functionContract || typeof functionContract !== 'object' || Array.isArray(functionContract)) {
        return this.fatalResult(testCases, 'CONFIGURATION_ERROR: functionContract must be a valid object.');
      }
      
      const { functionName, parameters: params, returnType, ...extra } = functionContract as any;

      if (Object.keys(extra).length > 0) {
        return this.fatalResult(testCases, 'CONFIGURATION_ERROR: Unexpected keys in functionContract.');
      }

      if (!functionName || typeof functionName !== 'string' || !IDENTIFIER_RE.test(functionName)) {
        return this.fatalResult(testCases, "CONFIGURATION_ERROR: Invalid or missing 'functionName'.");
      }

      if (!returnType || typeof returnType !== 'string' || !VALID_TYPES.has(returnType)) {
        return this.fatalResult(testCases, "CONFIGURATION_ERROR: Invalid or missing 'returnType'.");
      }

      if (!Array.isArray(params)) {
        return this.fatalResult(testCases, "CONFIGURATION_ERROR: 'parameters' must be an array.");
      }

      const paramNames = new Set<string>();
      for (const p of params) {
        if (!p || typeof p !== 'object' || Array.isArray(p)) {
          return this.fatalResult(testCases, "CONFIGURATION_ERROR: Malformed parameter object.");
        }
        
        const pKeys = Object.keys(p);
        if (pKeys.length !== 2 || !pKeys.includes('name') || !pKeys.includes('type')) {
          return this.fatalResult(testCases, "CONFIGURATION_ERROR: Parameter object must only contain 'name' and 'type'.");
        }

        if (!p.name || typeof p.name !== 'string' || !IDENTIFIER_RE.test(p.name)) {
          return this.fatalResult(testCases, "CONFIGURATION_ERROR: Invalid parameter name.");
        }
        if (paramNames.has(p.name)) {
          return this.fatalResult(testCases, `CONFIGURATION_ERROR: Duplicate parameter name '${p.name}'.`);
        }
        paramNames.add(p.name);
        
        if (!p.type || typeof p.type !== 'string' || !VALID_TYPES.has(p.type)) {
          return this.fatalResult(testCases, `CONFIGURATION_ERROR: Invalid parameter type for '${p.name}'.`);
        }
      }

      fnName = functionName;
      parameters = params;
    }

    // 3. Execute test cases
    const testCaseResults: TestCaseResult[] = [];
    let passCount = 0;
    let globalOutput = '';
    let globalTimeMs = 0;

    for (const tc of testCases) {
      let sourceCode = '';
      let stdin = '';
      let inputArgs: unknown[] | null = null;

      if (executionMode === 'FULL_PROGRAM') {
        sourceCode = code;
        stdin = normalizeStdinForFullProgram(tc.input);
      } else {
        // Parse FUNCTION args
        try {
          const parsed = JSON.parse(tc.input ?? '');
          if (!Array.isArray(parsed)) throw new Error('Not an array');
          inputArgs = parsed;
        } catch {
          testCaseResults.push({
            testCaseId: tc.id, passed: false, output: null,
            error: 'INVALID_TEST_CASE: TestCase.input must be a JSON array.',
            status: 'INVALID_TEST_CASE', executionTimeMs: 0,
          });
          continue;
        }

        if (inputArgs.length !== parameters.length) {
          testCaseResults.push({
            testCaseId: tc.id, passed: false, output: null,
            error: `INVALID_CONTRACT: expected ${parameters.length} arguments, got ${inputArgs.length}.`,
            status: 'INVALID_CONTRACT', executionTimeMs: 0,
          });
          continue;
        }

        if (language === 'cpp') sourceCode = buildCppWrapper(code, fnName, inputArgs);
        else if (language === 'java') sourceCode = buildJavaWrapper(code, fnName, parameters, inputArgs);
        else if (language === 'python') sourceCode = buildPythonWrapper(code, fnName, inputArgs);
        else sourceCode = buildJsWrapper(code, fnName, inputArgs);
      }

      // 4. Call Judge0
      const j0 = await callJudge0(langConfig.id, sourceCode, stdin, compilerOptions);
      globalTimeMs += j0.executionTimeMs;

      // 5. Check execution status FIRST (Authoritative)
      if (j0.statusId === undefined) {
        // Provider or network failure
        const errText = j0.stderr.trim() || 'Internal execution provider error';
        globalOutput += errText + '\n';
        testCaseResults.push({
          testCaseId: tc.id, passed: false, output: null,
          error: errText, status: 'NETWORK_ERROR', executionTimeMs: j0.executionTimeMs,
        });
        continue;
      }

      if (j0.statusId !== Judge0Status.ACCEPTED) {
        // Execution failed (TLE, MLE, RE, CE, etc.)
        const errText = j0.stderr.trim() || j0.stdout.trim();
        globalOutput += errText + '\n';
        testCaseResults.push({
          testCaseId: tc.id, passed: false, output: null,
          error: errText, status: mapJudge0Status(j0.statusId), executionTimeMs: j0.executionTimeMs,
        });
        continue;
      }

      // 6. Execution succeeded, NOW parse output and compare
      const { result: cleanResult } = parseDelimitedOutput(j0.stdout);
      globalOutput += j0.stdout.trim() + '\n';

      const isMatch = compareOutput(input.comparisonMode, tc.expectedOutput, cleanResult);

      if (isMatch) passCount++;

      testCaseResults.push({
        testCaseId: tc.id,
        passed: isMatch,
        output: cleanResult,
        error: null,
        status: isMatch ? 'PASSED' : 'WRONG_ANSWER',
        executionTimeMs: j0.executionTimeMs,
      });
    }

    const allPassed = passCount === testCases.length && testCases.length > 0;
    return {
      status: allPassed ? 'PASSED' : 'FAILED',
      testCaseResults,
      passCount,
      totalCount: testCases.length,
      output: globalOutput.trim(),
      executionTimeMs: Math.round(globalTimeMs),
    };
  }

  private fatalResult(testCases: EngineTestCase[], message: string): EngineResult {
    return {
      status: 'ERROR',
      testCaseResults: testCases.map(tc => ({
        testCaseId: tc.id, passed: false, output: null,
        error: message, status: 'CONFIGURATION_ERROR' as TestCaseStatus, executionTimeMs: 0,
      })),
      passCount: 0,
      totalCount: testCases.length,
      output: message,
      executionTimeMs: 0,
      fatalError: message,
    };
  }
}

export const executionEngine = new ExecutionEngine();
