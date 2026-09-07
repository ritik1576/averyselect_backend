const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  const where = {};
  const [total, toReview] = await Promise.all([
    prisma.session.count({ where }),
    prisma.session.count({ where: { ...where, OR: [ { result: null }, { result: { isPassed: null } } ] } }),
  ]);
  console.log({ total, toReview });
}
run();
