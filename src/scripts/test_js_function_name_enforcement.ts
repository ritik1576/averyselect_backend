import { executionEngine, EngineInput } from '../modules/execution/execution.engine.js';

function assert(desc: string, condition: boolean, detail?: string) {
  if (!condition) {
    console.error(`  [FAIL] ${desc}${detail ? ' — ' + detail : ''}`);
    process.exit(1);
  } else {
    console.log(`  [PASS] ${desc}`);
  }
}

// Helper: standard twoSum contract
function twoSumInput(code: string, expectedOutput: string): EngineInput {
  return {
    code,
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
    testCases: [{ id: 'tc1', input: '[[2,7,11,15],9]', expectedOutput }],
  };
}

async function main() {
  console.log('\n=== JavaScript FUNCTION — functionName enforcement tests ===\n');

  // ── A. Configured function executes normally ────────────────────────────────
  {
    const code = `
function twoSum(nums, target) {
  return [0, 1];
}`;
    const result = await executionEngine.execute(twoSumInput(code, '[0,1]'));
    const r = result.testCaseResults[0];
    assert('A. Configured function executes → PASSED', r.status === 'PASSED',
      `status=${r.status} output=${r.output}`);
  }

  // ── B. module.exports points to a different function — engine must use twoSum
  {
    const code = `
function twoSum(nums, target) {
  return [0, 1];       // correct answer
}

function wrongFunction(nums, target) {
  return [1, 2];       // wrong answer
}

module.exports = wrongFunction;
`;
    const result = await executionEngine.execute(twoSumInput(code, '[0,1]'));
    const r = result.testCaseResults[0];
    assert('B. module.exports overridden — engine uses twoSum → PASSED', r.status === 'PASSED',
      `status=${r.status} output=${r.output}`);
    assert('B2. module.exports override does not cause WRONG_ANSWER', r.status !== 'WRONG_ANSWER',
      `status=${r.status}`);
  }

  // ── C. Only wrongFunction exists, twoSum absent → RUNTIME_ERROR ─────────────
  {
    const code = `
function wrongFunction(nums, target) {
  return [0, 1];
}

module.exports = wrongFunction;
`;
    const result = await executionEngine.execute(twoSumInput(code, '[0,1]'));
    const r = result.testCaseResults[0];
    assert('C. Configured function absent → RUNTIME_ERROR', r.status === 'RUNTIME_ERROR',
      `status=${r.status} output=${r.output}`);
    assert('C2. Absent function → NOT WRONG_ANSWER', r.status !== 'WRONG_ANSWER',
      `status=${r.status}`);
    assert('C3. Absent function → NOT PASSED', r.status !== 'PASSED',
      `status=${r.status}`);
  }

  // ── D. module.exports = correct function → PASSED ───────────────────────────
  {
    const code = `
function twoSum(nums, target) {
  return [0, 1];
}

module.exports = twoSum;
`;
    const result = await executionEngine.execute(twoSumInput(code, '[0,1]'));
    const r = result.testCaseResults[0];
    assert('D. module.exports = twoSum → PASSED (name resolves correctly)', r.status === 'PASSED',
      `status=${r.status} output=${r.output}`);
  }

  // ── E. Identifier exists but is not a function (is a number) ────────────────
  {
    const code = `
const twoSum = 42;
`;
    const result = await executionEngine.execute(twoSumInput(code, '[0,1]'));
    const r = result.testCaseResults[0];
    assert('E. Identifier exists but not callable → RUNTIME_ERROR', r.status === 'RUNTIME_ERROR',
      `status=${r.status} output=${r.output}`);
    assert('E2. Non-callable identifier → NOT WRONG_ANSWER', r.status !== 'WRONG_ANSWER',
      `status=${r.status}`);
  }

  // ── F. Runtime error from within twoSum still propagates ────────────────────
  {
    const code = `
function twoSum(nums, target) {
  throw new Error("internal runtime error");
}
`;
    const result = await executionEngine.execute(twoSumInput(code, '[0,1]'));
    const r = result.testCaseResults[0];
    assert('F. Candidate throws inside configured function → RUNTIME_ERROR', r.status === 'RUNTIME_ERROR',
      `status=${r.status} output=${r.output}`);
  }

  // ── G. BigInt regression ─────────────────────────────────────────────────────
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
    assert('G. BigInt serialization regression → PASSED', r.status === 'PASSED',
      `status=${r.status} output=${r.output}`);
  }

  // ── H. Result delimiter present on success ────────────────────────────────
  {
    const code = `function solve(a) { return a * 3; }`;
    const result = await executionEngine.execute({
      code,
      language: 'javascript',
      executionMode: 'FUNCTION',
      functionContract: {
        functionName: 'solve',
        returnType: 'int',
        parameters: [{ name: 'a', type: 'int' }],
      },
      comparisonMode: 'TRIMMED',
      testCases: [{ id: 'tc1', input: '[4]', expectedOutput: '12' }],
    });
    const r = result.testCaseResults[0];
    assert('H. Result delimiter present on success', r.status === 'PASSED',
      `status=${r.status} output=${r.output}`);
    assert('H2. Output matches expected', r.output === '12',
      `output=${JSON.stringify(r.output)}`);
  }

  // ── I. console.log before result does not corrupt output ─────────────────────
  {
    const code = `
function twoSum(nums, target) {
  console.log("debug");
  return [0, 1];
}`;
    const result = await executionEngine.execute(twoSumInput(code, '[0,1]'));
    const r = result.testCaseResults[0];
    assert('I. console.log before return does not corrupt result → PASSED', r.status === 'PASSED',
      `status=${r.status} output=${r.output}`);
  }

  console.log('\n=== All JavaScript functionName enforcement tests passed ✓ ===\n');
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
