/**
 * test_10b_crash_recovery.ts
 *
 * Integration tests for Issue #10B:
 * - Startup recovery sweep queries incomplete sessions correctly
 * - Grading Service recovers them and finishes grading
 */

import { PrismaClient } from '@prisma/client';
import { gradingService } from '../modules/grading/grading.service.js';
import { gradingRepository } from '../modules/grading/grading.repository.js';

const prisma = new PrismaClient();
let passed = 0;
let failed = 0;

function assert(desc: string, condition: boolean) {
  if (condition) { console.log(`  [PASS] ${desc}`); passed++; }
  else { console.error(`  [FAIL] ${desc}`); failed++; }
}

async function createFixture() {
  const company = await prisma.company.create({ data: { name: `Co-${Date.now()}` } });
  const candidate = await prisma.candidate.create({
    data: { name: 'Tester', email: `t.${Math.random()}@t.com`, companyId: company.id }
  });
  const assessment = await prisma.assessment.create({
    data: { companyId: company.id, title: 'Test 10B', passingPercentage: 60, durationMinutes: 60 }
  });
  
  return { company, candidate, assessment };
}

async function cleanup(ids: { sessionId?: string; assessmentId: string; candidateId: string; companyId: string }) {
  if (ids.sessionId) {
    await prisma.session.deleteMany({ where: { id: ids.sessionId } }).catch(() => {});
  }
  await prisma.assessment.delete({ where: { id: ids.assessmentId } }).catch(() => {});
  await prisma.candidate.delete({ where: { id: ids.candidateId } }).catch(() => {});
  await prisma.company.delete({ where: { id: ids.companyId } }).catch(() => {});
}

async function runTests() {
  console.log('=== Issue 10B Tests ===\n');

  console.log('--- Test 1: recoverIncompleteGrading picks up no-Result and null-isPassed sessions ---');
  {
    const { company, candidate, assessment } = await createFixture();
    
    // Create Session 1: COMPLETED, no Result
    const s1 = await prisma.session.create({
      data: { assessmentId: assessment.id, candidateId: candidate.id, status: 'COMPLETED' }
    });

    // Create Session 2: COMPLETED, Result exists but isPassed = null
    const s2 = await prisma.session.create({
      data: { assessmentId: assessment.id, candidateId: candidate.id, status: 'COMPLETED' }
    });
    await prisma.result.create({
      data: { sessionId: s2.id, totalScore: 0, maxScore: 0, percentage: 0, isPassed: null }
    });

    // Create Session 3: COMPLETED, Result isPassed = true (should NOT be picked up)
    const s3 = await prisma.session.create({
      data: { assessmentId: assessment.id, candidateId: candidate.id, status: 'COMPLETED' }
    });
    await prisma.result.create({
      data: { sessionId: s3.id, totalScore: 10, maxScore: 10, percentage: 100, isPassed: true }
    });

    // Create Session 4: IN_PROGRESS (should NOT be picked up)
    const s4 = await prisma.session.create({
      data: { assessmentId: assessment.id, candidateId: candidate.id, status: 'STARTED' }
    });

    // Run recovery sweep
    await gradingService.recoverIncompleteGrading();
    
    // Wait for the queue to finish processing
    await new Promise(r => setTimeout(r, 100));
    while ((gradingService.constructor as any).isGrading) {
        await new Promise(r => setTimeout(r, 100));
    }
    await new Promise(r => setTimeout(r, 1000)); // Cool-down buffer

    // Verify S1 got graded
    const r1 = await prisma.result.findUnique({ where: { sessionId: s1.id } });
    assert('Test 1: Session 1 (no Result) was graded', r1 !== null && typeof r1.isPassed === 'boolean');

    // Verify S2 got graded
    const r2 = await prisma.result.findUnique({ where: { sessionId: s2.id } });
    assert('Test 1: Session 2 (isPassed = null) was graded', r2 !== null && typeof r2.isPassed === 'boolean');

    await prisma.session.deleteMany({ where: { id: { in: [s1.id, s2.id, s3.id, s4.id] } } });
    await cleanup({ assessmentId: assessment.id, candidateId: candidate.id, companyId: company.id });
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
}

runTests()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
