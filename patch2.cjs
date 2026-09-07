const fs = require('fs');
const code = fs.readFileSync('src/modules/grading/grading.service.ts', 'utf8');

let modified = code.replace(
  /let wrappedCode = '';\s*if \(language === 'python'\) \{\s*wrappedCode = `[\s\S]*?\} catch \(e\) \{\s*process\.stdout\.write\(e\.toString\(\)\);\s*\}\s*`;\s*\}/g,
  `let fnName = 'solution';
        const pyMatch = code.match(/def\\\\s+([a-zA-Z0-9_]+)\\\\s*\\\\(/);
        const jsMatch = code.match(/(?:function\\\\s+([a-zA-Z0-9_]+)\\\\s*\\\\()|(?:(?:const|let|var)\\\\s+([a-zA-Z0-9_]+)\\\\s*=\\\\s*(?:function|\\\\(.*=>|.*=>))/);
        if (language === 'python' && pyMatch) {
          fnName = pyMatch[1];
        } else if (jsMatch) {
          fnName = jsMatch[1] || jsMatch[2] || 'solution';
        }

        let wrappedCode = '';
        if (language === 'python') {
          wrappedCode = \`
\${code}
import sys
import json
try:
  fn_name = '\${fnName}'
  fn = locals().get(fn_name)
  if fn and callable(fn):
      args = \${tc.input}
      if isinstance(args, list) and not fn_name.startswith('solution'):
          result = fn(*args)
      else:
          result = fn(args)
      print("\\\\n---AGY_RESULT_DELIM---\\\\n" + (json.dumps(result) if isinstance(result, (dict, list, tuple)) else str(result).lower() if isinstance(result, bool) else str(result)), end='')
  else:
      pass
except Exception as e:
  print(e)
\`;
        } else {
          // Javascript
          wrappedCode = \`
\${code}
try {
  let __fn = null;
  if (typeof module !== 'undefined' && typeof module.exports === 'function') {
    __fn = module.exports;
  } else if (typeof \${fnName} === 'function') {
    __fn = \${fnName};
  }
  
  if (__fn) {
    let args = \${tc.input};
    const result = Array.isArray(args) ? __fn(...args) : __fn(args);
    if (result !== undefined) {
      process.stdout.write("\\\\n---AGY_RESULT_DELIM---\\\\n" + (typeof result === 'object' ? JSON.stringify(result) : String(result)));
    }
  } else {
    // If no function, assume they are just printing or we gracefully ignore
  }
} catch (e) {
  process.stdout.write(e.toString());
}
\`;
        }`
);

modified = modified.replace(
  /tcOutput = stdout\.trim\(\);[\s\S]*?if \(tcOutput === tc\.expectedOutput\) \{\s*tcPassed = true;\s*passCount\+\+;\s*\}/,
  `let rawOutput = stdout.trim();
          let cleanOutput = rawOutput;
          if (rawOutput.includes('---AGY_RESULT_DELIM---')) {
             const parts = rawOutput.split('---AGY_RESULT_DELIM---');
             cleanOutput = parts[1].trim();
          }
          tcOutput = cleanOutput;
          globalOutput += stdout.trim() + '\\n';
          
          if (stderr) {
             tcError = stderr.trim();
             globalOutput += tcError + '\\n';
          }

          if (tcOutput === tc.expectedOutput || tcOutput.includes(tc.expectedOutput)) {
            tcPassed = true;
            passCount++;
          }`
);

fs.writeFileSync('src/modules/grading/grading.service.ts', modified);
console.log("Applied regex patch!");
