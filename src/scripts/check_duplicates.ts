import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function checkDuplicates() {
  const duplicates = await prisma.$queryRaw`
    SELECT "sessionId", "questionId", COUNT(*) as count 
    FROM "question_attempts"
    GROUP BY "sessionId", "questionId"
    HAVING COUNT(*) > 1
  `;
  console.log(JSON.stringify(duplicates, null, 2));
}

checkDuplicates()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
