import { PrismaClient } from '@prisma/client';
import { PublicRepository } from '../modules/public/public.repository.js';

const prisma = new PrismaClient();
const publicRepository = new PublicRepository();

async function runTests() {
  console.log("=== QuestionAttempt Race Condition Tests ===");

  // Setup data
  const company = await prisma.company.create({ data: { name: 'Test Co' } });
  const candidate = await prisma.candidate.create({ data: { name: 'John', email: `john.${Math.random()}@test.com`, companyId: company.id } });
  const assessment = await prisma.assessment.create({
    data: {
      companyId: company.id,
      title: "Race Test Assessment",
      isPublished: true
    }
  });
  
  const questionA = await prisma.question.create({
    data: {
      title: "Question A", companyId: company.id,
      
      type: "CODING",
      points: 10, text: "Some text",
      difficulty: 1
    }
  });

  const questionB = await prisma.question.create({
    data: {
      title: "Question B", companyId: company.id,
      
      type: "CODING",
      points: 10, text: "Some text",
      difficulty: 1
    }
  });

  await prisma.assessmentQuestion.createMany({
    data: [
      { assessmentId: assessment.id, questionId: questionA.id, points: 10, orderIdx: 0 },
      { assessmentId: assessment.id, questionId: questionB.id, points: 10, orderIdx: 1 }
    ]
  });

  const session1 = await prisma.session.create({
    data: {
      assessmentId: assessment.id,
      candidateId: candidate.id,
      status: "STARTED"
    }
  });

  const session2 = await prisma.session.create({
    data: {
      assessmentId: assessment.id,
      candidateId: candidate.id,
      status: "STARTED"
    }
  });

  let failed = 0;

  try {
    // TEST 1: Concurrent Submissions for same sessionId + questionId
    const numSubmissions = 10;
    const promises = [];
    for (let i = 0; i < numSubmissions; i++) {
      promises.push(publicRepository.upsertQuestionAttempt(session1.id, questionA.id, `Answer ${i}`, 'javascript'));
    }

    const results = await Promise.allSettled(promises);
    
    // Ensure no unhandled exceptions if properly upserting
    const rejections = results.filter(r => r.status === 'rejected');
    if (rejections.length > 0) {
      console.error(`  [FAIL] Concurrent submissions threw ${rejections.length} errors`);
      failed++;
    } else {
      console.log(`  [PASS] Concurrent submissions completed without errors`);
    }

    // Verify only 1 row created
    const attempts = await prisma.questionAttempt.findMany({
      where: { sessionId: session1.id, questionId: questionA.id }
    });

    if (attempts.length === 1) {
      console.log(`  [PASS] Only 1 attempt row exists`);
    } else {
      console.error(`  [FAIL] Expected 1 attempt row, found ${attempts.length}`);
      failed++;
    }

    // TEST 2: Normal second submission updates existing attempt
    await publicRepository.upsertQuestionAttempt(session1.id, questionA.id, "Final Answer", "javascript");
    const updatedAttempts = await prisma.questionAttempt.findMany({
      where: { sessionId: session1.id, questionId: questionA.id }
    });
    
    if (updatedAttempts.length === 1 && updatedAttempts[0].answer === "Final Answer") {
      console.log(`  [PASS] Sequential submission updated existing row`);
    } else {
      console.error(`  [FAIL] Sequential submission failed to update or created duplicates`);
      failed++;
    }

    // TEST 3: Different question in same session gets own attempt
    await publicRepository.upsertQuestionAttempt(session1.id, questionB.id, "Answer B", "javascript");
    const session1Attempts = await prisma.questionAttempt.findMany({
      where: { sessionId: session1.id }
    });
    
    if (session1Attempts.length === 2) {
      console.log(`  [PASS] Different question in same session gets its own attempt`);
    } else {
      console.error(`  [FAIL] Expected 2 attempts in session1, found ${session1Attempts.length}`);
      failed++;
    }

    // TEST 4: Same question in different session gets own attempt
    await publicRepository.upsertQuestionAttempt(session2.id, questionA.id, "Answer A2", "javascript");
    const qAAttempts = await prisma.questionAttempt.findMany({
      where: { questionId: questionA.id }
    });

    if (qAAttempts.length === 2) {
      console.log(`  [PASS] Same question in different session gets its own attempt`);
    } else {
      console.error(`  [FAIL] Expected 2 attempts for question A, found ${qAAttempts.length}`);
      failed++;
    }

  } catch (e) {
    console.error("Test execution failed:", e);
    failed++;
  }

  // Cleanup
  await prisma.session.deleteMany({ where: { id: { in: [session1.id, session2.id] } } });
  await prisma.assessment.delete({ where: { id: assessment.id } });
  await prisma.question.deleteMany({ where: { id: { in: [questionA.id, questionB.id] } } });
  await prisma.candidate.delete({ where: { id: candidate.id } });
  await prisma.company.delete({ where: { id: company.id } });

  console.log(`\n=== Results: ${failed === 0 ? 'All Passed' : `${failed} Failed`} ===\n`);
  
  if (failed > 0) {
    process.exit(1);
  }
}

runTests()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
