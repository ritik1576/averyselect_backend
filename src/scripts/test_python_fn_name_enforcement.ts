import { executionEngine, EngineInput } from "../modules/execution/execution.engine.js";

function assert(desc: string, condition: boolean, detail?: string) {
  if (!condition) {
    console.error(`  [FAIL] ${desc}${detail ? " — " + detail : ""}`);
    process.exit(1);
  } else {
    console.log(`  [PASS] ${desc}`);
  }
}

function twoSumInput(code: string, expectedOutput: string = "[0, 1]"): EngineInput {
  return {
    code,
    language: "python",
    executionMode: "FUNCTION",
    functionContract: {
      functionName: "twoSum",
      returnType: "int[]",
      parameters: [
        { name: "nums", type: "int[]" },
        { name: "target", type: "int" },
      ],
    },
    comparisonMode: "JSON",
    testCases: [{ id: "tc1", input: "[[2,7,11,15], 9]", expectedOutput }],
  };
}

async function main() {
  console.log("\n=== Python FUNCTION — functionName enforcement tests ===\n");

  // Test 1: Correct configured function exists and is callable -> Expected: PASSED
  {
    const code = `def twoSum(nums, target):
    return [0, 1]
`;
    const result = await executionEngine.execute(twoSumInput(code, "[0, 1]"));
    const r = result.testCaseResults[0];
    assert("1. Correct configured function exists and is callable → PASSED", r.status === "PASSED",
      `status=${r.status} output=${r.output} error=${r.error}`);
  }

  // Test 2: Candidate defines the wrong function name (e.g. contract: twoSum, candidate: solve(...)) -> Expected: RUNTIME_ERROR
  {
    const code = `def solve(nums, target):
    return [0, 1]
`;
    const result = await executionEngine.execute(twoSumInput(code, "[0, 1]"));
    const r = result.testCaseResults[0];
    assert("2. Candidate defines wrong function name (solve vs twoSum) → RUNTIME_ERROR", r.status === "RUNTIME_ERROR",
      `status=${r.status} output=${r.output} error=${r.error}`);
    assert("2b. Wrong function name does NOT produce WRONG_ANSWER", r.status !== "WRONG_ANSWER",
      `status=${r.status}`);
  }

  // Test 3: Configured function is completely missing -> Expected: RUNTIME_ERROR
  {
    const code = `# Candidate wrote no function
x = 42
`;
    const result = await executionEngine.execute(twoSumInput(code, "[0, 1]"));
    const r = result.testCaseResults[0];
    assert("3. Configured function completely missing → RUNTIME_ERROR", r.status === "RUNTIME_ERROR",
      `status=${r.status} output=${r.output} error=${r.error}`);
    assert("3b. Missing function does NOT produce WRONG_ANSWER", r.status !== "WRONG_ANSWER",
      `status=${r.status}`);
  }

  // Test 4: Configured function exists but is not callable (e.g. twoSum = 123) -> Expected: RUNTIME_ERROR
  {
    const code = `twoSum = 123
`;
    const result = await executionEngine.execute(twoSumInput(code, "[0, 1]"));
    const r = result.testCaseResults[0];
    assert("4. Configured function exists but is not callable (number) → RUNTIME_ERROR", r.status === "RUNTIME_ERROR",
      `status=${r.status} output=${r.output} error=${r.error}`);
    assert("4b. Non-callable function does NOT produce WRONG_ANSWER", r.status !== "WRONG_ANSWER",
      `status=${r.status}`);
  }

  // Test 5: Configured function exists but throws an exception -> Expected: RUNTIME_ERROR
  {
    const code = `def twoSum(nums, target):
    raise ValueError("candidate failure")
`;
    const result = await executionEngine.execute(twoSumInput(code, "[0, 1]"));
    const r = result.testCaseResults[0];
    assert("5. Configured function exists but throws exception → RUNTIME_ERROR", r.status === "RUNTIME_ERROR",
      `status=${r.status} output=${r.error}`);
  }

  // Test 6: Existing valid Python FUNCTION tests continue passing
  {
    const code = `def twoSum(nums, target):
    lookup = {}
    for i, num in enumerate(nums):
        diff = target - num
        if diff in lookup:
            return [lookup[diff], i]
        lookup[num] = i
    return []
`;
    const result = await executionEngine.execute(twoSumInput(code, "[0, 1]"));
    const r = result.testCaseResults[0];
    assert("6. Dynamic twoSum implementation → PASSED", r.status === "PASSED",
      `status=${r.status} output=${r.output}`);
  }

  console.log("\n=== All Python functionName enforcement tests passed ✓ ===\n");
}

main().catch(err => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
