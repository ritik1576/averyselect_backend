const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  const where = {};
  const [total, passed, rejected, toReview] = await Promise.all([
    prisma.session.count({ where }),
    prisma.session.count({ where: { ...where, result: { isPassed: true } } }),
    prisma.session.count({ where: { ...where, result: { isPassed: false } } }),
    prisma.session.count({ where: { ...where, result: { isPassed: null } } }),
  ]);
  console.log({ total, passed, rejected, toReview });
}
run();
