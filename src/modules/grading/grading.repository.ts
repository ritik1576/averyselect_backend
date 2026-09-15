import { prisma } from '../../lib/prisma.js';
import { ExecutionStatus } from '@prisma/client';

export class GradingRepository {

  async getIncompleteGradingSessions() {
    return await prisma.session.findMany({
      where: {
        status: 'COMPLETED',
        OR: [
          { result: null },
          { result: { isPassed: null } }
        ]
      },
      select: { id: true }
    });
  }

  async getResultBySessionId(sessionId: string) {
    return await prisma.result.findUnique({
      where: { sessionId }
    });
  }

  async getUnscoredSessionData(sessionId: string) {
    // Step 1: Obtain the assessment anchor from the session.
    // This is the authorization root — we never trust QuestionAttempt.questionId alone.
    const meta = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { assessmentId: true },
    });
    if (!meta) return null;

    const { assessmentId } = meta;

    // Step 2: Load the full session, scoping attempts to ONLY authorized questions.
    // Defense-in-depth:
    //   - `where` on attempts: filters out any QuestionAttempt whose question does not
    //     belong to session.assessmentId (protects against legacy rogue rows and future bugs).
    //   - `assessments` include on question: fetches AssessmentQuestion.points for THIS
    //     specific assessment (FIX 2 — correct per-assessment scoring).
    return await prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        assessment: {
          include: {
            questions: {
              select: {
                questionId: true,
                points: true,
              },
            },
          },
        },
        attempts: {
          where: {
            question: {
              assessments: {
                some: { assessmentId },
              },
            },
          },
          include: {
            question: {
              include: {
                options: true,
                testCases: true,
                // Include the AssessmentQuestion row for this specific assessment
                // so grading can read the authoritative AssessmentQuestion.points value.
                assessments: {
                  where: { assessmentId },
                  select: { points: true },
                },
                questionLanguages: {
                  include: { language: true },
                },
              },
            },
          },
        },
      },
    });
  }

  async createResult(sessionId: string) {
    const existing = await prisma.result.findUnique({ where: { sessionId } });
    if (existing) {
      await prisma.questionResult.deleteMany({ where: { resultId: existing.id } });
      
      // Issue 10B: Clean up orphaned Executions from partial previous grading attempt
      const attempts = await prisma.questionAttempt.findMany({
        where: { sessionId },
        select: { id: true }
      });
      const attemptIds = attempts.map(a => a.id);
      if (attemptIds.length > 0) {
        await prisma.execution.deleteMany({
          where: { attemptId: { in: attemptIds } }
        });
      }

      return existing;
    }
    
    return await prisma.result.create({
      data: {
        sessionId,
        totalScore: 0,
        maxScore: 0,
        percentage: 0
      }
    });
  }

  async getAssessmentQuestionMapping(assessmentId: string) {
    return await prisma.assessmentQuestion.findMany({
      where: { assessmentId },
      select: { questionId: true, points: true }
    });
  }

  async createQuestionResult(resultId: string, questionId: string, score: number, maxScore: number, isCorrect: boolean) {
    return await prisma.questionResult.create({
      data: {
        resultId,
        questionId,
        score,
        maxScore,
        isCorrect
      }
    });
  }

  async createExecution(attemptId: string, languageName: string, code: string, status: ExecutionStatus, output: string | null, testCaseResults: any, executionTimeMs?: number) {
    const lang = await prisma.programmingLanguage.upsert({
      where: { name: languageName },
      update: {},
      create: { name: languageName }
    });

    return await prisma.execution.create({
      data: {
        attemptId,
        languageId: lang.id,
        code,
        status,
        output,
        testCaseResults,
        executionTimeMs
      }
    });
  }

  async finalizeResult(resultId: string, totalScore: number, maxScore: number, passingPercentage: number) {
    const percentage = maxScore > 0 ? (totalScore / maxScore) * 100 : 0;

    return await prisma.result.update({
      where: { id: resultId },
      data: {
        totalScore,
        maxScore,
        percentage,
        isPassed: percentage >= passingPercentage
      }
    });
  }
}

export const gradingRepository = new GradingRepository();
