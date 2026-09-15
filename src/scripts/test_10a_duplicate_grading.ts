/**
 * test_10a_duplicate_grading.ts
 *
 * Integration tests for Issue #10A:
 * - Queue deduplication (multiple gradeSession calls don't pile up)
 * - Idempotency check (existingResult.isPassed !== null aborts grading)
 * - Incomplete Result recovery (existingResult.isPassed === null re-runs)
 */

import { PrismaClient } from '@prisma/client';
import { GradingService, gradingService } from '../modules/grading/grading.service.js';
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
    data: { companyId: company.id, title: 'Test 10A', passingPercentage: 60, durationMinutes: 60 }
  });
  
  // We need a session that is already COMPLETED so gradingService processes it
  const session = await prisma.session.create({
    data: { assessmentId: assessment.id, candidateId: candidate.id, status: 'COMPLETED' }
  });
  return { company, candidate, assessment, session };
}

async function cleanup(ids: { sessionId: string; assessmentId: string; candidateId: string; companyId: string }) {
  await prisma.session.deleteMany({ where: { id: ids.sessionId } }).catch(() => {});
  await prisma.assessment.delete({ where: { id: ids.assessmentId } }).catch(() => {});
  await prisma.candidate.delete({ where: { id: ids.candidateId } }).catch(() => {});
  await prisma.company.delete({ where: { id: ids.companyId } }).catch(() => {});
}

let executionCount = 0;
const originalCreateResult = gradingRepository.createResult.bind(gradingRepository);

gradingRepository.createResult = async function(sessionId: string) {
  executionCount++;
  return originalCreateResult(sessionId);
};

async function runTests() {
  console.log('=== Issue 10A Tests ===\n');

  // TEST 1: Duplicate gradeSession() calls are deduplicated in the queue
  console.log('--- Test 1: Queue Deduplication ---');
  {
    const { company, candidate, assessment, session } = await createFixture();
    
    // Simulate a race condition: 3 finish calls simultaneously
    gradingService.gradeSession(session.id);
    gradingService.gradeSession(session.id);
    gradingService.gradeSession(session.id);
    
    // Wait for queue processing to finish
    await new Promise(r => setTimeout(r, 100));
    // Wait until isGrading is false
    while ((GradingService as any).isGrading) {
        await new Promise(r => setTimeout(r, 100));
    }
    await new Promise(r => setTimeout(r, 1000)); // Buffer to ensure subsequent tests don't overlap

    console.log("createResult count was:", executionCount);
    assert('Test 1: createResult ran exactly 1 time despite 3 calls', executionCount === 1);
    
    executionCount = 0;
    await cleanup({ sessionId: session.id, assessmentId: assessment.id, candidateId: candidate.id, companyId: company.id });
  }

  // TEST 2: Idempotency check prevents re-grading a fully passed session
  console.log('\n--- Test 2: Idempotency Guard (Completed Result) ---');
  {
    const { company, candidate, assessment, session } = await createFixture();
    
    await prisma.result.create({
      data: {
        sessionId: session.id,
        totalScore: 10,
        maxScore: 10,
        percentage: 100,
        isPassed: true
      }
    });

    gradingService.gradeSession(session.id);
    
    // Wait until isGrading is false
    while ((GradingService as any).isGrading) {
        await new Promise(r => setTimeout(r, 100));
    }
    await new Promise(r => setTimeout(r, 1000)); // Buffer to ensure subsequent tests don't overlap

    assert('Test 2: Idempotency triggered correctly', executionCount === 0);
    executionCount = 0;
    
    const resultAfter = await prisma.result.findUnique({ where: { sessionId: session.id } });
    assert('Test 2: Result remains intact', resultAfter !== null && resultAfter.isPassed === true);

    await cleanup({ sessionId: session.id, assessmentId: assessment.id, candidateId: candidate.id, companyId: company.id });
  }

  // TEST 3: Incomplete Result is safely re-graded
  console.log('\n--- Test 3: Incomplete Result re-grades ---');
  {
    const { company, candidate, assessment, session } = await createFixture();
    
    await prisma.result.create({
      data: {
        sessionId: session.id,
        totalScore: 0,
        maxScore: 0,
        percentage: 0,
        isPassed: null
      }
    });

    gradingService.gradeSession(session.id);
    
    // Wait until isGrading is false
    while ((GradingService as any).isGrading) {
        await new Promise(r => setTimeout(r, 100));
    }
    await new Promise(r => setTimeout(r, 1000)); // Buffer to ensure subsequent tests don't overlap

    assert('Test 3: createResult ran', executionCount === 1);
    executionCount = 0;

    const resultAfter = await prisma.result.findUnique({ where: { sessionId: session.id } });
    assert('Test 3: Result is now finalized', resultAfter !== null && typeof resultAfter.isPassed === 'boolean');

    await cleanup({ sessionId: session.id, assessmentId: assessment.id, candidateId: candidate.id, companyId: company.id });
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
}

runTests()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
