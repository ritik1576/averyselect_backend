import os

file_path = "src/modules/grading/grading.service.ts"
with open(file_path, "r") as f:
    content = f.read()

# Fix Python wrapper
content = content.replace(
    'print("\\\\n---AGY_RESULT_DELIM---\\\\n" + (json.dumps(result) if isinstance(result, (dict, list, tuple)) else str(result).lower() if isinstance(result, bool) else str(result)), end=\'\')',
    'print("\\\\n---AGY_RESULT_DELIM---\\\\n" + json.dumps(result), end=\'\')'
)

# Fix JS wrapper
content = content.replace(
    'process.stdout.write("\\\\n---AGY_RESULT_DELIM---\\\\n" + (typeof result === \'object\' ? JSON.stringify(result) : String(result)));',
    'process.stdout.write("\\\\n---AGY_RESULT_DELIM---\\\\n" + JSON.stringify(result));'
)

# Fix comparator
old_comp = """        const expectedClean = tc.expectedOutput.trim();
        const isMatch = cleanOutput === expectedClean || cleanOutput.includes(expectedClean);
        if (isSuccess && isMatch) {"""

new_comp = """        const expectedClean = tc.expectedOutput.trim();
        let isMatch = false;
        
        let expectedObj, actualObj;
        try { expectedObj = JSON.parse(expectedClean); } catch(e) { expectedObj = expectedClean; }
        try { actualObj = JSON.parse(cleanOutput); } catch(e) { actualObj = cleanOutput; }
        
        isMatch = JSON.stringify(expectedObj) === JSON.stringify(actualObj);

        if (isSuccess && isMatch) {"""

content = content.replace(old_comp, new_comp)

with open(file_path, "w") as f:
    f.write(content)

print("Updated grading.service.ts")
