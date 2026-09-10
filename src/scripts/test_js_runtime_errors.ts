import { executionEngine, EngineInput } from '../modules/execution/execution.engine.js';

function assert(desc: string, condition: boolean, detail?: string) {
  if (!condition) {
    console.error(`  [FAIL] ${desc}${detail ? ' — ' + detail : ''}`);
    process.exit(1);
  } else {
    console.log(`  [PASS] ${desc}`);
  }
}

// Base FUNCTION contract for all JS tests
function makeInput(code: string, expectedOutput: string, overrides: Partial<EngineInput> = {}): EngineInput {
  return {
    code,
    language: 'javascript',
    executionMode: 'FUNCTION',
    functionContract: {
      functionName: 'solve',
      returnType: 'int',
      parameters: [{ name: 'a', type: 'int' }],
    },
    comparisonMode: 'TRIMMED',
    testCases: [{ id: 'tc1', input: '[5]', expectedOutput }],
    ...overrides,
  };
}

async function main() {
  console.log('\n=== JavaScript FUNCTION mode runtime error tests ===\n');

  // 1. Successful normal return
  {
    const result = await executionEngine.execute(
      makeInput('function solve(a) { return a * 2; }', '10'),
    );
    const r = result.testCaseResults[0];
    assert('1. Normal return → PASSED', r.status === 'PASSED',
      `status=${r.status} output=${r.output}`);
  }

  // 2. throw new Error
  {
    const result = await executionEngine.execute(
      makeInput('function solve(a) { throw new Error("runtime failure"); }', '10'),
    );
    const r = result.testCaseResults[0];
    assert('2. throw new Error → RUNTIME_ERROR', r.status === 'RUNTIME_ERROR',
      `status=${r.status} output=${r.output}`);
    assert('2b. throw new Error → NOT WRONG_ANSWER', r.status !== 'WRONG_ANSWER',
      `status=${r.status}`);
    assert('2c. output is null/empty (not compared)', r.output === null || r.output === undefined || r.output === '',
      `output=${JSON.stringify(r.output)}`);
  }

  // 3. TypeError
  {
    const result = await executionEngine.execute(
      makeInput('function solve(a) { return a.toUpperCase(); }', '10'),
    );
    const r = result.testCaseResults[0];
    assert('3. TypeError → RUNTIME_ERROR', r.status === 'RUNTIME_ERROR',
      `status=${r.status} output=${r.output}`);
    assert('3b. TypeError → NOT WRONG_ANSWER', r.status !== 'WRONG_ANSWER',
      `status=${r.status}`);
  }

  // 4. ReferenceError
  {
    const result = await executionEngine.execute(
      makeInput('function solve(a) { return undeclaredVariable + 1; }', '10'),
    );
    const r = result.testCaseResults[0];
    assert('4. ReferenceError → RUNTIME_ERROR', r.status === 'RUNTIME_ERROR',
      `status=${r.status} output=${r.output}`);
    assert('4b. ReferenceError → NOT WRONG_ANSWER', r.status !== 'WRONG_ANSWER',
      `status=${r.status}`);
  }

  // 5. Runtime error after console.log output
  {
    const code = `function solve(a) {
  console.log("debug line");
  console.log("another line");
  throw new RangeError("out of range");
}`;
    const result = await executionEngine.execute(makeInput(code, '10'));
    const r = result.testCaseResults[0];
    assert('5. Error after console.log → RUNTIME_ERROR', r.status === 'RUNTIME_ERROR',
      `status=${r.status} output=${r.output}`);
    assert('5b. Error after console.log → NOT WRONG_ANSWER', r.status !== 'WRONG_ANSWER',
      `status=${r.status}`);
  }

  // 6. BigInt serialization regression
  {
    const result = await executionEngine.execute({
      code: 'function solve(a) { return BigInt(a) * BigInt(1000000000000); }',
      language: 'javascript',
      executionMode: 'FUNCTION',
      functionContract: {
        functionName: 'solve',
        returnType: 'string',
        parameters: [{ name: 'a', type: 'int' }],
      },
      comparisonMode: 'TRIMMED',
      testCases: [{ id: 'tc1', input: '[5]', expectedOutput: '"5000000000000"' }],
    });
    const r = result.testCaseResults[0];
    assert('6. BigInt serialization → PASSED', r.status === 'PASSED',
      `status=${r.status} output=${r.output}`);
  }

  // 7. Normal array return (regression)
  {
    const result = await executionEngine.execute({
      code: 'function twoSum(nums, target) { return [0,1]; }',
      language: 'javascript',
      executionMode: 'FUNCTION',
      functionContract: {
        functionName: 'twoSum',
        returnType: 'int[]',
        parameters: [
          { name: 'nums', type: 'int[]' },
          { name: 'target', type: 'int' },
        ],
      },
      comparisonMode: 'JSON',
      testCases: [{ id: 'tc1', input: '[[2,7,11,15],9]', expectedOutput: '[0,1]' }],
    });
    const r = result.testCaseResults[0];
    assert('7. Normal array return → PASSED', r.status === 'PASSED',
      `status=${r.status} output=${r.output}`);
  }

  // 8. Correct result with console.log noise
  {
    const code = `function solve(a) {
  console.log("logging things");
  return a + 1;
}`;
    const result = await executionEngine.execute(makeInput(code, '6'));
    const r = result.testCaseResults[0];
    assert('8. Correct result with console.log noise → PASSED', r.status === 'PASSED',
      `status=${r.status} output=${r.output}`);
  }

  // 9. throw non-Error object (string)
  {
    const result = await executionEngine.execute(
      makeInput('function solve(a) { throw "string exception"; }', '10'),
    );
    const r = result.testCaseResults[0];
    assert('9. throw string → RUNTIME_ERROR', r.status === 'RUNTIME_ERROR',
      `status=${r.status} output=${r.output}`);
    assert('9b. throw string → NOT WRONG_ANSWER', r.status !== 'WRONG_ANSWER',
      `status=${r.status}`);
  }

  // 10. Wrong answer (no exception) still WRONG_ANSWER
  {
    const result = await executionEngine.execute(
      makeInput('function solve(a) { return 999; }', '10'),
    );
    const r = result.testCaseResults[0];
    assert('10. Wrong return value → WRONG_ANSWER', r.status === 'WRONG_ANSWER',
      `status=${r.status} output=${r.output}`);
  }

  console.log('\n=== All JavaScript runtime error tests passed ✓ ===\n');
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
