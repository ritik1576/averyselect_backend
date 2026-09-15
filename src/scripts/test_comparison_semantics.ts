import { compareOutput, FLOAT_TOLERANCE } from '../modules/execution/execution.engine.js';

function assert(desc: string, condition: boolean, msg?: string) {
  if (!condition) {
    console.error(`[FAIL] ${desc} ${msg ? '- ' + msg : ''}`);
    process.exit(1);
  } else {
    console.log(`  [PASS] ${desc}`);
  }
}

function runTests() {
  console.log("=== EXACT ===");
  assert("EXACT match", compareOutput('EXACT', 'hello', 'hello'));
  assert("EXACT mismatch whitespace", !compareOutput('EXACT', 'hello', 'hello '));
  assert("EXACT CRLF handled", compareOutput('EXACT', 'hello\r\n', 'hello\n'));

  console.log("\n=== TRIMMED ===");
  assert("TRIMMED match with whitespace", compareOutput('TRIMMED', '  hello  ', 'hello'));
  assert("TRIMMED internal whitespace preserved", !compareOutput('TRIMMED', 'hello  world', 'hello world'));

  console.log("\n=== TOKENIZED ===");
  assert("TOKENIZED handles internal whitespace", compareOutput('TOKENIZED', 'hello\nworld', 'hello   world'));
  assert("TOKENIZED order matters", !compareOutput('TOKENIZED', 'hello world', 'world hello'));

  console.log("\n=== JSON ===");
  assert("JSON valid match", compareOutput('JSON', '{"a":1}', '{"a": 1}'));
  assert("JSON invalid JSON fails", !compareOutput('JSON', '{"a":1', '{"a":1'));
  assert("JSON sort object keys", compareOutput('JSON', '{"b":2,"a":1}', '{"a":1,"b":2}'));
  assert("JSON array order matters", !compareOutput('JSON', '[1,2]', '[2,1]'));

  console.log("\n=== FLOAT ===");
  // Scalar tests
  assert("scalar exact match -> PASS", compareOutput('FLOAT', '1.234', '1.234'));
  assert("scalar within tolerance -> PASS", compareOutput('FLOAT', '1.234567', '1.2345671')); // diff 1e-7 <= 1e-6
  assert("scalar outside tolerance -> FAIL", !compareOutput('FLOAT', '1.234567', '1.234569')); // diff 2e-6 > 1e-6
  
  // Array tests
  assert("float array exact match -> PASS", compareOutput('FLOAT', '[1.0, 2.0]', '[1.0, 2.0]'));
  assert("float array within tolerance -> PASS", compareOutput('FLOAT', '[1.0, 2.0000001]', '[1.0, 2.0]'));
  assert("float array outside tolerance -> FAIL", !compareOutput('FLOAT', '[1.0, 2.000002]', '[1.0, 2.0]'));
  assert("different array lengths -> FAIL", !compareOutput('FLOAT', '[1.0]', '[1.0, 2.0]'));
  assert("reordered array -> FAIL", !compareOutput('FLOAT', '[1.0, 2.0]', '[2.0, 1.0]'));
  
  // Rejection tests
  assert("non-numeric array values -> FAIL", !compareOutput('FLOAT', '["1.0"]', '["1.0"]'));
  assert("invalid JSON -> FAIL", !compareOutput('FLOAT', '[1.0,', '[1.0,'));
  assert("NaN/Infinity/non-finite values -> FAIL", !compareOutput('FLOAT', 'Infinity', 'Infinity'));
  assert("NaN values -> FAIL", !compareOutput('FLOAT', 'NaN', 'NaN'));
  assert("null fails", !compareOutput('FLOAT', 'null', 'null'));
  assert("nested arrays rejected -> FAIL", !compareOutput('FLOAT', '[[1.0]]', '[[1.0]]'));

  console.log("\n=== All tests passed ===");
}

try {
  runTests();
} catch (e) {
  console.error("Test execution failed:", e);
  process.exit(1);
}
