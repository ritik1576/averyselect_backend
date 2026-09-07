const { execSync } = require('child_process');

const code = `
function reverseString(str) {
  return str.split("").reverse().join("");
}

// Your Hidden Output
console.log(reverseString("12345"));
`;

const jsMatch = code.match(/(?:function\s+([a-zA-Z0-9_]+)\s*\()|(?:(?:const|let|var)\s+([a-zA-Z0-9_]+)\s*=\s*(?:function|\(.*=>|.*=>))/);
let fnName = jsMatch[1] || jsMatch[2] || 'solution';

const tc = { input: '"hello"', expectedOutput: '"olleh"' };

const wrappedCode = `
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
      process.stdout.write("\\n---AGY_RESULT_DELIM---\\n" + JSON.stringify(result));
    }
  } else {
    // If no function, assume they are just printing or we gracefully ignore
  }
} catch (e) {
  process.stdout.write(e.toString());
}
`;

const fs = require('fs');
fs.writeFileSync('temp_test.js', wrappedCode);
try {
  const stdout = execSync('node temp_test.js').toString();
  console.log("STDOUT:\n", stdout);
  
  let rawOutput = stdout.trim();
  let cleanOutput = rawOutput;
  if (rawOutput.includes('---AGY_RESULT_DELIM---')) {
     const parts = rawOutput.split('---AGY_RESULT_DELIM---');
     cleanOutput = parts[1].trim();
  }
  console.log("CLEAN OUTPUT:", cleanOutput);
  
  const expectedClean = tc.expectedOutput.trim();
  let expectedObj, actualObj;
  try { expectedObj = JSON.parse(expectedClean); } catch(e) { expectedObj = expectedClean; }
  try { actualObj = JSON.parse(cleanOutput); } catch(e) { actualObj = cleanOutput; }
  
  console.log("EXPECTED OBJ:", expectedObj);
  console.log("ACTUAL OBJ:", actualObj);
  
  const isMatch = JSON.stringify(expectedObj) === JSON.stringify(actualObj);
  console.log("IS MATCH:", isMatch);
} catch(e) {
  console.error(e);
}
