import { prisma } from '../lib/prisma.js';
import { publicService } from '../modules/public/public.service.js';
import { QuestionType, SessionStatus } from '@prisma/client';

async function runTests() {
  console.log('--- Setting up test data ---');

  const company = await prisma.company.create({ data: { name: 'HiddenLeakTestCo' } });
  const assessment = await prisma.assessment.create({ data: { companyId: company.id, title: 'HL Asst' } });

  // Question 1: 1 public + 1 hidden test case
  const q1 = await prisma.question.create({
    data: { companyId: company.id, title: 'Mixed TC Question', text: 'q', type: QuestionType.CODING }
  });
  const publicTc = await prisma.testCase.create({
    data: {
      questionId: q1.id,
      title: 'Public Case',
      input: '__PUBLIC_INPUT__',
      expectedOutput: '__PUBLIC_EXPECTED__',
      isHidden: false,
    }
  });
  const hiddenTc = await prisma.testCase.create({
    data: {
      questionId: q1.id,
      title: '__HIDDEN_TITLE__',
      input: '__HIDDEN_INPUT__',
      expectedOutput: '__HIDDEN_EXPECTED__',
      isHidden: true,
    }
  });

  // Question 2: only hidden test cases
  const q2 = await prisma.question.create({
    data: { companyId: company.id, title: 'HiddenOnly Question', text: 'q2', type: QuestionType.CODING }
  });
  const hiddenOnly = await prisma.testCase.create({
    data: {
      questionId: q2.id,
      title: '__HIDDEN_ONLY_TITLE__',
      input: '__HIDDEN_ONLY_INPUT__',
      expectedOutput: '__HIDDEN_ONLY_EXPECTED__',
      isHidden: true,
    }
  });

  // Question 3: only public test cases (verify unchanged behaviour)
  const q3 = await prisma.question.create({
    data: { companyId: company.id, title: 'PublicOnly Question', text: 'q3', type: QuestionType.CODING }
  });
  const publicOnly = await prisma.testCase.create({
    data: {
      questionId: q3.id,
      title: 'Public Only Case',
      input: '__PUBLIC_ONLY_INPUT__',
      expectedOutput: '__PUBLIC_ONLY_EXPECTED__',
      isHidden: false,
    }
  });

  await prisma.assessmentQuestion.create({ data: { assessmentId: assessment.id, questionId: q1.id, orderIdx: 1, points: 10 } });
  await prisma.assessmentQuestion.create({ data: { assessmentId: assessment.id, questionId: q2.id, orderIdx: 2, points: 10 } });
  await prisma.assessmentQuestion.create({ data: { assessmentId: assessment.id, questionId: q3.id, orderIdx: 3, points: 10 } });

  const candidate = await prisma.candidate.create({ data: { companyId: company.id, name: 'HC1', email: 'hc1@test.com' } });
  const session = await prisma.session.create({ data: { candidateId: candidate.id, assessmentId: assessment.id, status: SessionStatus.STARTED } });

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

  const result = await publicService.getSessionQuestions(session.id, assessment.id);
  const serialized = JSON.stringify(result);

  // --- TEST GROUP 1: Mixed (1 public + 1 hidden) ---
  const r1 = result.find((r: any) => r.questionId === q1.id);
  console.log('\nTEST GROUP 1: Mixed test cases (1 public + 1 hidden)');
  assert('TEST 1: r1 exists', !!r1);
  assert('TEST 2: exactly 1 test case returned (hidden omitted)', r1?.testCases?.length === 1, `got ${r1?.testCases?.length}`);
  assert('TEST 3: returned test case is the public one', r1?.testCases?.[0]?.id === publicTc.id);
  assert('TEST 4: isHidden is false on returned case', r1?.testCases?.[0]?.isHidden === false);
  assert('TEST 5: public input present', serialized.includes('__PUBLIC_INPUT__'));
  assert('TEST 6: public expectedOutput present', serialized.includes('__PUBLIC_EXPECTED__'));
  assert('TEST 7: hidden input does NOT appear in response', !serialized.includes('__HIDDEN_INPUT__'));
  assert('TEST 8: hidden expectedOutput does NOT appear in response', !serialized.includes('__HIDDEN_EXPECTED__'));
  assert('TEST 9: hidden title does NOT appear in response', !serialized.includes('__HIDDEN_TITLE__'));
  assert('TEST 10: hidden id does NOT appear in response', !serialized.includes(hiddenTc.id));

  // --- TEST GROUP 2: Only hidden tests ---
  const r2 = result.find((r: any) => r.questionId === q2.id);
  console.log('\nTEST GROUP 2: Question with only hidden test cases');
  assert('TEST 11: r2 exists', !!r2);
  assert('TEST 12: testCases is empty array', Array.isArray(r2?.testCases) && r2?.testCases?.length === 0, `got ${r2?.testCases?.length}`);
  assert('TEST 13: hidden-only input does NOT appear', !serialized.includes('__HIDDEN_ONLY_INPUT__'));
  assert('TEST 14: hidden-only expectedOutput does NOT appear', !serialized.includes('__HIDDEN_ONLY_EXPECTED__'));
  assert('TEST 15: hidden-only title does NOT appear', !serialized.includes('__HIDDEN_ONLY_TITLE__'));
  assert('TEST 16: hidden-only id does NOT appear', !serialized.includes(hiddenOnly.id));

  // --- TEST GROUP 3: Public-only test cases unchanged ---
  const r3 = result.find((r: any) => r.questionId === q3.id);
  console.log('\nTEST GROUP 3: Question with only public test cases (unchanged behavior)');
  assert('TEST 17: r3 exists', !!r3);
  assert('TEST 18: exactly 1 test case returned', r3?.testCases?.length === 1, `got ${r3?.testCases?.length}`);
  assert('TEST 19: public-only input present', serialized.includes('__PUBLIC_ONLY_INPUT__'));
  assert('TEST 20: public-only expectedOutput present', serialized.includes('__PUBLIC_ONLY_EXPECTED__'));
  assert('TEST 21: public-only id present', serialized.includes(publicOnly.id));

  // --- Cleanup ---
  console.log('\n--- Cleaning up ---');
  await prisma.session.delete({ where: { id: session.id } });
  await prisma.candidate.delete({ where: { id: candidate.id } });
  await prisma.assessmentQuestion.deleteMany({ where: { assessmentId: assessment.id } });
  await prisma.testCase.deleteMany({ where: { id: { in: [publicTc.id, hiddenTc.id, hiddenOnly.id, publicOnly.id] } } });
  await prisma.question.deleteMany({ where: { id: { in: [q1.id, q2.id, q3.id] } } });
  await prisma.assessment.delete({ where: { id: assessment.id } });
  await prisma.company.delete({ where: { id: company.id } });

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

runTests().catch(e => {
  console.error(e);
  process.exit(1);
});
