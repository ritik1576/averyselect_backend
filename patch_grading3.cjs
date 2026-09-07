const fs = require('fs');
const path = 'src/modules/grading/grading.service.ts';
let content = fs.readFileSync(path, 'utf8');

// FIX: Normalize output before comparison (trim each line, remove blank lines)
// and fix isPassed to only fail on hard errors (exitCode!=0), not stderr warnings
const oldComparison = `        let rawOutput = stdout.trim();
        let cleanOutput = rawOutput;
        if (rawOutput.includes('---AGY_RESULT_DELIM---')) {
           const parts = rawOutput.split('---AGY_RESULT_DELIM---');
           cleanOutput = parts[1].trim();
        }
        tcOutput = cleanOutput;
        globalOutput += stdout.trim() + '\\n';
        
        if (stderr && !isSuccess) {
           tcError = stderr.trim();
           globalOutput += tcError + '\\n';
        }

        const expectedClean = tc.expectedOutput.trim();
        let isMatch = false;
        
        let expectedObj, actualObj;
        try { expectedObj = JSON.parse(expectedClean); } catch(e) { expectedObj = expectedClean; }
        try { actualObj = JSON.parse(cleanOutput); } catch(e) { actualObj = cleanOutput; }
        
        isMatch = JSON.stringify(expectedObj) === JSON.stringify(actualObj);

        if (isSuccess && isMatch) {
          tcPassed = true;
          passCount++;
        }`;

const newComparison = `        let rawOutput = stdout.trim();
        let cleanOutput = rawOutput;
        if (rawOutput.includes('---AGY_RESULT_DELIM---')) {
           const parts = rawOutput.split('---AGY_RESULT_DELIM---');
           cleanOutput = parts[1].trim();
        }
        tcOutput = cleanOutput;
        globalOutput += stdout.trim() + '\\n';
        
        // Hard error = runtime/compile error (status != Accepted AND != Wrong Answer)
        // JVM/compiler warnings in stderr are OK as long as code ran (isSuccess or at least produced output)
        const hasHardError = !isSuccess && !cleanOutput;
        if (stderr && hasHardError) {
           tcError = stderr.trim();
           globalOutput += tcError + '\\n';
        }

        const normalizeOut = (s: string) => s.trim().split('\\n').map(l => l.trim()).filter(l => l !== '').join('\\n');
        const expectedClean = normalizeOut(tc.expectedOutput);
        const actualClean = normalizeOut(cleanOutput);
        let isMatch = false;
        
        let expectedObj, actualObj;
        try { expectedObj = JSON.parse(expectedClean); } catch(e) { expectedObj = expectedClean; }
        try { actualObj = JSON.parse(actualClean); } catch(e) { actualObj = actualClean; }
        
        isMatch = JSON.stringify(expectedObj) === JSON.stringify(actualObj);

        // Pass if output matches and no hard error (ignore stderr warnings for C++/Java)
        if (isMatch && !hasHardError) {
          tcPassed = true;
          passCount++;
        }`;

content = content.replace(oldComparison, newComparison);
fs.writeFileSync(path, content);
console.log('Patch 3 applied!');
