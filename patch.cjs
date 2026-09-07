const fs = require('fs');
const path = 'src/modules/assessment/assessment.controller.ts';
let content = fs.readFileSync(path, 'utf8');
content = content.replace(
  "const parseResult = updateAssessmentSchema.safeParse(req.body);",
  "console.log('Update Assessment Payload:', JSON.stringify(req.body, null, 2));\n    const parseResult = updateAssessmentSchema.safeParse(req.body);"
);
content = content.replace(
  "if (!parseResult.success) {",
  "if (!parseResult.success) {\n      console.log('Zod Error:', parseResult.error);"
);
content = content.replace(
  "const result = await assessmentService.updateAssessment(id, companyId, parseResult.data);",
  "console.log('Zod Parsed Data:', JSON.stringify(parseResult.data, null, 2));\n    const result = await assessmentService.updateAssessment(id, companyId, parseResult.data);"
);
fs.writeFileSync(path, content);
