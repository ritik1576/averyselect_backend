import { prisma } from '../lib/prisma.js';
import { publicService } from '../modules/public/public.service.js';
import { AppError } from '../utils/AppError.js';
import { QuestionType, SessionStatus } from '@prisma/client';


import { executionEngine } from '../modules/execution/execution.engine.js';
executionEngine.execute = async () => ({ status: 'PASSED', testCaseResults: [], passCount: 0, totalCount: 0, output: '', executionTimeMs: 0 });

async function runTests() {
  console.log('--- Setting up test data ---');
  
  // Create Company A & B
  const compA = await prisma.company.create({ data: { name: 'Test Company A' } });
  const compB = await prisma.company.create({ data: { name: 'Test Company B' } });
  
  // Create Assessment A (for Comp A) & Assessment B (for Comp B)
  const asstA = await prisma.assessment.create({ data: { companyId: compA.id, title: 'Asst A' } });
  const asstB = await prisma.assessment.create({ data: { companyId: compB.id, title: 'Asst B' } });
  
  // Create Question A & B
  const qA = await prisma.question.create({
    data: { companyId: compA.id, title: 'QA', text: 'QA text', type: QuestionType.CODING, questionLanguages: { create: { language: { connectOrCreate: { where: { name: 'javascript' }, create: { name: 'javascript' } } } } } }
  });
  const qB = await prisma.question.create({
    data: { companyId: compB.id, title: 'QB', text: 'QB text', type: QuestionType.CODING, questionLanguages: { create: { language: { connectOrCreate: { where: { name: 'javascript' }, create: { name: 'javascript' } } } } } }
  });
  const qDeleted = await prisma.question.create({
    data: { companyId: compA.id, title: 'QD', text: 'QD text', type: QuestionType.CODING, questionLanguages: { create: { language: { connectOrCreate: { where: { name: 'javascript' }, create: { name: 'javascript' } } } } }, deletedAt: new Date() }
  });
  
  // Link Qs to Assessments
  await prisma.assessmentQuestion.create({ data: { assessmentId: asstA.id, questionId: qA.id, orderIdx: 1, points: 10 } });
  await prisma.assessmentQuestion.create({ data: { assessmentId: asstA.id, questionId: qDeleted.id, orderIdx: 2, points: 10 } });
  await prisma.assessmentQuestion.create({ data: { assessmentId: asstB.id, questionId: qB.id, orderIdx: 1, points: 10 } });
  
  // Create Candidate & Session for Assessment A
  const cand = await prisma.candidate.create({ data: { companyId: compA.id, name: 'C1', email: 'c1@test.com' } });
  const sessionA = await prisma.session.create({ data: { candidateId: cand.id, assessmentId: asstA.id, status: SessionStatus.STARTED } });
  
  let passed = 0;
  let failed = 0;
  
  async function expectSuccess(name: string, fn: () => Promise<any>) {
    try {
      await fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (e: any) {
      console.log(`[FAIL] ${name} - Unexpected error: ${e.message}`);
      failed++;
    }
  }

  async function expectRejection(name: string, fn: () => Promise<any>) {
    try {
      await fn();
      console.log(`[FAIL] ${name} - Expected rejection but succeeded`);
      failed++;
    } catch (e: any) {
      if (e.statusCode === 404 || e.message.includes('not found')) {
        console.log(`[PASS] ${name}`);
        passed++;
      } else {
        console.log(`[FAIL] ${name} - Rejected with wrong error: ${e.message}`);
        failed++;
      }
    }
  }

  // NOTE: runCode relies on ExecutionEngine which needs valid Judge0 etc.
  // Wait, runCode checks DB first, if it fails it throws. If it passes DB check, it will try ExecutionEngine.
  // Since we don't have code, it might fail ExecutionEngine.
  // Actually, we can just test the DB fetch part by stubbing ExecutionEngine or letting it fail with another error.
  
  // For submitAttempt, it just writes to DB.
  
  await expectSuccess('TEST 1 & 5: Candidate for Asst A attempts to submit Question A (active)', async () => {
    await publicService.submitAttempt(sessionA.id, qA.id, 'my answer', 'javascript');
  });

  await expectRejection('TEST 2 & 6: Candidate for Asst A attempts to submit Question B (from Asst B)', async () => {
    await publicService.submitAttempt(sessionA.id, qB.id, 'my answer', 'javascript');
  });

  await expectRejection('TEST 4: Candidate for Asst A attempts to submit Question Deleted', async () => {
    await publicService.submitAttempt(sessionA.id, qDeleted.id, 'my answer', 'javascript');
  });
  

  await expectSuccess('TEST 1 & 5: Candidate for Asst A requests Question A (active) for runCode', async () => {
    await publicService.runCode(sessionA.id, qA.id, 'my code', 'javascript');
  });

  await expectRejection('TEST 2 & 6: Candidate for Asst A requests Question B (from Asst B) for runCode', async () => {
    await publicService.runCode(sessionA.id, qB.id, 'my code', 'javascript');
  });

  await expectRejection('TEST 4: Candidate for Asst A requests Question Deleted for runCode', async () => {
    await publicService.runCode(sessionA.id, qDeleted.id, 'my code', 'javascript');
  });

  // Cleanup
  console.log('--- Cleaning up ---');
  await prisma.session.delete({ where: { id: sessionA.id } });
  await prisma.candidate.delete({ where: { id: cand.id } });
  await prisma.assessmentQuestion.deleteMany({ where: { assessmentId: { in: [asstA.id, asstB.id] } } });
  await prisma.question.deleteMany({ where: { id: { in: [qA.id, qB.id, qDeleted.id] } } });
  await prisma.assessment.deleteMany({ where: { id: { in: [asstA.id, asstB.id] } } });
  await prisma.company.deleteMany({ where: { id: { in: [compA.id, compB.id] } } });

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests().catch(e => {
  console.error(e);
  process.exit(1);
});
