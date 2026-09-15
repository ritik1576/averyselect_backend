import { z } from 'zod';

export function validateArgumentType(arg: any, expectedType: string): string | null {
  if (arg === null) {
    return `null is not allowed for type ${expectedType}`;
  }

  if (expectedType === 'int') {
    if (typeof arg !== 'number' || !Number.isFinite(arg) || !Number.isInteger(arg)) {
      return `Expected finite integer for type int, got ${typeof arg === 'number' ? arg : typeof arg}`;
    }
  } else if (expectedType === 'double') {
    if (typeof arg !== 'number' || !Number.isFinite(arg)) {
      return `Expected finite number for type double, got ${typeof arg === 'number' ? arg : typeof arg}`;
    }
  } else if (expectedType === 'boolean') {
    if (typeof arg !== 'boolean') {
      return `Expected boolean, got ${typeof arg}`;
    }
  } else if (expectedType === 'string') {
    if (typeof arg !== 'string') {
      return `Expected string, got ${typeof arg}`;
    }
  } else if (expectedType.endsWith('[]')) {
    if (!Array.isArray(arg)) {
      return `Expected JSON array for type ${expectedType}, got ${typeof arg}`;
    }
    const elementType = expectedType.replace('[]', '');
    for (let i = 0; i < arg.length; i++) {
      const err = validateArgumentType(arg[i], elementType);
      if (err) {
        return `Array element at index ${i}: ${err}`;
      }
    }
  } else {
    return `Unsupported type: ${expectedType}`;
  }
  
  if (typeof arg === 'object' && !Array.isArray(arg)) {
      return `Objects are not allowed`; // Explicitly reject objects.
  }

  return null;
}

export function validateFunctionTestCases(functionContract: any, testCases: any[]): { isValid: boolean, issues: { path: string[], message: string }[] } {
  const issues: { path: string[], message: string }[] = [];

  if (!functionContract || !functionContract.parameters || !Array.isArray(functionContract.parameters)) {
    return { isValid: false, issues: [{ path: ['functionContract'], message: 'Missing or invalid function contract parameters' }] };
  }

  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i];
    if (!tc || typeof tc.input !== 'string') continue;

    let parsedInput: any;
    try {
      parsedInput = JSON.parse(tc.input);
    } catch (e) {
      issues.push({
        path: ['testCases', String(i), 'input'],
        message: 'TestCase.input must be valid JSON for FUNCTION execution mode'
      });
      continue;
    }

    if (!Array.isArray(parsedInput)) {
      issues.push({
        path: ['testCases', String(i), 'input'],
        message: 'Root value of TestCase.input must be a JSON array'
      });
      continue;
    }

    if (parsedInput.length !== functionContract.parameters.length) {
      issues.push({
        path: ['testCases', String(i), 'input'],
        message: `Argument count mismatch: expected ${functionContract.parameters.length}, got ${parsedInput.length}`
      });
      continue;
    }

    for (let p = 0; p < functionContract.parameters.length; p++) {
      const param = functionContract.parameters[p];
      const arg = parsedInput[p];
      
      const errorMsg = validateArgumentType(arg, param.type);
      if (errorMsg) {
        issues.push({
          path: ['testCases', String(i), 'input'],
          message: `Parameter '${param.name}' (type ${param.type}) is invalid: ${errorMsg}`
        });
      }
    }
  }

  return { isValid: issues.length === 0, issues };
}
