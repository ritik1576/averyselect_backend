const fs = require('fs');
const path = 'src/modules/grading/grading.service.ts';
let content = fs.readFileSync(path, 'utf8');

// FIX 1: Add base64_encoded=true to Judge0 URL and encode/decode properly
const oldFetch = `            const response = await fetch('https://ce.judge0.com/submissions?wait=true', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                source_code: wrappedCode,
                language_id: langConfig.id,
                stdin: stdinPayload,
              }),
            });
            
            if (response.status === 429) {
                retries--;
                await new Promise(r => setTimeout(r, delay));
                delay *= 2;
                continue;
            }
            
            if (!response.ok) {
              stderr = await response.text();
            } else {
              const data = await response.json();
              stdout = data.stdout || '';
              const compileOutput = data.compile_output || '';
              stderr = data.stderr || compileOutput || data.message || '';
              isSuccess = data.status?.id === 3; // 3 = Accepted
            }`;

const newFetch = `            const response = await fetch('https://ce.judge0.com/submissions?wait=true&base64_encoded=true', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                source_code: Buffer.from(wrappedCode).toString('base64'),
                language_id: langConfig.id,
                stdin: Buffer.from(stdinPayload).toString('base64'),
              }),
            });
            
            if (response.status === 429) {
                retries--;
                await new Promise(r => setTimeout(r, delay));
                delay *= 2;
                continue;
            }
            
            if (!response.ok) {
              stderr = await response.text();
            } else {
              const data = await response.json();
              const decodeB64 = (val: string | null | undefined) => val ? Buffer.from(val, 'base64').toString('utf8') : '';
              stdout = decodeB64(data.stdout);
              const compileOutput = decodeB64(data.compile_output);
              stderr = decodeB64(data.stderr) || compileOutput || data.message || '';
              isSuccess = data.status?.id === 3; // 3 = Accepted
            }`;

content = content.replace(oldFetch, newFetch);

fs.writeFileSync(path, content);
console.log('Patch 2 applied!');
