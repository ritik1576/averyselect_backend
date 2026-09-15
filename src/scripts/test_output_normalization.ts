import { normalizeOutput } from '../modules/execution/execution.engine.js';

function assertEq(desc: string, actual: string, expected: string) {
  if (actual !== expected) {
    console.error(`[FAIL] ${desc}\n  Expected: ${JSON.stringify(expected)}\n  Actual:   ${JSON.stringify(actual)}`);
    process.exit(1);
  } else {
    console.log(`  [PASS] ${desc}`);
  }
}

function main() {
  console.log("=== Output Normalization Tests ===");

  // 1. outer leading whitespace
  assertEq("1. Outer leading whitespace", normalizeOutput("   hello"), "hello");

  // 2. outer trailing whitespace
  assertEq("2. Outer trailing whitespace", normalizeOutput("hello   "), "hello");

  // 3. trailing newline
  assertEq("3. Trailing newline", normalizeOutput("hello\n"), "hello");

  // 4. internal multiple spaces
  assertEq("4. Internal multiple spaces", normalizeOutput("hello   world"), "hello   world");

  // 5. leading spaces on individual lines
  assertEq("5. Leading spaces on individual lines", normalizeOutput("hello\n  world"), "hello\n  world");

  // 6. blank lines
  assertEq("6. Blank lines", normalizeOutput("hello\n\nworld"), "hello\n\nworld");

  // 7. multiline output
  assertEq("7. Multiline output combined", normalizeOutput("  \n\n  hello   world\n\n  second line  \n\n  "), "hello   world\n\n  second line");

  // 8. CRLF vs LF
  assertEq("8. CRLF vs LF", normalizeOutput("hello\r\nworld\r\n"), "hello\nworld");

  console.log("\n=== All normalization tests passed ===");
}

main();
