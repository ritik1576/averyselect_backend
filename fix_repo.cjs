const fs = require('fs');
const path = 'src/modules/assessment/assessment.repository.ts';
let content = fs.readFileSync(path, 'utf8');

const oldCode = `        questions: data.questions ? {
          deleteMany: {},
          create: data.questions.map(q => ({
            questionId: q.questionId,
            orderIdx: q.orderIdx,
            points: q.points
          }))
        } : undefined,
      },`;

const newCode = `        questions: data.questions ? {
          deleteMany: {},
          create: data.questions.map(q => ({
            questionId: q.questionId,
            orderIdx: q.orderIdx,
            points: q.points
          }))
        } : undefined,
        securitySetting: (data as any).securitySetting ? {
          upsert: {
            create: (data as any).securitySetting,
            update: (data as any).securitySetting
          }
        } : undefined,
      },`;

content = content.replace(oldCode, newCode);
fs.writeFileSync(path, content);
