const fs = require('fs');
const path = 'src/modules/public/public.repository.ts';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(
  'company: true',
  'company: true,\n            securitySetting: true'
);

fs.writeFileSync(path, content);
