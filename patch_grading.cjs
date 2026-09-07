const fs = require('fs');
const path = 'src/modules/grading/grading.service.ts';
let content = fs.readFileSync(path, 'utf8');

// Replace the old stdin normalization with the new one that adds count prefix for arrays
const oldCode = `        if (language === 'cpp' || language === 'java') {
          wrappedCode = code; // No wrapper, reads from stdin
          try {
            const parsedArgs = JSON.parse(tc.input);
            if (Array.isArray(parsedArgs)) {
              stdinPayload = parsedArgs.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join('\\n');
            } else {
              stdinPayload = String(parsedArgs);
            }
          } catch (e) {
            stdinPayload = String(tc.input);
          }`;

const newCode = `        if (language === 'cpp' || language === 'java') {
          wrappedCode = code; // No wrapper, reads from stdin
          stdinPayload = normalizeStdinForNative(tc.input);`;

content = content.replace(oldCode, newCode);

// Add helper function before the class or before the gradeSession function
const helperFn = `
/**
 * Converts test case input JSON into competitive-programming style stdin for C++/Java.
 * Arrays → first line: count, second line: space-separated (numbers) or one-per-line (strings).
 * Strings → plain value (no quotes). Scalars → string form. Raw text → pass-through.
 */
function normalizeStdinForNative(input: string): string {
  const raw = (input ?? '').trim();
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const count = parsed.length;
      const isStringArray = parsed.every((x: any) => typeof x === 'string');
      if (isStringArray) {
        return \`\${count}\\n\${parsed.join('\\n')}\`;
      } else {
        return \`\${count}\\n\${parsed.join(' ')}\`;
      }
    } else if (typeof parsed === 'string') {
      return parsed;
    } else {
      return String(parsed);
    }
  } catch {
    return raw;
  }
}

`;

// Insert helper before "export class GradingService" or similar
content = content.replace(/^(export class GradingService)/m, helperFn + '$1');

fs.writeFileSync(path, content);
console.log('Patch applied successfully!');
