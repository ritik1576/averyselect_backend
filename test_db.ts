import { prisma } from './src/lib/prisma.js';
async function runTest() {
  const sessionId = '7f516664-b9fd-47b0-8162-bcbbb42528a5'; // From the attempt output above
  const assessmentId = 'test-a1-v2';
  const data = await prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        attempts: {
          where: { question: { assessments: { some: { assessmentId } } } },
          include: {
            question: {
              include: {
                options: true,
                assessments: { where: { assessmentId }, select: { points: true } }
              }
            }
          }
        }
      }
    });
  console.log(JSON.stringify(data?.attempts, null, 2));
}
runTest().catch(console.error).finally(() => process.exit(0));
