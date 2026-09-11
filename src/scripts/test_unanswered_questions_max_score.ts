import { prisma } from "../lib/prisma.js";
import { gradingService } from "../modules/grading/grading.service.js";
import { QuestionType, SessionStatus } from "@prisma/client";

let passed = 0;
let failed = 0;

function assert(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  [PASS] ${name}`);
    passed++;
  } else {
    console.log(`  [FAIL] ${name}${detail ? " — " + detail : ""}`);
    failed++;
  }
}

async function makeWorld() {
  return await prisma.company.create({ data: { name: `GradingMaxScoreCo_${Date.now()}_${Math.random()}` } });
}

async function teardown(ids: {
  sessionIds?: string[];
  candidateIds?: string[];
  aqIds?: Array<{ assessmentId: string; questionId: string }>;
  questionIds?: string[];
  assessmentIds?: string[];
  companyIds?: string[];
}) {
  if (ids.sessionIds?.length) {
    await prisma.questionResult.deleteMany({ where: { result: { sessionId: { in: ids.sessionIds } } } });
    await prisma.result.deleteMany({ where: { sessionId: { in: ids.sessionIds } } });
    await prisma.execution.deleteMany({ where: { attempt: { sessionId: { in: ids.sessionIds } } } });
    await prisma.questionAttempt.deleteMany({ where: { sessionId: { in: ids.sessionIds } } });
    await prisma.session.deleteMany({ where: { id: { in: ids.sessionIds } } });
  }
  if (ids.candidateIds?.length) await prisma.candidate.deleteMany({ where: { id: { in: ids.candidateIds } } });
  if (ids.aqIds?.length) {
    for (const aq of ids.aqIds)
      await prisma.assessmentQuestion.deleteMany({ where: { assessmentId: aq.assessmentId, questionId: aq.questionId } });
  }
  if (ids.questionIds?.length) {
    await prisma.testCase.deleteMany({ where: { questionId: { in: ids.questionIds } } });
    await prisma.option.deleteMany({ where: { questionId: { in: ids.questionIds } } });
    await prisma.questionLanguage.deleteMany({ where: { questionId: { in: ids.questionIds } } });
    await prisma.question.deleteMany({ where: { id: { in: ids.questionIds } } });
  }
  if (ids.assessmentIds?.length) await prisma.assessment.deleteMany({ where: { id: { in: ids.assessmentIds } } });
  if (ids.companyIds?.length) await prisma.company.deleteMany({ where: { id: { in: ids.companyIds } } });
}

// ----------------------------------------------------------------------------
// TEST 1: All questions answered (10 + 10 + 20) all correct -> 40/40, 100%
// ----------------------------------------------------------------------------
async function test1_allAnsweredCorrect() {
  console.log("\nTEST 1: All questions answered and correct (10 + 10 + 20)");
  const company = await makeWorld();
  const asst = await prisma.assessment.create({ data: { companyId: company.id, title: "Test 1 Asst", passingPercentage: 60 } });

  const q1 = await prisma.question.create({ data: { companyId: company.id, title: "Q1", text: "t", type: QuestionType.MULTIPLE_CHOICE, points: 1 } });
  const q2 = await prisma.question.create({ data: { companyId: company.id, title: "Q2", text: "t", type: QuestionType.MULTIPLE_CHOICE, points: 1 } });
  const q3 = await prisma.question.create({ data: { companyId: company.id, title: "Q3", text: "t", type: QuestionType.MULTIPLE_CHOICE, points: 1 } });

  const opt1 = await prisma.option.create({ data: { questionId: q1.id, text: "C1", isCorrect: true } });
  const opt2 = await prisma.option.create({ data: { questionId: q2.id, text: "C2", isCorrect: true } });
  const opt3 = await prisma.option.create({ data: { questionId: q3.id, text: "C3", isCorrect: true } });

  await prisma.assessmentQuestion.create({ data: { assessmentId: asst.id, questionId: q1.id, orderIdx: 1, points: 10 } });
  await prisma.assessmentQuestion.create({ data: { assessmentId: asst.id, questionId: q2.id, orderIdx: 2, points: 10 } });
  await prisma.assessmentQuestion.create({ data: { assessmentId: asst.id, questionId: q3.id, orderIdx: 3, points: 20 } });

  const cand = await prisma.candidate.create({ data: { companyId: company.id, name: "C1", email: `c1_${Date.now()}@test.com` } });
  const session = await prisma.session.create({ data: { candidateId: cand.id, assessmentId: asst.id, status: SessionStatus.COMPLETED } });

  await prisma.questionAttempt.create({ data: { sessionId: session.id, questionId: q1.id, answer: opt1.id, status: "SUBMITTED" } });
  await prisma.questionAttempt.create({ data: { sessionId: session.id, questionId: q2.id, answer: opt2.id, status: "SUBMITTED" } });
  await prisma.questionAttempt.create({ data: { sessionId: session.id, questionId: q3.id, answer: opt3.id, status: "SUBMITTED" } });

  await gradingService.executeGrading(session.id);
  const res = await prisma.result.findUnique({ where: { sessionId: session.id } });

  assert("Result exists", !!res);
  assert("maxScore = 40 (10 + 10 + 20)", res?.maxScore === 40, `got ${res?.maxScore}`);
  assert("totalScore = 40 (all correct)", res?.totalScore === 40, `got ${res?.totalScore}`);
  assert("percentage = 100%", Math.abs((res?.percentage ?? 0) - 100) < 0.01, `got ${res?.percentage}`);
  assert("isPassed = true", res?.isPassed === true);

  await teardown({ sessionIds: [session.id], candidateIds: [cand.id], questionIds: [q1.id, q2.id, q3.id], assessmentIds: [asst.id], companyIds: [company.id] });
}

// ----------------------------------------------------------------------------
// TEST 2: One question unanswered: Q1 correct (10), Q2 unanswered (10), Q3 wrong (20)
// Expected: totalScore = 10, maxScore = 40, percentage = 25%
// ----------------------------------------------------------------------------
async function test2_oneUnanswered() {
  console.log("\nTEST 2: One question unanswered (Q1 correct, Q2 unanswered, Q3 wrong)");
  const company = await makeWorld();
  const asst = await prisma.assessment.create({ data: { companyId: company.id, title: "Test 2 Asst", passingPercentage: 60 } });

  const q1 = await prisma.question.create({ data: { companyId: company.id, title: "Q1", text: "t", type: QuestionType.MULTIPLE_CHOICE, points: 1 } });
  const q2 = await prisma.question.create({ data: { companyId: company.id, title: "Q2", text: "t", type: QuestionType.MULTIPLE_CHOICE, points: 1 } });
  const q3 = await prisma.question.create({ data: { companyId: company.id, title: "Q3", text: "t", type: QuestionType.MULTIPLE_CHOICE, points: 1 } });

  const opt1Correct = await prisma.option.create({ data: { questionId: q1.id, text: "C1", isCorrect: true } });
  await prisma.option.create({ data: { questionId: q2.id, text: "C2", isCorrect: true } });
  await prisma.option.create({ data: { questionId: q3.id, text: "C3", isCorrect: true } });
  const opt3Wrong = await prisma.option.create({ data: { questionId: q3.id, text: "W3", isCorrect: false } });

  await prisma.assessmentQuestion.create({ data: { assessmentId: asst.id, questionId: q1.id, orderIdx: 1, points: 10 } });
  await prisma.assessmentQuestion.create({ data: { assessmentId: asst.id, questionId: q2.id, orderIdx: 2, points: 10 } });
  await prisma.assessmentQuestion.create({ data: { assessmentId: asst.id, questionId: q3.id, orderIdx: 3, points: 20 } });

  const cand = await prisma.candidate.create({ data: { companyId: company.id, name: "C2", email: `c2_${Date.now()}@test.com` } });
  const session = await prisma.session.create({ data: { candidateId: cand.id, assessmentId: asst.id, status: SessionStatus.COMPLETED } });

  // Q1 answered correctly
  await prisma.questionAttempt.create({ data: { sessionId: session.id, questionId: q1.id, answer: opt1Correct.id, status: "SUBMITTED" } });
  // Q2 is UNANSWERED (no attempt record)
  // Q3 answered incorrectly
  await prisma.questionAttempt.create({ data: { sessionId: session.id, questionId: q3.id, answer: opt3Wrong.id, status: "SUBMITTED" } });

  await gradingService.executeGrading(session.id);
  const res = await prisma.result.findUnique({ where: { sessionId: session.id } });

  assert("Result exists", !!res);
  assert("maxScore = 40 (all 3 questions contribute to maxScore)", res?.maxScore === 40, `got ${res?.maxScore}`);
  assert("totalScore = 10 (only Q1 correct, Q2 unanswered gives 0, Q3 wrong gives 0)", res?.totalScore === 10, `got ${res?.totalScore}`);
  assert("percentage = 25%", Math.abs((res?.percentage ?? 0) - 25) < 0.01, `got ${res?.percentage}`);
  assert("isPassed = false (25% < 60%)", res?.isPassed === false);

  await teardown({ sessionIds: [session.id], candidateIds: [cand.id], questionIds: [q1.id, q2.id, q3.id], assessmentIds: [asst.id], companyIds: [company.id] });
}

// ----------------------------------------------------------------------------
// TEST 3: All questions unanswered: 3 questions = 10 + 10 + 20
// Expected: totalScore = 0, maxScore = 40, percentage = 0%
// ----------------------------------------------------------------------------
async function test3_allUnanswered() {
  console.log("\nTEST 3: All questions unanswered (0 attempts for 10 + 10 + 20)");
  const company = await makeWorld();
  const asst = await prisma.assessment.create({ data: { companyId: company.id, title: "Test 3 Asst", passingPercentage: 60 } });

  const q1 = await prisma.question.create({ data: { companyId: company.id, title: "Q1", text: "t", type: QuestionType.MULTIPLE_CHOICE, points: 1 } });
  const q2 = await prisma.question.create({ data: { companyId: company.id, title: "Q2", text: "t", type: QuestionType.MULTIPLE_CHOICE, points: 1 } });
  const q3 = await prisma.question.create({ data: { companyId: company.id, title: "Q3", text: "t", type: QuestionType.MULTIPLE_CHOICE, points: 1 } });

  await prisma.assessmentQuestion.create({ data: { assessmentId: asst.id, questionId: q1.id, orderIdx: 1, points: 10 } });
  await prisma.assessmentQuestion.create({ data: { assessmentId: asst.id, questionId: q2.id, orderIdx: 2, points: 10 } });
  await prisma.assessmentQuestion.create({ data: { assessmentId: asst.id, questionId: q3.id, orderIdx: 3, points: 20 } });

  const cand = await prisma.candidate.create({ data: { companyId: company.id, name: "C3", email: `c3_${Date.now()}@test.com` } });
  const session = await prisma.session.create({ data: { candidateId: cand.id, assessmentId: asst.id, status: SessionStatus.COMPLETED } });
  // 0 attempts created

  await gradingService.executeGrading(session.id);
  const res = await prisma.result.findUnique({ where: { sessionId: session.id } });

  assert("Result exists", !!res);
  assert("maxScore = 40 (all questions count towards maxScore)", res?.maxScore === 40, `got ${res?.maxScore}`);
  assert("totalScore = 0 (no questions answered)", res?.totalScore === 0, `got ${res?.totalScore}`);
  assert("percentage = 0%", res?.percentage === 0, `got ${res?.percentage}`);
  assert("isPassed = false", res?.isPassed === false);

  await teardown({ sessionIds: [session.id], candidateIds: [cand.id], questionIds: [q1.id, q2.id, q3.id], assessmentIds: [asst.id], companyIds: [company.id] });
}

// ----------------------------------------------------------------------------
// TEST 4: Some answered, some unanswered, including a coding question
// Unanswered coding & MCQ questions must still contribute points to maxScore
// ----------------------------------------------------------------------------
async function test4_someAnsweredWithCoding() {
  console.log("\nTEST 4: Some answered, some unanswered, including a coding question");
  const company = await makeWorld();
  const asst = await prisma.assessment.create({ data: { companyId: company.id, title: "Test 4 Asst", passingPercentage: 60 } });

  const jsLang = await prisma.programmingLanguage.upsert({
    where: { name: "javascript" },
    update: {},
    create: { name: "javascript" }
  });

  // Q1: MCQ (10 pts)
  const q1 = await prisma.question.create({ data: { companyId: company.id, title: "Q1", text: "mcq", type: QuestionType.MULTIPLE_CHOICE, points: 1 } });
  const opt1 = await prisma.option.create({ data: { questionId: q1.id, text: "Correct1", isCorrect: true } });

  // Q2: Coding (20 pts)
  const q2 = await prisma.question.create({
    data: {
      companyId: company.id,
      title: "Q2",
      text: "coding",
      type: QuestionType.CODING,
      points: 1,
      executionMode: "FULL_PROGRAM",
      comparisonMode: "TRIMMED"
    }
  });
  await prisma.questionLanguage.create({ data: { questionId: q2.id, languageId: jsLang.id } });
  await prisma.testCase.create({ data: { questionId: q2.id, input: "1 2", expectedOutput: "3", isHidden: false } });

  // Q3: MCQ (10 pts)
  const q3 = await prisma.question.create({ data: { companyId: company.id, title: "Q3", text: "mcq", type: QuestionType.MULTIPLE_CHOICE, points: 1 } });
  await prisma.option.create({ data: { questionId: q3.id, text: "Correct3", isCorrect: true } });

  await prisma.assessmentQuestion.create({ data: { assessmentId: asst.id, questionId: q1.id, orderIdx: 1, points: 10 } });
  await prisma.assessmentQuestion.create({ data: { assessmentId: asst.id, questionId: q2.id, orderIdx: 2, points: 20 } });
  await prisma.assessmentQuestion.create({ data: { assessmentId: asst.id, questionId: q3.id, orderIdx: 3, points: 10 } });

  // 4A: Q1 answered, coding Q2 unanswered, MCQ Q3 unanswered
  const candA = await prisma.candidate.create({ data: { companyId: company.id, name: "C4A", email: `c4a_${Date.now()}@test.com` } });
  const sessionA = await prisma.session.create({ data: { candidateId: candA.id, assessmentId: asst.id, status: SessionStatus.COMPLETED } });
  await prisma.questionAttempt.create({ data: { sessionId: sessionA.id, questionId: q1.id, answer: opt1.id, status: "SUBMITTED" } });

  await gradingService.executeGrading(sessionA.id);
  const resA = await prisma.result.findUnique({ where: { sessionId: sessionA.id } });

  assert("4A: Result exists", !!resA);
  assert("4A: maxScore = 40 (unanswered coding Q2 & MCQ Q3 both contribute points to maxScore)", resA?.maxScore === 40, `got ${resA?.maxScore}`);
  assert("4A: totalScore = 10 (only Q1 correct)", resA?.totalScore === 10, `got ${resA?.totalScore}`);
  assert("4A: percentage = 25%", Math.abs((resA?.percentage ?? 0) - 25) < 0.01, `got ${resA?.percentage}`);

  // 4B: Q1 unanswered, coding Q2 answered correctly, MCQ Q3 unanswered
  const candB = await prisma.candidate.create({ data: { companyId: company.id, name: "C4B", email: `c4b_${Date.now()}@test.com` } });
  const sessionB = await prisma.session.create({ data: { candidateId: candB.id, assessmentId: asst.id, status: SessionStatus.COMPLETED } });
  const validJsCode = `const fs = require("fs"); const input = fs.readFileSync(0, "utf-8").trim().split(" ").map(Number); console.log(input[0] + input[1]);`;
  await prisma.questionAttempt.create({
    data: {
      sessionId: sessionB.id,
      questionId: q2.id,
      answer: validJsCode,
      language: "javascript",
      status: "SUBMITTED"
    }
  });

  await gradingService.executeGrading(sessionB.id);
  const resB = await prisma.result.findUnique({ where: { sessionId: sessionB.id } });

  assert("4B: Result exists", !!resB);
  assert("4B: maxScore = 40 (unanswered MCQ Q1 & Q3 contribute points to maxScore)", resB?.maxScore === 40, `got ${resB?.maxScore}`);
  assert("4B: totalScore = 20 (coding question passed)", resB?.totalScore === 20, `got ${resB?.totalScore}`);
  assert("4B: percentage = 50%", Math.abs((resB?.percentage ?? 0) - 50) < 0.01, `got ${resB?.percentage}`);

  await teardown({
    sessionIds: [sessionA.id, sessionB.id],
    candidateIds: [candA.id, candB.id],
    questionIds: [q1.id, q2.id, q3.id],
    assessmentIds: [asst.id],
    companyIds: [company.id]
  });
}

// ----------------------------------------------------------------------------
// TEST 5: Verify AssessmentQuestion.points is used, not Question.points
// ----------------------------------------------------------------------------
async function test5_assessmentQuestionPointsAuthoritative() {
  console.log("\nTEST 5: Verify AssessmentQuestion.points is used, NOT Question.points");
  const company = await makeWorld();
  const asst = await prisma.assessment.create({ data: { companyId: company.id, title: "Test 5 Asst", passingPercentage: 60 } });

  // Question.points are 999 and 888 (huge numbers)
  const q1 = await prisma.question.create({ data: { companyId: company.id, title: "Q1", text: "t", type: QuestionType.MULTIPLE_CHOICE, points: 999 } });
  const q2 = await prisma.question.create({ data: { companyId: company.id, title: "Q2", text: "t", type: QuestionType.MULTIPLE_CHOICE, points: 888 } });

  const opt1 = await prisma.option.create({ data: { questionId: q1.id, text: "C1", isCorrect: true } });
  await prisma.option.create({ data: { questionId: q2.id, text: "C2", isCorrect: true } });

  // AssessmentQuestion.points are 15 and 25
  await prisma.assessmentQuestion.create({ data: { assessmentId: asst.id, questionId: q1.id, orderIdx: 1, points: 15 } });
  await prisma.assessmentQuestion.create({ data: { assessmentId: asst.id, questionId: q2.id, orderIdx: 2, points: 25 } });

  const cand = await prisma.candidate.create({ data: { companyId: company.id, name: "C5", email: `c5_${Date.now()}@test.com` } });
  const session = await prisma.session.create({ data: { candidateId: cand.id, assessmentId: asst.id, status: SessionStatus.COMPLETED } });

  // Q1 answered correctly, Q2 unanswered
  await prisma.questionAttempt.create({ data: { sessionId: session.id, questionId: q1.id, answer: opt1.id, status: "SUBMITTED" } });

  await gradingService.executeGrading(session.id);
  const res = await prisma.result.findUnique({ where: { sessionId: session.id } });

  assert("Result exists", !!res);
  assert("maxScore uses AssessmentQuestion.points (15 + 25 = 40)", res?.maxScore === 40, `got ${res?.maxScore}`);
  assert("maxScore does NOT use Question.points (not 1887 or 999)", res?.maxScore !== 1887 && res?.maxScore !== 999);
  assert("totalScore uses AssessmentQuestion.points (15)", res?.totalScore === 15, `got ${res?.totalScore}`);
  assert("totalScore does NOT use Question.points (not 999)", res?.totalScore !== 999);
  assert("percentage = 37.5% (15 / 40 * 100)", Math.abs((res?.percentage ?? 0) - 37.5) < 0.01, `got ${res?.percentage}`);

  await teardown({ sessionIds: [session.id], candidateIds: [cand.id], questionIds: [q1.id, q2.id], assessmentIds: [asst.id], companyIds: [company.id] });
}

// ----------------------------------------------------------------------------
// TEST 6: Verify no duplicate maxScore calculation when a question has an attempt
// ----------------------------------------------------------------------------
async function test6_noDuplicateMaxScore() {
  console.log("\nTEST 6: Verify no duplicate maxScore calculation when a question has an attempt");
  const company = await makeWorld();
  const asst = await prisma.assessment.create({ data: { companyId: company.id, title: "Test 6 Asst", passingPercentage: 60 } });

  const q1 = await prisma.question.create({ data: { companyId: company.id, title: "Q1", text: "t", type: QuestionType.MULTIPLE_CHOICE, points: 1 } });
  const q2 = await prisma.question.create({ data: { companyId: company.id, title: "Q2", text: "t", type: QuestionType.MULTIPLE_CHOICE, points: 1 } });

  const opt1 = await prisma.option.create({ data: { questionId: q1.id, text: "C1", isCorrect: true } });
  const opt2 = await prisma.option.create({ data: { questionId: q2.id, text: "C2", isCorrect: true } });

  await prisma.assessmentQuestion.create({ data: { assessmentId: asst.id, questionId: q1.id, orderIdx: 1, points: 10 } });
  await prisma.assessmentQuestion.create({ data: { assessmentId: asst.id, questionId: q2.id, orderIdx: 2, points: 20 } });

  const cand = await prisma.candidate.create({ data: { companyId: company.id, name: "C6", email: `c6_${Date.now()}@test.com` } });
  const session = await prisma.session.create({ data: { candidateId: cand.id, assessmentId: asst.id, status: SessionStatus.COMPLETED } });

  // Both have attempts
  await prisma.questionAttempt.create({ data: { sessionId: session.id, questionId: q1.id, answer: opt1.id, status: "SUBMITTED" } });
  await prisma.questionAttempt.create({ data: { sessionId: session.id, questionId: q2.id, answer: opt2.id, status: "SUBMITTED" } });

  await gradingService.executeGrading(session.id);
  const res = await prisma.result.findUnique({ where: { sessionId: session.id } });

  assert("Result exists", !!res);
  assert("maxScore is exactly 30 (not 60 due to double-counting)", res?.maxScore === 30, `got ${res?.maxScore}`);
  assert("totalScore = 30", res?.totalScore === 30, `got ${res?.totalScore}`);
  assert("percentage = 100%", Math.abs((res?.percentage ?? 0) - 100) < 0.01, `got ${res?.percentage}`);

  await teardown({ sessionIds: [session.id], candidateIds: [cand.id], questionIds: [q1.id, q2.id], assessmentIds: [asst.id], companyIds: [company.id] });
}

// ----------------------------------------------------------------------------
// Runner
// ----------------------------------------------------------------------------
async function main() {
  console.log("=== Unanswered Questions maxScore Grading Tests ===\n");
  await test1_allAnsweredCorrect();
  await test2_oneUnanswered();
  await test3_allUnanswered();
  await test4_someAnsweredWithCoding();
  await test5_assessmentQuestionPointsAuthoritative();
  await test6_noDuplicateMaxScore();

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
