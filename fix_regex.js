const fs = require('fs');
let code = fs.readFileSync('src/modules/grading/grading.service.ts', 'utf8');
code = code.replace(/code\.match\(\/def\\\\s\+\(\[a-zA-Z0-9_\]\+\)\\\\s\*\\\\(\/\)/, "code.match(/def\\\\s+([a-zA-Z0-9_]+)\\\\s*\\\\(/)");
code = code.replace(/code\.match\(\/\(\?:function\\\\s\+\(\[a-zA-Z0-9_\]\+\)\\\\s\*\\\\(\)\|\(\?:\(\?:const\|let\|var\)\\\\s\+\(\[a-zA-Z0-9_\]\+\)\\\\s\*=\\\\s\*\(\?:function\|\\\\(\.\*=>\|\.\*=>\)\)\/\)/, "code.match(/(?:function\\\\s+([a-zA-Z0-9_]+)\\\\s*\\\\()|(?:(?:const|let|var)\\\\s+([a-zA-Z0-9_]+)\\\\s*=\\\\s*(?:function|\\\\(.*=>|.*=>))/)");
fs.writeFileSync('src/modules/grading/grading.service.ts', code);
