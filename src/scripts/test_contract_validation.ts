import { executionEngine, EngineInput } from '../modules/execution/execution.engine.js';

function assert(desc: string, condition: boolean, msg?: string) {
  if (!condition) {
    console.error(`[FAIL] ${desc} ${msg ? '- ' + msg : ''}`);
    process.exit(1);
  } else {
    console.log(`  [PASS] ${desc}`);
  }
}

const DUMMY_CODE = 'console.log("dummy");';
const TC = [{ id: 'tc1', input: '[]', expectedOutput: 'EXPECTED' }];

async function runTest(desc: string, input: Partial<EngineInput>, expectError: string | null) {
  const fullInput: EngineInput = {
    code: DUMMY_CODE,
    language: 'javascript',
    executionMode: 'FUNCTION',
    functionContract: null,
    comparisonMode: 'TRIMMED',
    testCases: TC,
    ...input as any, // Cast to avoid TS complaining about partial comparisonMode overlay
  };
  
  const result = await executionEngine.execute(fullInput);
  
  if (expectError) {
    assert(desc, result.status === 'ERROR' && !!result.fatalError?.includes(expectError), `Expected fatal error containing '${expectError}', got ${result.status} / ${result.fatalError}`);
  } else {
    assert(desc, result.status !== 'ERROR', `Expected success, got ERROR: ${result.fatalError}`);
  }
}

async function main() {
  console.log("=== Contract Validation Tests ===");

  await runTest("TEST A: Valid FUNCTION contract", {
    executionMode: 'FUNCTION',
    functionContract: {
      functionName: 'solve',
      returnType: 'int',
      parameters: [{ name: 'a', type: 'int[]' }]
    }
  }, null);

  await runTest("TEST B: Missing functionContract", {
    executionMode: 'FUNCTION',
    functionContract: undefined as any
  }, "functionContract must be a valid object");

  await runTest("TEST C: functionContract = null", {
    executionMode: 'FUNCTION',
    functionContract: null
  }, "functionContract must be a valid object");

  await runTest("TEST D: functionName missing", {
    executionMode: 'FUNCTION',
    functionContract: { returnType: 'int', parameters: [] } as any
  }, "Invalid or missing 'functionName'");

  await runTest("TEST E: invalid functionName", {
    executionMode: 'FUNCTION',
    functionContract: { functionName: '1solve', returnType: 'int', parameters: [] }
  }, "Invalid or missing 'functionName'");

  await runTest("TEST F: parameters missing", {
    executionMode: 'FUNCTION',
    functionContract: { functionName: 'solve', returnType: 'int' } as any
  }, "'parameters' must be an array");

  await runTest("TEST G: parameters not array", {
    executionMode: 'FUNCTION',
    functionContract: { functionName: 'solve', returnType: 'int', parameters: "not an array" } as any
  }, "'parameters' must be an array");

  await runTest("TEST H: invalid parameter type", {
    executionMode: 'FUNCTION',
    functionContract: { functionName: 'solve', returnType: 'int', parameters: [{ name: 'a', type: 'float' }] }
  }, "Invalid parameter type");

  await runTest("TEST I: duplicate parameter names", {
    executionMode: 'FUNCTION',
    functionContract: { functionName: 'solve', returnType: 'int', parameters: [{ name: 'a', type: 'int' }, { name: 'a', type: 'string' }] }
  }, "Duplicate parameter name");

  await runTest("TEST J: returnType missing", {
    executionMode: 'FUNCTION',
    functionContract: { functionName: 'solve', parameters: [] } as any
  }, "Invalid or missing 'returnType'");

  await runTest("TEST K: invalid returnType", {
    executionMode: 'FUNCTION',
    functionContract: { functionName: 'solve', returnType: 'object', parameters: [] } as any
  }, "Invalid or missing 'returnType'");

  await runTest("TEST L: nested/unsupported type", {
    executionMode: 'FUNCTION',
    functionContract: { functionName: 'solve', returnType: 'int[][]', parameters: [] } as any
  }, "Invalid or missing 'returnType'");

  await runTest("TEST M: malformed parameter object", {
    executionMode: 'FUNCTION',
    functionContract: { functionName: 'solve', returnType: 'int', parameters: [{ name: 'a', type: 'int', extra: 'bad' }] } as any
  }, "Parameter object must only contain");

  await runTest("TEST N: FULL_PROGRAM with null contract", {
    executionMode: 'FULL_PROGRAM',
    functionContract: null
  }, null);

  await runTest("TEST O: FULL_PROGRAM with contract", {
    executionMode: 'FULL_PROGRAM',
    functionContract: { functionName: 'solve', returnType: 'int', parameters: [] }
  }, "FULL_PROGRAM must not have a functionContract");

  console.log("\n=== All contract validation tests passed ===");
}

main().catch(console.error);
