import { prisma } from '../lib/prisma.js';
import { publicService } from '../modules/public/public.service.js';
import { QuestionType, SessionStatus } from '@prisma/client';

function assert(desc: string, condition: boolean, msg?: string) {
  if (!condition) {
    console.error(`[FAIL] ${desc} ${msg ? '- ' + msg : ''}`);
    process.exit(1);
  } else {
    console.log(`  [PASS] ${desc}`);
  }
}

async function setupTestData() {
  const company = await prisma.company.create({ data: { name: 'Test Co' } });
  
  const langJava = await prisma.programmingLanguage.upsert({ where: { name: 'java' }, update: {}, create: { name: 'java' } });
  const langCpp = await prisma.programmingLanguage.upsert({ where: { name: 'cpp' }, update: {}, create: { name: 'cpp' } });
  
  if (false) {
      throw new Error("Missing seeded languages in DB");
  }

  const q = await prisma.question.create({
    data: {
      companyId: company.id,
      title: 'Q1',
      text: 'Write some code',
      type: QuestionType.CODING,
      questionLanguages: {
        create: [
          { languageId: langJava.id },
          { languageId: langCpp.id }
        ]
      },
      testCases: {
          create: [{ input: '', expectedOutput: 'OK', isHidden: false }]
      }
    }
  });

  const asst = await prisma.assessment.create({
    data: {
      companyId: company.id,
      title: 'Asst 1',
      questions: {
        create: [{ questionId: q.id, orderIdx: 1, points: 10 }]
      }
    }
  });

  const cand = await prisma.candidate.create({
    data: { companyId: company.id, name: 'C', email: `c_${Date.now()}@test.com` }
  });

  const session = await prisma.session.create({
    data: {
      candidateId: cand.id,
      assessmentId: asst.id,
      status: SessionStatus.IN_PROGRESS
    }
  });

  return { session, q, company, asst, cand };
}

async function main() {
  const data = await setupTestData();

  console.log("\n=== Language Validation Tests ===");

  // 1. Run Java -> Succeeds (since Judge0 is mocked or returns a failure, but it REACHES execution without throwing AppError 400)
  let runJavaError = null;
  try {
      await publicService.runCode(data.session.id, data.q.id, 'class Main {}', 'java');
  } catch (e: any) { runJavaError = e; }
  assert("Run Java -> Reaches execution", runJavaError === null || runJavaError.statusCode !== 400, "Should not throw validation 400");

  // 2. Run JAVA (case insensitive) -> Succeeds
  let runJavaCaseError = null;
  try {
      await publicService.runCode(data.session.id, data.q.id, 'class Main {}', 'JAVA');
  } catch (e: any) { runJavaCaseError = e; }
  assert("Run JAVA -> Reaches execution", runJavaCaseError === null || runJavaCaseError.statusCode !== 400, "Should not throw validation 400");

  // 3. Run Javascript -> Rejected
  let runJsError = null;
  try {
      await publicService.runCode(data.session.id, data.q.id, 'console.log()', 'javascript');
  } catch (e: any) { runJsError = e; }
  assert("Run Javascript -> Rejected", runJsError && runJsError.statusCode === 400 && runJsError.message.includes('not enabled'));

  // 4. Run Python -> Rejected
  let runPyError = null;
  try {
      await publicService.runCode(data.session.id, data.q.id, 'print()', 'python');
  } catch (e: any) { runPyError = e; }
  assert("Run Python -> Rejected", runPyError && runPyError.statusCode === 400 && runPyError.message.includes('not enabled'));

  // 5. Submit Java -> Accepted
  let submitJavaError = null;
  try {
      await publicService.submitAttempt(data.session.id, data.q.id, 'class Main {}', 'java');
  } catch (e: any) { submitJavaError = e; }
  assert("Submit Java -> Accepted", submitJavaError === null);

  // 6. Submit Javascript -> Rejected
  let submitJsError = null;
  try {
      await publicService.submitAttempt(data.session.id, data.q.id, 'console.log()', 'javascript');
  } catch (e: any) { submitJsError = e; }
  assert("Submit Javascript -> Rejected", submitJsError && submitJsError.statusCode === 400 && submitJsError.message.includes('not enabled'));


  // Teardown
  await prisma.session.delete({ where: { id: data.session.id } });
  await prisma.candidate.delete({ where: { id: data.cand.id } });
  await prisma.question.delete({ where: { id: data.q.id } });
  await prisma.assessment.delete({ where: { id: data.asst.id } });
  await prisma.company.delete({ where: { id: data.company.id } });

  console.log("\n=== All tests passed ===");
}

main().catch(console.error);
