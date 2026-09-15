import { executionEngine, EngineInput } from '../modules/execution/execution.engine.js';
import { prisma } from '../lib/prisma.js';

function assert(desc: string, condition: boolean, msg?: string) {
  if (!condition) {
    console.error(`[FAIL] ${desc} ${msg ? '- ' + msg : ''}`);
    process.exit(1);
  } else {
    console.log(`  [PASS] ${desc}`);
  }
}

async function runTest(desc: string, code: string, expectedStatus: string) {
  const fullInput: EngineInput = {
    code,
    language: 'python',
    executionMode: 'FUNCTION',
    functionContract: {
      functionName: 'solve',
      returnType: 'int',
      parameters: [{ name: 'a', type: 'int' }]
    },
    comparisonMode: 'TRIMMED',
    testCases: [{
      id: 'tc1',
      input: '[10]',
      expectedOutput: '10'
    }]
  };
  
  const result = await executionEngine.execute(fullInput);
  
  assert(desc, result.testCaseResults[0].status === expectedStatus, `Expected ${expectedStatus}, got ${result.testCaseResults[0].status}. Error: ${result.testCaseResults[0].error}`);
}

async function runArrayTest(desc: string, code: string, expectedStatus: string) {
  const fullInput: EngineInput = {
    code,
    language: 'python',
    executionMode: 'FUNCTION',
    functionContract: {
      functionName: 'solve',
      returnType: 'int[]',
      parameters: [{ name: 'a', type: 'int' }]
    },
    comparisonMode: 'JSON',
    testCases: [{
      id: 'tc1',
      input: '[10]',
      expectedOutput: '[10]'
    }]
  };
  
  const result = await executionEngine.execute(fullInput);
  assert(desc, result.testCaseResults[0].status === expectedStatus, `Expected ${expectedStatus}, got ${result.testCaseResults[0].status}`);
}

async function main() {
  console.log("=== Python Runtime Error Tests ===");

  await runTest(
    "1. Python FUNCTION returns integer -> PASSED",
    "def solve(a):\n    return a",
    "PASSED"
  );

  await runArrayTest(
    "2. Python FUNCTION returns array -> PASSED",
    "def solve(a):\n    return [a]",
    "PASSED"
  );

  await runTest(
    "3. Python FUNCTION raises ValueError -> RUNTIME_ERROR",
    "def solve(a):\n    raise ValueError('something went wrong')",
    "RUNTIME_ERROR"
  );

  await runTest(
    "4. Python FUNCTION raises ZeroDivisionError -> RUNTIME_ERROR",
    "def solve(a):\n    return a / 0",
    "RUNTIME_ERROR"
  );

  await runTest(
    "5. Python FUNCTION raises TypeError -> RUNTIME_ERROR",
    "def solve(a):\n    return a + 'string'",
    "RUNTIME_ERROR"
  );

  console.log("\n=== All Python runtime error tests passed ===");
}

main().catch(console.error);
