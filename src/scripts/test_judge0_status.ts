import { executionEngine, Judge0Status, EngineInput } from '../modules/execution/execution.engine.js';

// Simple assert helper
function assert(desc: string, condition: boolean, msg?: string) {
  if (!condition) {
    console.error(`[FAIL] ${desc} ${msg ? '- ' + msg : ''}`);
    process.exit(1);
  } else {
    console.log(`  [PASS] ${desc}`);
  }
}

// Mock fetch to intercept Judge0 calls
const originalFetch = globalThis.fetch;

let mockStatusId: number | undefined = undefined;
let mockStdout: string = '';
let mockStderr: string = '';
let mockCompileOutput: string = '';
let mockNetworkFail: boolean = false;

globalThis.fetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
  if (url.toString().includes('judge0.com/submissions')) {
    if (mockNetworkFail) {
      throw new Error("Simulated network failure");
    }
    
    // Simulate Judge0 response
    const data = {
      stdout: mockStdout ? Buffer.from(mockStdout).toString('base64') : null,
      stderr: mockStderr ? Buffer.from(mockStderr).toString('base64') : null,
      compile_output: mockCompileOutput ? Buffer.from(mockCompileOutput).toString('base64') : null,
      status: mockStatusId !== undefined ? { id: mockStatusId } : null,
      time: "0.1"
    };

    return {
      ok: true,
      status: 200,
      json: async () => data,
      text: async () => JSON.stringify(data),
    } as any;
  }
  return originalFetch(url, init);
};

const DUMMY_INPUT: EngineInput = {
  code: 'console.log("dummy");',
  language: 'javascript',
  executionMode: 'FULL_PROGRAM',
  functionContract: null, comparisonMode: 'TRIMMED',
  testCases: [
    {
      id: 'tc1',
      input: '',
      expectedOutput: 'EXPECTED',
    }
  ]
};

async function runTest(desc: string, setup: () => void, checks: (res: any) => void) {
  console.log(`\n${desc}`);
  setup();
  const result = await executionEngine.execute(DUMMY_INPUT);
  checks(result);
}

async function main() {
  console.log("=== Judge0 Status Mapping Tests ===");

  await runTest(
    "TEST A: Judge0 status = TIME_LIMIT_EXCEEDED (stdout = correct expected output)",
    () => {
      mockStatusId = Judge0Status.TIME_LIMIT_EXCEEDED;
      mockStdout = 'EXPECTED';
      mockStderr = '';
      mockCompileOutput = '';
      mockNetworkFail = false;
    },
    (res) => {
      assert("Overall status is FAILED", res.status === 'FAILED');
      assert("Test case status is TIMEOUT", res.testCaseResults[0].status === 'TIMEOUT');
      assert("Never PASSED", res.testCaseResults[0].status !== 'PASSED');
    }
  );

  await runTest(
    "TEST B: Judge0 status = MEMORY_LIMIT_EXCEEDED (using a Runtime Error status as proxy)",
    () => {
      mockStatusId = Judge0Status.RUNTIME_ERROR_SIGSEGV;
      mockStdout = 'EXPECTED';
    },
    (res) => {
      assert("Test case status is RUNTIME_ERROR", res.testCaseResults[0].status === 'RUNTIME_ERROR');
      assert("Never PASSED", res.testCaseResults[0].status !== 'PASSED');
    }
  );

  await runTest(
    "TEST C: Judge0 status = RUNTIME_ERROR",
    () => {
      mockStatusId = Judge0Status.RUNTIME_ERROR_NZEC;
      mockStdout = 'EXPECTED'; // outputting correct answer before crashing
    },
    (res) => {
      assert("Test case status is RUNTIME_ERROR", res.testCaseResults[0].status === 'RUNTIME_ERROR');
      assert("Never PASSED", res.testCaseResults[0].status !== 'PASSED');
    }
  );

  await runTest(
    "TEST D: Judge0 status = COMPILATION_ERROR (with output resembling expected)",
    () => {
      mockStatusId = Judge0Status.COMPILATION_ERROR;
      mockStdout = 'EXPECTED';
    },
    (res) => {
      assert("Test case status is COMPILE_ERROR", res.testCaseResults[0].status === 'COMPILE_ERROR');
      assert("Never PASSED", res.testCaseResults[0].status !== 'PASSED');
    }
  );

  await runTest(
    "TEST E: Judge0 status = WRONG_ANSWER",
    () => {
      mockStatusId = Judge0Status.WRONG_ANSWER;
      mockStdout = 'ANYTHING';
    },
    (res) => {
      assert("Test case status is WRONG_ANSWER", res.testCaseResults[0].status === 'WRONG_ANSWER');
    }
  );

  await runTest(
    "TEST F: Judge0 status = ACCEPTED (correct output)",
    () => {
      mockStatusId = Judge0Status.ACCEPTED;
      mockStdout = 'EXPECTED';
    },
    (res) => {
      assert("Test case status is PASSED", res.testCaseResults[0].status === 'PASSED');
    }
  );

  await runTest(
    "TEST G: Judge0 status = ACCEPTED (wrong output)",
    () => {
      mockStatusId = Judge0Status.ACCEPTED;
      mockStdout = 'WRONG';
    },
    (res) => {
      assert("Test case status is WRONG_ANSWER", res.testCaseResults[0].status === 'WRONG_ANSWER');
    }
  );

  await runTest(
    "TEST H: Unknown Judge0 status ID",
    () => {
      mockStatusId = 999;
      mockStdout = 'EXPECTED';
    },
    (res) => {
      assert("Test case status is INTERNAL_ERROR", res.testCaseResults[0].status === 'INTERNAL_ERROR');
      assert("Never PASSED", res.testCaseResults[0].status !== 'PASSED');
    }
  );

  await runTest(
    "TEST I: Judge0/network request throws an exception",
    () => {
      mockNetworkFail = true;
    },
    (res) => {
      assert("Test case status is NETWORK_ERROR", res.testCaseResults[0].status === 'NETWORK_ERROR');
      assert("Never PASSED", res.testCaseResults[0].status !== 'PASSED');
    }
  );

  console.log("\n=== Results: All Judge0 status tests passed! ===");
}

main().catch(console.error);
