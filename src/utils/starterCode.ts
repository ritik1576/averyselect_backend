export interface FunctionParameter {
  name: string;
  type: string;
}

export interface FunctionContract {
  functionName: string;
  parameters: FunctionParameter[];
  returnType: string;
}

export function mapTypeToJava(type: string): string {
  switch (type) {
    case 'int': return 'int';
    case 'double': return 'double';
    case 'boolean': return 'boolean';
    case 'string': return 'String';
    case 'int[]': return 'int[]';
    case 'double[]': return 'double[]';
    case 'boolean[]': return 'boolean[]';
    case 'string[]': return 'String[]';
    default: return type;
  }
}

export function mapTypeToCpp(type: string): string {
  switch (type) {
    case 'int': return 'int';
    case 'double': return 'double';
    case 'boolean': return 'bool';
    case 'string': return 'string';
    case 'int[]': return 'vector<int>';
    case 'double[]': return 'vector<double>';
    case 'boolean[]': return 'vector<bool>';
    case 'string[]': return 'vector<string>';
    default: return type;
  }
}

export function mapTypeToTs(type: string): string {
  switch (type) {
    case 'int': return 'number';
    case 'double': return 'number';
    case 'boolean': return 'boolean';
    case 'string': return 'string';
    case 'int[]': return 'number[]';
    case 'double[]': return 'number[]';
    case 'boolean[]': return 'boolean[]';
    case 'string[]': return 'string[]';
    default: return type;
  }
}

export function isStaleStarterCode(code: string | null | undefined): boolean {
  if (!code || typeof code !== 'string') return true;
  const trimmed = code.trim();
  if (trimmed === '') return true;
  return (
    trimmed.includes('function solution(') ||
    trimmed.includes('def solution(') ||
    trimmed.includes('module.exports = solution;') ||
    trimmed.includes('solution(Object input)') ||
    trimmed.includes('solution(string input)') ||
    trimmed.includes('SELECT \'[2]\' AS result;')
  );
}

export function generateFunctionStarterCode(
  lang: string,
  contract: FunctionContract | null
): string {
  const fnName = contract?.functionName || 'solution';
  const params = contract?.parameters || [];
  const retType = contract?.returnType || 'int';

  switch (lang.toLowerCase()) {
    case 'javascript':
    case 'js': {
      const paramList = params.map((p) => p.name).join(', ');
      return `function ${fnName}(${paramList}) {\n    // Write your solution here\n}\n`;
    }

    case 'python':
    case 'py': {
      const paramList = params.map((p) => p.name).join(', ');
      return `def ${fnName}(${paramList}):\n    # Write your solution here\n    pass\n`;
    }

    case 'java': {
      const javaRet = mapTypeToJava(retType);
      const paramList = params.map((p) => `${mapTypeToJava(p.type)} ${p.name}`).join(', ');
      return `public class Solution {\n    public static ${javaRet} ${fnName}(${paramList}) {\n        // Write your solution here\n    }\n}\n`;
    }

    case 'cpp':
    case 'c++': {
      const cppRet = mapTypeToCpp(retType);
      const paramList = params.map((p) => `${mapTypeToCpp(p.type)} ${p.name}`).join(', ');
      return `#include <iostream>\n#include <vector>\n#include <string>\nusing namespace std;\n\n${cppRet} ${fnName}(${paramList}) {\n    // Write your solution here\n}\n`;
    }

    case 'typescript':
    case 'ts': {
      const tsRet = mapTypeToTs(retType);
      const paramList = params.map((p) => `${p.name}: ${mapTypeToTs(p.type)}`).join(', ');
      return `function ${fnName}(${paramList}): ${tsRet} {\n    // Write your solution here\n}\n`;
    }

    default: {
      const paramList = params.map((p) => p.name).join(', ');
      return `function ${fnName}(${paramList}) {\n    // Write your solution here\n}\n`;
    }
  }
}

export function getFullProgramStarterCode(lang: string): string {
  switch (lang.toLowerCase()) {
    case 'javascript':
    case 'js':
      return `/**\n * @param {any} input\n * @return {any}\n */\nfunction solution(input) {\n  // Write your solution here\n\n}\n\nmodule.exports = solution;`;
    case 'python':
    case 'py':
      return `def solution(input):\n    # Write your solution here\n    pass`;
    case 'java':
      return `import java.util.*;\n\npublic class Solution {\n    public static Object solution(Object input) {\n        // Write your solution here\n        return null;\n    }\n}`;
    case 'cpp':
    case 'c++':
      return `#include <iostream>\n#include <vector>\n#include <string>\n#include <algorithm>\n#include <map>\n#include <set>\n#include <unordered_map>\n#include <unordered_set>\nusing namespace std;\n\n// Write your solution here\nstring solution(string input) {\n    return input;\n}`;
    case 'typescript':
    case 'ts':
      return `function solution(input: any): any {\n  // Write your solution here\n}\n\nexport default solution;`;
    default:
      return '';
  }
}

export function getStarterCode(
  lang: string,
  executionMode: 'FULL_PROGRAM' | 'FUNCTION' = 'FULL_PROGRAM',
  contract: FunctionContract | null = null
): string {
  if (executionMode === 'FUNCTION' && contract && contract.functionName) {
    return generateFunctionStarterCode(lang, contract);
  }
  return getFullProgramStarterCode(lang);
}
