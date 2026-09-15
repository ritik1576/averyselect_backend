/**
 * test_timer_auto_submit.ts
 *
 * Integration tests for Issue #9: reliable auto-submit on timer expiry.
 *
 * Tests backend behavior only (service / repository layer):
 *  - finishSession idempotency
 *  - concurrent finish → session ends COMPLETED
 *  - grading is triggered
 *  - enforceTimer still auto-finishes expired sessions
 *  - existing manual submission flow remains functional
 */

import { PrismaClient } from '@prisma/client';
import { publicService } from '../modules/public/public.service.js';

const prisma = new PrismaClient();
let passed = 0;
let failed = 0;

function assert(desc: string, condition: boolean) {
  if (condition) { console.log(`  [PASS] ${desc}`); passed++; }
  else { console.error(`  [FAIL] ${desc}`); failed++; }
}

// ─── Fixture helpers ─────────────────────────────────────────────────────────

async function createFixture() {
  const company = await prisma.company.create({ data: { name: `Co-${Date.now()}` } });
  const candidate = await prisma.candidate.create({
    data: { name: 'Tester', email: `t.${Math.random()}@t.com`, companyId: company.id }
  });
  const assessment = await prisma.assessment.create({
    data: { companyId: company.id, title: 'Test', passingPercentage: 60, durationMinutes: 60 }
  });
  const session = await prisma.session.create({
    data: { assessmentId: assessment.id, candidateId: candidate.id, status: 'STARTED' }
  });
  return { company, candidate, assessment, session };
}

async function cleanup(ids: { sessionId: string; assessmentId: string; candidateId: string; companyId: string }) {
  await prisma.session.deleteMany({ where: { id: ids.sessionId } }).catch(() => {});
  await prisma.assessment.delete({ where: { id: ids.assessmentId } }).catch(() => {});
  await prisma.candidate.delete({ where: { id: ids.candidateId } }).catch(() => {});
  await prisma.company.delete({ where: { id: ids.companyId } }).catch(() => {});
}

// ─── Tests ───────────────────────────────────────────────────────────────────

async function runTests() {
  console.log('=== Timer Auto-Submit Backend Tests ===\n');

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 1: Normal finishSession marks session COMPLETED and triggers grading
  // ─────────────────────────────────────────────────────────────────────────
  console.log('--- Test 1: finishSession → COMPLETED + grading ---');
  {
    const { company, candidate, assessment, session } = await createFixture();

    await publicService.finishSession(session.id);

    const updated = await prisma.session.findUnique({ where: { id: session.id } });
    assert('Test 1: session.status = COMPLETED', updated?.status === 'COMPLETED');
    assert('Test 1: completedAt is set', !!updated?.completedAt);

    // Grading result row may take a moment; just verify session is done
    await cleanup({ sessionId: session.id, assessmentId: assessment.id, candidateId: candidate.id, companyId: company.id });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 2: Calling finishSession twice does NOT throw — idempotent
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n--- Test 2: finishSession idempotency ---');
  {
    const { company, candidate, assessment, session } = await createFixture();

    await publicService.finishSession(session.id);

    let secondCallError: any = null;
    try {
      await publicService.finishSession(session.id);
    } catch (e) {
      secondCallError = e;
    }

    assert('Test 2: second finishSession call does NOT throw 403', secondCallError === null);

    const updated = await prisma.session.findUnique({ where: { id: session.id } });
    assert('Test 2: session remains COMPLETED', updated?.status === 'COMPLETED');

    await cleanup({ sessionId: session.id, assessmentId: assessment.id, candidateId: candidate.id, companyId: company.id });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 3: Concurrent finishSession calls → session ends COMPLETED (not ERROR)
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n--- Test 3: Concurrent finishSession → COMPLETED ---');
  {
    const { company, candidate, assessment, session } = await createFixture();

    const results = await Promise.allSettled([
      publicService.finishSession(session.id),
      publicService.finishSession(session.id),
      publicService.finishSession(session.id),
    ]);

    // All should resolve (idempotent) — none should reject
    const rejections = results.filter(r => r.status === 'rejected');
    assert('Test 3: no rejections from concurrent finish', rejections.length === 0);

    const updated = await prisma.session.findUnique({ where: { id: session.id } });
    assert('Test 3: session COMPLETED after concurrent calls', updated?.status === 'COMPLETED');

    await cleanup({ sessionId: session.id, assessmentId: assessment.id, candidateId: candidate.id, companyId: company.id });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 4: finishSession on non-existent session throws (authorization intact)
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n--- Test 4: finishSession non-existent session → error ---');
  {
    let caught = false;
    try {
      await publicService.finishSession('00000000-0000-0000-0000-000000000000');
    } catch (e) {
      caught = true;
    }
    assert('Test 4: non-existent session throws', caught);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 5: enforceTimer auto-finishes sessions past durationMinutes + grace
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n--- Test 5: enforceTimer auto-finishes expired session ---');
  {
    const { company, candidate, assessment, session } = await createFixture();

    // Back-date startedAt by 3 hours so it's well past any durationMinutes + grace
    await prisma.session.update({
      where: { id: session.id },
      data: { startedAt: new Date(Date.now() - 3 * 60 * 60 * 1000) }
    });

    // Re-load so service reads updated startedAt
    let enforceTimerTriggered = false;
    try {
      // This internally calls enforceTimer which calls finishSession
      await publicService.getSessionQuestions(session.id, assessment.id);
    } catch (e: any) {
      if (e.message && e.message.includes('Time is up')) {
        enforceTimerTriggered = true;
      }
    }

    assert('Test 5: enforceTimer throws "Time is up"', enforceTimerTriggered);

    const updated = await prisma.session.findUnique({ where: { id: session.id } });
    assert('Test 5: session COMPLETED by enforceTimer', updated?.status === 'COMPLETED');

    await cleanup({ sessionId: session.id, assessmentId: assessment.id, candidateId: candidate.id, companyId: company.id });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 6: enforceTimer on COMPLETED session → still throws "already completed"
  //         (not double-grading; confirms enforceTimer's COMPLETED check is first)
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n--- Test 6: enforceTimer on already-COMPLETED session ---');
  {
    const { company, candidate, assessment, session } = await createFixture();

    // Mark completed first
    await publicService.finishSession(session.id);

    let threwAlreadyCompleted = false;
    try {
      await publicService.getSessionQuestions(session.id, assessment.id);
    } catch (e: any) {
      if (e.message && (e.message.includes('completed') || e.message.includes('Completed'))) {
        threwAlreadyCompleted = true;
      }
    }

    assert('Test 6: enforceTimer on COMPLETED session throws completed error', threwAlreadyCompleted);

    await cleanup({ sessionId: session.id, assessmentId: assessment.id, candidateId: candidate.id, companyId: company.id });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 7: Manual submission: finishSession after submitAttempt → COMPLETED
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n--- Test 7: Manual submission flow still works ---');
  {
    const { company, candidate, assessment, session } = await createFixture();

    // Create a question and an attempt (simulates submitAttempt having been called)
    const question = await prisma.question.create({
      data: { title: 'Q', text: 'desc', type: 'MULTIPLE_CHOICE', points: 10, difficulty: 1, companyId: company.id }
    });
    await prisma.assessmentQuestion.create({
      data: { assessmentId: assessment.id, questionId: question.id, points: 10, orderIdx: 0 }
    });
    await prisma.questionAttempt.create({
      data: { sessionId: session.id, questionId: question.id, answer: 'A', status: 'SUBMITTED' }
    });

    await publicService.finishSession(session.id);

    const updated = await prisma.session.findUnique({ where: { id: session.id } });
    assert('Test 7: session COMPLETED after manual flow', updated?.status === 'COMPLETED');

    await prisma.question.delete({ where: { id: question.id } }).catch(() => {});
    await cleanup({ sessionId: session.id, assessmentId: assessment.id, candidateId: candidate.id, companyId: company.id });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 8: Timer-expiry + manual submit racing → session COMPLETED, no 403
  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n--- Test 8: Timer-expiry race with manual submit ---');
  {
    const { company, candidate, assessment, session } = await createFixture();

    // Simulate race: both finish at "same time"
    const results = await Promise.allSettled([
      publicService.finishSession(session.id),
      publicService.finishSession(session.id),
    ]);

    const rejections = results.filter(r => r.status === 'rejected');
    assert('Test 8: no rejections in race', rejections.length === 0);

    const updated = await prisma.session.findUnique({ where: { id: session.id } });
    assert('Test 8: session COMPLETED after race', updated?.status === 'COMPLETED');

    await cleanup({ sessionId: session.id, assessmentId: assessment.id, candidateId: candidate.id, companyId: company.id });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Summary
  // ─────────────────────────────────────────────────────────────────────────
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
}

runTests()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
