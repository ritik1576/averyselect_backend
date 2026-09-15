import { prisma } from '../lib/prisma.js';
import { gradingService } from '../modules/grading/grading.service.js';

function assert(desc: string, condition: boolean, msg?: string) {
  if (!condition) {
    console.error(`[FAIL] ${desc} ${msg ? '- ' + msg : ''}`);
    process.exit(1);
  } else {
    console.log(`  [PASS] ${desc}`);
  }
}

async function runTests() {
  console.log("=== Grading Language Validation Tests ===");

  // Setup data
  const company = await prisma.company.create({ data: { name: 'Test Co' } });
  const candidate = await prisma.candidate.create({ data: { name: 'John', email: `john.${Math.random()}@test.com`, companyId: company.id } });
  
  // Question allows Java and C++
  const javaLang = await prisma.programmingLanguage.upsert({
    where: { name: 'java' },
    update: {},
    create: { name: 'java' }
  });
  const cppLang = await prisma.programmingLanguage.upsert({
    where: { name: 'cpp' },
    update: {},
    create: { name: 'cpp' }
  });
  const jsLang = await prisma.programmingLanguage.upsert({
    where: { name: 'javascript' },
    update: {},
    create: { name: 'javascript' }
  });
  const pyLang = await prisma.programmingLanguage.upsert({
    where: { name: 'python' },
    update: {},
    create: { name: 'python' }
  });

  const question = await prisma.question.create({
    data: {
      companyId: company.id,
      title: 'Q1',
      text: 'Q1 text',
      type: 'CODING',
      points: 10,
      questionLanguages: {
        create: [
          { languageId: javaLang.id },
          { languageId: cppLang.id }
        ]
      },
      testCases: {
        create: [
          { input: '1', expectedOutput: '1' }
        ]
      }
    }
  });

  const questionB = await prisma.question.create({
    data: {
      companyId: company.id,
      title: 'Q2',
      text: 'Q2 text',
      type: 'CODING',
      points: 10,
      questionLanguages: {
        create: [
          { languageId: pyLang.id }
        ]
      },
      testCases: {
        create: [
          { input: '1', expectedOutput: '1' }
        ]
      }
    }
  });

  async function testAttempt(attemptLang: string | null, expectedStatus: string) {
    const assessment = await prisma.assessment.create({
      data: {
        companyId: company.id,
        title: `Assessment ${attemptLang}`,
        isPublished: true,
        questions: {
          create: [{ questionId: question.id, points: 10, orderIdx: 0 }]
        }
      }
    });

    const session = await prisma.session.create({
      data: {
        assessmentId: assessment.id,
        candidateId: candidate.id,
        status: 'COMPLETED'
      }
    });

    await prisma.questionAttempt.create({
      data: {
        sessionId: session.id,
        questionId: question.id,
        language: attemptLang,
        answer: 'print("hello")'
      }
    });

    await gradingService.executeGrading(session.id);
    
    const execution = await prisma.execution.findFirst({
      where: { attempt: { sessionId: session.id } }
    });

    assert(`Attempt language = ${attemptLang} -> ${expectedStatus}`, execution?.status === expectedStatus, `Expected ${expectedStatus} but got ${execution?.status}`);
  }

  // Tests for Q1 (Allows Java, C++)
  await testAttempt('java', 'FAILED'); // Should execute (but FAIL because it's dummy code)
  await testAttempt('JAVA', 'FAILED'); // Case insensitive
  await testAttempt('javascript', 'ERROR'); // Configuration error
  await testAttempt('python', 'ERROR');
  await testAttempt(null, 'ERROR');

  // Test Multiple Questions with different languages
  const assessmentB = await prisma.assessment.create({
    data: {
      companyId: company.id,
      title: `Assessment B`,
      isPublished: true,
      questions: {
        create: [
          { questionId: question.id, points: 10, orderIdx: 0 },
          { questionId: questionB.id, points: 10, orderIdx: 0 }
        ]
      }
    }
  });

  const sessionB = await prisma.session.create({
    data: {
      assessmentId: assessmentB.id,
      candidateId: candidate.id,
      status: 'COMPLETED'
    }
  });

  // Valid attempt for Q1
  await prisma.questionAttempt.create({
    data: {
      sessionId: sessionB.id,
      questionId: question.id,
      language: 'cpp',
      answer: 'code'
    }
  });

  // Valid attempt for Q2
  await prisma.questionAttempt.create({
    data: {
      sessionId: sessionB.id,
      questionId: questionB.id,
      language: 'python',
      answer: 'code'
    }
  });

  await gradingService.executeGrading(sessionB.id);

  const executionsB = await prisma.execution.findMany({
    where: { attempt: { sessionId: sessionB.id } },
    include: { attempt: true }
  });

  assert(`Multiple questions - executed successfully`, executionsB.length === 2 && executionsB.every(e => e.status !== 'ERROR'));
  
  // Clean up
  await prisma.company.delete({ where: { id: company.id } });
  console.log("\n=== All tests passed ===");
}

runTests().catch(e => {
  console.error("Test failed", e);
  process.exit(1);
});
