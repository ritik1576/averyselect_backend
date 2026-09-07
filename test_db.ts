import './src/config/env.ts';
import { prisma } from './src/lib/prisma.ts';

async function run() {
  const session = await prisma.session.findFirst({
    where: { candidateEmail: 'ritikchaudhary1576@gmail.com' },
    orderBy: { createdAt: 'desc' },
    include: {
      questionAttempts: {
        include: { question: { include: { testCases: true } } }
      }
    }
  });

  if (!session) {
    console.log("Session not found");
    return;
  }

  console.log("Session ID:", session.id);
  console.log("Score:", session.score, "/", session.maxScore);

  for (const qa of session.questionAttempts) {
    console.log(`\nQuestion: ${qa.question.title}`);
    console.log(`Score: ${qa.score}`);
    console.log(`Answer:\n${qa.answer}`);
    console.log("Test Cases:");
    for (const tc of qa.question.testCases) {
      console.log(`  Input: ${tc.input} | Expected: ${tc.expectedOutput}`);
    }
  }
}

run().catch(console.error).finally(() => prisma.$disconnect());
