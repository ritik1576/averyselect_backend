import { PrismaClient } from '@prisma/client';
import { gradingRepository } from '../modules/grading/grading.repository.js';
import { gradingService } from '../modules/grading/grading.service.js';

const prisma = new PrismaClient();

let passed = 0;
let failed = 0;

function assert(desc: string, condition: boolean) {
  if (condition) { console.log(`  [PASS] ${desc}`); passed++; }
  else { console.error(`  [FAIL] ${desc}`); failed++; }
}

async function cleanSession(ids: { sessionIds: string[]; assessmentId: string; questionId: string; candidateId: string; companyId: string }) {
  for (const sid of ids.sessionIds) await prisma.session.delete({ where: { id: sid } }).catch(() => {});
  await prisma.assessment.delete({ where: { id: ids.assessmentId } }).catch(() => {});
  await prisma.question.delete({ where: { id: ids.questionId } }).catch(() => {});
  await prisma.candidate.delete({ where: { id: ids.candidateId } }).catch(() => {});
  await prisma.company.delete({ where: { id: ids.companyId } }).catch(() => {});
}

async function runTests() {
  console.log('=== Passing Percentage Tests ===\n');

  // ----------------------------------------------------------------
  // 1. Verify no hardcoded 70 remains in grading module
  // ----------------------------------------------------------------
  const { execSync } = await import('child_process');
  const grep70 = execSync(
    "grep -rn 'percentage >= 70\\|>= 70' src/modules/grading/ || true",
    { cwd: '/Users/mindshine/Desktop/ritworkspace/averyselect_backend', encoding: 'utf8' }
  ).trim();
  assert('No hardcoded "percentage >= 70" in grading module', grep70 === '');

  // ----------------------------------------------------------------
  // 2. Direct finalizeResult() boundary tests (covers exact examples from spec)
  // ----------------------------------------------------------------
  console.log('\n--- Direct finalizeResult boundary tests ---');
  const co = await prisma.company.create({ data: { name: `Co-${Date.now()}` } });
  const ca = await prisma.candidate.create({ data: { name: 'D', email: `d.${Math.random()}@t.com`, companyId: co.id } });
  const as = await prisma.assessment.create({ data: { companyId: co.id, title: 'A', passingPercentage: 60 } });
  const se = await prisma.session.create({ data: { assessmentId: as.id, candidateId: ca.id } });
  const re = await prisma.result.create({ data: { sessionId: se.id, totalScore: 0, maxScore: 0, percentage: 0 } });

  const cases: [number, number, number, boolean][] = [
    // [totalScore, maxScore, passingPct, expectedPassed]
    [60, 100, 60,   true],   // spec case 1
    [59.99, 100, 60, false], // spec case 2
    [70, 100, 70,   true],   // spec case 3
    [69.99, 100, 70, false], // spec case 4
    [75, 100, 80,   false],  // spec case 5
    [55, 100, 50,   true],   // spec case 6
  ];
  for (const [ts, ms, pp, exp] of cases) {
    await gradingRepository.finalizeResult(re.id, ts, ms, pp);
    const r = await prisma.result.findUnique({ where: { id: re.id } });
    const pct = (ts / ms) * 100;
    assert(`${ts}/${ms} (${pct.toFixed(2)}%) with passing=${pp} → ${exp ? 'PASSED' : 'FAILED'}`, r?.isPassed === exp);
  }

  // cleanup direct test rows
  await prisma.result.delete({ where: { id: re.id } });
  await prisma.session.delete({ where: { id: se.id } });
  await prisma.assessment.delete({ where: { id: as.id } });
  await prisma.candidate.delete({ where: { id: ca.id } });
  await prisma.company.delete({ where: { id: co.id } });

  // ----------------------------------------------------------------
  // 3. Integration — passingPercentage comes from Assessment, not candidate
  // ----------------------------------------------------------------
  console.log('\n--- Integration: threshold read from DB Assessment ---');
  {
    const company = await prisma.company.create({ data: { name: `Co2-${Date.now()}` } });
    const candidate = await prisma.candidate.create({ data: { name: 'X', email: `x.${Math.random()}@t.com`, companyId: company.id } });
    const question = await prisma.question.create({
      data: { title: 'Q', text: 'desc', type: 'MULTIPLE_CHOICE', points: 10, difficulty: 1, companyId: company.id }
    });
    const correctOpt = await prisma.option.create({ data: { questionId: question.id, text: 'Correct', isCorrect: true } });

    // Create assessment with passing=100 → score=100% → PASSED
    const assessment = await prisma.assessment.create({
      data: { companyId: company.id, title: 'Asst', passingPercentage: 100 }
    });
    await prisma.assessmentQuestion.create({ data: { assessmentId: assessment.id, questionId: question.id, points: 10, orderIdx: 0 } });
    const session1 = await prisma.session.create({ data: { assessmentId: assessment.id, candidateId: candidate.id, status: 'COMPLETED' } });
    await prisma.questionAttempt.create({ data: { sessionId: session1.id, questionId: question.id, answer: correctOpt.id, status: 'SUBMITTED' } });
    await gradingService.executeGrading(session1.id);
    const r1 = await prisma.result.findUnique({ where: { sessionId: session1.id } });
    assert('Test 7: passingPct=100, score=100% → PASSED (not FAILED)', r1?.isPassed === true);

    // Now change the threshold to 101 (impossible to pass)
    await prisma.assessment.update({ where: { id: assessment.id }, data: { passingPercentage: 101 } });
    const session2 = await prisma.session.create({ data: { assessmentId: assessment.id, candidateId: candidate.id, status: 'COMPLETED' } });
    await prisma.questionAttempt.create({ data: { sessionId: session2.id, questionId: question.id, answer: correctOpt.id, status: 'SUBMITTED' } });
    await gradingService.executeGrading(session2.id);
    const r2 = await prisma.result.findUnique({ where: { sessionId: session2.id } });
    assert('Test 8: After changing passingPct=101, score=100% → FAILED', r2?.isPassed === false);

    await cleanSession({ sessionIds: [session1.id, session2.id], assessmentId: assessment.id, questionId: question.id, candidateId: candidate.id, companyId: company.id });
  }

  // ----------------------------------------------------------------
  // 4. NULL passingPercentage falls back to 60 (the application default)
  // ----------------------------------------------------------------
  console.log('\n--- NULL passingPercentage falls back to 60 ---');
  {
    const company = await prisma.company.create({ data: { name: `Co3-${Date.now()}` } });
    const candidate = await prisma.candidate.create({ data: { name: 'Y', email: `y.${Math.random()}@t.com`, companyId: company.id } });
    const question = await prisma.question.create({
      data: { title: 'Q3', text: 'desc', type: 'MULTIPLE_CHOICE', points: 10, difficulty: 1, companyId: company.id }
    });
    const correctOpt = await prisma.option.create({ data: { questionId: question.id, text: 'Correct', isCorrect: true } });
    const assessment = await prisma.assessment.create({ data: { companyId: company.id, title: 'A3', passingPercentage: null } });
    await prisma.assessmentQuestion.create({ data: { assessmentId: assessment.id, questionId: question.id, points: 10, orderIdx: 0 } });

    // score=100% with null passingPercentage → fallback=60 → PASSED
    const session1 = await prisma.session.create({ data: { assessmentId: assessment.id, candidateId: candidate.id, status: 'COMPLETED' } });
    await prisma.questionAttempt.create({ data: { sessionId: session1.id, questionId: question.id, answer: correctOpt.id, status: 'SUBMITTED' } });
    await gradingService.executeGrading(session1.id);
    const r1 = await prisma.result.findUnique({ where: { sessionId: session1.id } });
    assert('Test 10a: NULL passing → fallback=60, score=100% → PASSED', r1?.isPassed === true);

    // score=0% with null passingPercentage → fallback=60 → FAILED
    const session2 = await prisma.session.create({ data: { assessmentId: assessment.id, candidateId: candidate.id, status: 'COMPLETED' } });
    await prisma.questionAttempt.create({ data: { sessionId: session2.id, questionId: question.id, answer: 'wrong', status: 'SUBMITTED' } });
    await gradingService.executeGrading(session2.id);
    const r2 = await prisma.result.findUnique({ where: { sessionId: session2.id } });
    assert('Test 10b: NULL passing → fallback=60, score=0% → FAILED', r2?.isPassed === false);

    await cleanSession({ sessionIds: [session1.id, session2.id], assessmentId: assessment.id, questionId: question.id, candidateId: candidate.id, companyId: company.id });
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
}

runTests()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
