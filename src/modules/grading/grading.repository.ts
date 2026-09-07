import { prisma } from '../../lib/prisma.js';
import { ExecutionStatus } from '@prisma/client';

export class GradingRepository {
  async getUnscoredSessionData(sessionId: string) {
    return await prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        assessment: true,
        attempts: {
          include: {
            question: {
              include: {
                options: true,
                testCases: true
              }
            }
          }
        }
      }
    });
  }

  async createResult(sessionId: string) {
    const existing = await prisma.result.findUnique({ where: { sessionId } });
    if (existing) {
      await prisma.questionResult.deleteMany({ where: { resultId: existing.id } });
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

  async finalizeResult(resultId: string, totalScore: number, maxScore: number) {
    const percentage = maxScore > 0 ? (totalScore / maxScore) * 100 : 0;
    
    return await prisma.result.update({
      where: { id: resultId },
      data: {
        totalScore,
        maxScore,
        percentage,
        isPassed: percentage >= 70 // Arbitrary threshold for MVP
      }
    });
  }
}

export const gradingRepository = new GradingRepository();
