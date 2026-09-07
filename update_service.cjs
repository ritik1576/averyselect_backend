const fs = require('fs');
const path = 'src/modules/public/public.service.ts';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(
  'assessmentId: link.assessment.id',
  'assessmentId: link.assessment.id,\n      securitySetting: link.assessment.securitySetting'
);

fs.writeFileSync(path, content);
