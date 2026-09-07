const fs = require('fs');
const path = 'src/modules/session/session.repository.ts';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(
  'prisma.session.count({ where: { ...countWhere, result: { isPassed: null } } }),',
  'prisma.session.count({ where: { ...countWhere, OR: [ { result: null }, { result: { isPassed: null } } ] } }),'
);

fs.writeFileSync(path, content);
