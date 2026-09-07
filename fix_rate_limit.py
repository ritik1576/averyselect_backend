import os

file_path = "src/modules/grading/grading.service.ts"
with open(file_path, "r") as f:
    content = f.read()

old_code = """        try {
          const response = await fetch('https://ce.judge0.com/submissions?wait=true', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              source_code: wrappedCode,
              language_id: langConfig.id,
              stdin: stdinPayload,
            }),
          });
          
          if (!response.ok) {
            stderr = await response.text();
          } else {
            const data = await response.json();
            stdout = data.stdout || '';
            const compileOutput = data.compile_output || '';
            stderr = data.stderr || compileOutput || data.message || '';
            isSuccess = data.status?.id === 3; // 3 = Accepted
          }
        } catch (e: any) {
          stderr = e.message || 'Execution failed';
        }"""

new_code = """        let retries = 3;
        let delay = 1500;
        while (retries > 0) {
          try {
            const response = await fetch('https://ce.judge0.com/submissions?wait=true', {
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
            }
            break;
          } catch (e: any) {
            retries--;
            if (retries === 0) {
                stderr = e.message || 'Execution failed';
            } else {
                await new Promise(r => setTimeout(r, delay));
                delay *= 2;
            }
          }
        }"""

if old_code in content:
    content = content.replace(old_code, new_code)
    with open(file_path, "w") as f:
        f.write(content)
    print("Replaced successfully!")
else:
    print("Code snippet not found!")
