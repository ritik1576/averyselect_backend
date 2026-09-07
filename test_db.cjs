const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  const results = await prisma.result.findMany({ select: { sessionId: true, isPassed: true } });
  console.log(results);
}
run();
