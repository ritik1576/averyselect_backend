import { prisma } from '../lib/prisma.js';
import { gradingService } from '../modules/grading/grading.service.js';
import { QuestionType, SessionStatus } from '@prisma/client';

// ---- Helpers ----------------------------------------------------------------

let passed = 0;
let failed = 0;

function assert(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  [PASS] ${name}`);
    passed++;
  } else {
    console.log(`  [FAIL] ${name}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

async function makeWorld() {
  const company = await prisma.company.create({ data: { name: `GradingTestCo_${Date.now()}` } });
  return company;
}

async function teardown(ids: {
  sessionIds?: string[];
  candidateIds?: string[];
  attemptIds?: string[];
  aqIds?: Array<{ assessmentId: string; questionId: string }>;
  questionIds?: string[];
  assessmentIds?: string[];
  companyIds?: string[];
}) {
  if (ids.sessionIds?.length) {
    // result rows cascade from session; delete results first
    await prisma.result.deleteMany({ where: { sessionId: { in: ids.sessionIds } } });
    await prisma.session.deleteMany({ where: { id: { in: ids.sessionIds } } });
  }
  if (ids.candidateIds?.length) await prisma.candidate.deleteMany({ where: { id: { in: ids.candidateIds } } });
  if (ids.aqIds?.length) {
    for (const aq of ids.aqIds)
      await prisma.assessmentQuestion.deleteMany({ where: { assessmentId: aq.assessmentId, questionId: aq.questionId } });
  }
  if (ids.questionIds?.length) await prisma.question.deleteMany({ where: { id: { in: ids.questionIds } } });
  if (ids.assessmentIds?.length) await prisma.assessment.deleteMany({ where: { id: { in: ids.assessmentIds } } });
  if (ids.companyIds?.length) await prisma.company.deleteMany({ where: { id: { in: ids.companyIds } } });
}

// ---- TEST 1: Rogue attempt must not contribute to score ----------------------

async function test1_rogueAttemptIgnored() {
  console.log('\nTEST 1: Rogue attempt ignored during grading');
  const company = await makeWorld();

  // Two assessments, two questions
  const asstA = await prisma.assessment.create({ data: { companyId: company.id, title: 'Asst A' } });
  const asstB = await prisma.assessment.create({ data: { companyId: company.id, title: 'Asst B' } });

  const qA = await prisma.question.create({
    data: { companyId: company.id, title: 'QA', text: 'q', type: QuestionType.MULTIPLE_CHOICE, points: 1 }
  });
  const qB = await prisma.question.create({
    data: { companyId: company.id, title: 'QB', text: 'q', type: QuestionType.MULTIPLE_CHOICE, points: 1 }
  });

  const optA = await prisma.option.create({ data: { questionId: qA.id, text: 'Correct A', isCorrect: true } });
  const optB = await prisma.option.create({ data: { questionId: qB.id, text: 'Correct B', isCorrect: true } });

  // qA belongs to asstA (points=10), qB belongs to asstB (points=10)
  await prisma.assessmentQuestion.create({ data: { assessmentId: asstA.id, questionId: qA.id, orderIdx: 1, points: 10 } });
  await prisma.assessmentQuestion.create({ data: { assessmentId: asstB.id, questionId: qB.id, orderIdx: 1, points: 10 } });

  const cand = await prisma.candidate.create({ data: { companyId: company.id, name: 'C', email: `c_t1_${Date.now()}@test.com` } });
  const session = await prisma.session.create({
    data: { candidateId: cand.id, assessmentId: asstA.id, status: SessionStatus.COMPLETED }
  });

  // Legitimate attempt for qA
  await prisma.questionAttempt.create({
    data: { sessionId: session.id, questionId: qA.id, answer: optA.id, status: 'SUBMITTED' }
  });
  // Rogue attempt: directly injected, qB does NOT belong to asstA
  await prisma.questionAttempt.create({
    data: { sessionId: session.id, questionId: qB.id, answer: optB.id, status: 'SUBMITTED' }
  });

  await gradingService.executeGrading(session.id);
  await new Promise(r => setTimeout(r, 200)); // let grading settle

  const result = await prisma.result.findUnique({ where: { sessionId: session.id } });
  const questionResults = await prisma.questionResult.findMany({ where: { resultId: result!.id } });

  assert('Result exists', !!result);
  assert('Only 1 question result (rogue excluded)', questionResults.length === 1, `got ${questionResults.length}`);
  assert('maxScore = 10 (qA only, AssessmentQuestion.points)', result!.maxScore === 10, `got ${result!.maxScore}`);
  assert('totalScore = 10 (qA correct)', result!.totalScore === 10, `got ${result!.totalScore}`);
  assert('QB did not appear in question results', !questionResults.some(qr => qr.questionId === qB.id));

  await teardown({
    sessionIds: [session.id],
    candidateIds: [cand.id],
    aqIds: [{ assessmentId: asstA.id, questionId: qA.id }, { assessmentId: asstB.id, questionId: qB.id }],
    questionIds: [qA.id, qB.id],
    assessmentIds: [asstA.id, asstB.id],
    companyIds: [company.id],
  });
}

// ---- TEST 2: AssessmentQuestion.points used, not Question.points -------------

async function test2_assessmentPoints() {
  console.log('\nTEST 2: AssessmentQuestion.points used (not Question.points)');
  const company = await makeWorld();

  const asst = await prisma.assessment.create({ data: { companyId: company.id, title: 'Asst' } });
  // Question.points = 1, AssessmentQuestion.points = 20
  const q = await prisma.question.create({
    data: { companyId: company.id, title: 'Q', text: 'q', type: QuestionType.MULTIPLE_CHOICE, points: 1 }
  });
  const optCorrect = await prisma.option.create({ data: { questionId: q.id, text: 'Correct', isCorrect: true } });
  await prisma.assessmentQuestion.create({ data: { assessmentId: asst.id, questionId: q.id, orderIdx: 1, points: 20 } });

  const cand = await prisma.candidate.create({ data: { companyId: company.id, name: 'C', email: `c_t2_${Date.now()}@test.com` } });
  const session = await prisma.session.create({
    data: { candidateId: cand.id, assessmentId: asst.id, status: SessionStatus.COMPLETED }
  });
  await prisma.questionAttempt.create({
    data: { sessionId: session.id, questionId: q.id, answer: optCorrect.id, status: 'SUBMITTED' }
  });

  await gradingService.executeGrading(session.id);
  await new Promise(r => setTimeout(r, 200));

  const result = await prisma.result.findUnique({ where: { sessionId: session.id } });

  assert('Result exists', !!result);
  assert('maxScore = 20 (AssessmentQuestion.points)', result!.maxScore === 20, `got ${result!.maxScore}`);
  assert('totalScore = 20 (correct answer)', result!.totalScore === 20, `got ${result!.totalScore}`);
  assert('NOT maxScore = 1 (Question.points default)', result!.maxScore !== 1);

  await teardown({
    sessionIds: [session.id],
    candidateIds: [cand.id],
    aqIds: [{ assessmentId: asst.id, questionId: q.id }],
    questionIds: [q.id],
    assessmentIds: [asst.id],
    companyIds: [company.id],
  });
}

// ---- TEST 3: Different assessments use different points ---------------------

async function test3_perAssessmentPoints() {
  console.log('\nTEST 3: Per-assessment points (same question, two assessments)');
  const company = await makeWorld();

  const asstA = await prisma.assessment.create({ data: { companyId: company.id, title: 'A' } });
  const asstB = await prisma.assessment.create({ data: { companyId: company.id, title: 'B' } });

  const q = await prisma.question.create({
    data: { companyId: company.id, title: 'Q', text: 'q', type: QuestionType.MULTIPLE_CHOICE, points: 1 }
  });
  const optCorrect = await prisma.option.create({ data: { questionId: q.id, text: 'Correct', isCorrect: true } });

  await prisma.assessmentQuestion.create({ data: { assessmentId: asstA.id, questionId: q.id, orderIdx: 1, points: 20 } });
  await prisma.assessmentQuestion.create({ data: { assessmentId: asstB.id, questionId: q.id, orderIdx: 1, points: 5 } });

  const cand = await prisma.candidate.create({ data: { companyId: company.id, name: 'C', email: `c_t3_${Date.now()}@test.com` } });
  const sessA = await prisma.session.create({ data: { candidateId: cand.id, assessmentId: asstA.id, status: SessionStatus.COMPLETED } });
  const sessB = await prisma.session.create({ data: { candidateId: cand.id, assessmentId: asstB.id, status: SessionStatus.COMPLETED } });

  await prisma.questionAttempt.create({ data: { sessionId: sessA.id, questionId: q.id, answer: optCorrect.id, status: 'SUBMITTED' } });
  await prisma.questionAttempt.create({ data: { sessionId: sessB.id, questionId: q.id, answer: optCorrect.id, status: 'SUBMITTED' } });

  await gradingService.executeGrading(sessA.id);
  await gradingService.executeGrading(sessB.id);
  await new Promise(r => setTimeout(r, 200));

  const resA = await prisma.result.findUnique({ where: { sessionId: sessA.id } });
  const resB = await prisma.result.findUnique({ where: { sessionId: sessB.id } });

  assert('Session A: maxScore = 20', resA!.maxScore === 20, `got ${resA!.maxScore}`);
  assert('Session A: totalScore = 20', resA!.totalScore === 20, `got ${resA!.totalScore}`);
  assert('Session B: maxScore = 5', resB!.maxScore === 5, `got ${resB!.maxScore}`);
  assert('Session B: totalScore = 5', resB!.totalScore === 5, `got ${resB!.totalScore}`);

  await teardown({
    sessionIds: [sessA.id, sessB.id],
    candidateIds: [cand.id],
    aqIds: [{ assessmentId: asstA.id, questionId: q.id }, { assessmentId: asstB.id, questionId: q.id }],
    questionIds: [q.id],
    assessmentIds: [asstA.id, asstB.id],
    companyIds: [company.id],
  });
}

// ---- TEST 4: Legitimate session grades correctly (regression) ---------------

async function test4_legitimateSession() {
  console.log('\nTEST 4: Legitimate session grades correctly (regression)');
  const company = await makeWorld();
  const asst = await prisma.assessment.create({ data: { companyId: company.id, title: 'Asst' } });
  const qRight = await prisma.question.create({ data: { companyId: company.id, title: 'Q1', text: 'q', type: QuestionType.MULTIPLE_CHOICE, points: 1 } });
  const qWrong = await prisma.question.create({ data: { companyId: company.id, title: 'Q2', text: 'q', type: QuestionType.MULTIPLE_CHOICE, points: 1 } });
  const optRight = await prisma.option.create({ data: { questionId: qRight.id, text: 'Correct', isCorrect: true } });
  const optWrongA = await prisma.option.create({ data: { questionId: qWrong.id, text: 'Wrong', isCorrect: false } });
  await prisma.option.create({ data: { questionId: qWrong.id, text: 'Correct W', isCorrect: true } });
  await prisma.assessmentQuestion.create({ data: { assessmentId: asst.id, questionId: qRight.id, orderIdx: 1, points: 10 } });
  await prisma.assessmentQuestion.create({ data: { assessmentId: asst.id, questionId: qWrong.id, orderIdx: 2, points: 10 } });

  const cand = await prisma.candidate.create({ data: { companyId: company.id, name: 'C', email: `c_t4_${Date.now()}@test.com` } });
  const session = await prisma.session.create({ data: { candidateId: cand.id, assessmentId: asst.id, status: SessionStatus.COMPLETED } });
  await prisma.questionAttempt.create({ data: { sessionId: session.id, questionId: qRight.id, answer: optRight.id, status: 'SUBMITTED' } });
  await prisma.questionAttempt.create({ data: { sessionId: session.id, questionId: qWrong.id, answer: optWrongA.id, status: 'SUBMITTED' } });

  await gradingService.executeGrading(session.id);
  await new Promise(r => setTimeout(r, 200));

  const result = await prisma.result.findUnique({ where: { sessionId: session.id } });
  const qResults = await prisma.questionResult.findMany({ where: { resultId: result!.id } });

  assert('Result exists', !!result);
  assert('maxScore = 20 (two questions × 10)', result!.maxScore === 20, `got ${result!.maxScore}`);
  assert('totalScore = 10 (one correct)', result!.totalScore === 10, `got ${result!.totalScore}`);
  assert('percentage = 50', Math.abs(result!.percentage - 50) < 0.01, `got ${result!.percentage}`);
  assert('2 question results', qResults.length === 2, `got ${qResults.length}`);

  await teardown({
    sessionIds: [session.id],
    candidateIds: [cand.id],
    aqIds: [{ assessmentId: asst.id, questionId: qRight.id }, { assessmentId: asst.id, questionId: qWrong.id }],
    questionIds: [qRight.id, qWrong.id],
    assessmentIds: [asst.id],
    companyIds: [company.id],
  });
}

// ---- TEST 5: Session with no attempts ----------------------------------------

async function test5_noAttempts() {
  console.log('\nTEST 5: Session with no attempts (no crash, totalScore=0)');
  const company = await makeWorld();
  const asst = await prisma.assessment.create({ data: { companyId: company.id, title: 'Asst' } });
  const cand = await prisma.candidate.create({ data: { companyId: company.id, name: 'C', email: `c_t5_${Date.now()}@test.com` } });
  const session = await prisma.session.create({ data: { candidateId: cand.id, assessmentId: asst.id, status: SessionStatus.COMPLETED } });

  let threw = false;
  try {
    await gradingService.executeGrading(session.id);
    await new Promise(r => setTimeout(r, 200));
  } catch (e) {
    threw = true;
  }

  const result = await prisma.result.findUnique({ where: { sessionId: session.id } });

  assert('No exception thrown', !threw);
  assert('Result created', !!result);
  assert('totalScore = 0', result!.totalScore === 0, `got ${result!.totalScore}`);
  assert('maxScore = 0', result!.maxScore === 0, `got ${result!.maxScore}`);

  await teardown({
    sessionIds: [session.id],
    candidateIds: [cand.id],
    assessmentIds: [asst.id],
    companyIds: [company.id],
  });
}


// ---- TEST C: Missing AssessmentQuestion -> grading skips, NOT fallback to Question.points ---

async function testC_missingAQFails() {
  console.log('\nTEST C: Missing AssessmentQuestion -> attempt skipped, Question.points NOT used');
  const company = await makeWorld();
  const asst = await prisma.assessment.create({ data: { companyId: company.id, title: 'Asst' } });

  // Question.points = 99 — should NEVER appear in the result if AQ row is missing
  const q = await prisma.question.create({
    data: { companyId: company.id, title: 'Q', text: 'q', type: QuestionType.MULTIPLE_CHOICE, points: 99 }
  });
  const optCorrect = await prisma.option.create({ data: { questionId: q.id, text: 'Correct', isCorrect: true } });

  // Deliberately DO NOT create an AssessmentQuestion row (simulates data corruption)
  // We still need to link the question to the assessment for the attempt auth check,
  // but here we test the grading path directly by inserting the attempt raw.

  const cand = await prisma.candidate.create({ data: { companyId: company.id, name: 'C', email: `c_tc_${Date.now()}@test.com` } });
  const session = await prisma.session.create({
    data: { candidateId: cand.id, assessmentId: asst.id, status: SessionStatus.COMPLETED }
  });

  // Insert attempt directly (bypassing auth — we're testing grading, not submission)
  // We also need an AQ row so the authorization filter in getUnscoredSessionData
  // includes this attempt. Then we delete the AQ row to simulate post-insert corruption.
  await prisma.assessmentQuestion.create({ data: { assessmentId: asst.id, questionId: q.id, orderIdx: 1, points: 20 } });
  await prisma.questionAttempt.create({
    data: { sessionId: session.id, questionId: q.id, answer: optCorrect.id, status: 'SUBMITTED' }
  });
  // Now delete the AQ row to simulate missing configuration at grading time
  await prisma.assessmentQuestion.delete({ where: { assessmentId_questionId: { assessmentId: asst.id, questionId: q.id } } });

  // Grading should log an error but not crash, and not use Question.points=99
  let threw = false;
  try {
    await gradingService.executeGrading(session.id);
    await new Promise(r => setTimeout(r, 200));
  } catch (e) {
    threw = true;
  }

  const result = await prisma.result.findUnique({ where: { sessionId: session.id } });

  assert('TEST C.1: No unhandled exception', !threw);
  assert('TEST C.2: Result created', !!result);
  assert('TEST C.3: totalScore is 0 (attempt skipped)', result!.totalScore === 0, `got ${result!.totalScore}`);
  assert('TEST C.4: maxScore is 0 (attempt skipped)', result!.maxScore === 0, `got ${result!.maxScore}`);
  assert('TEST C.5: Question.points=99 NOT used as fallback', result!.maxScore !== 99 && result!.totalScore !== 99);

  await teardown({
    sessionIds: [session.id],
    candidateIds: [cand.id],
    questionIds: [q.id],
    assessmentIds: [asst.id],
    companyIds: [company.id],
  });
}

// ---- Runner -----------------------------------------------------------------

async function main() {
  console.log('=== Grading Integrity Test Suite ===\n');
  await test1_rogueAttemptIgnored();
  await test2_assessmentPoints();
  await test3_perAssessmentPoints();
  await test4_legitimateSession();
  await test5_noAttempts();
  await testC_missingAQFails();
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
