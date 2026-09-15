import { prisma } from '../../lib/prisma.js';
import { AttemptStatus, SessionStatus, ActivityEventType } from '@prisma/client';

export class PublicRepository {
  async findAssessmentByToken(token: string) {
    return await prisma.assessmentLink.findUnique({
      where: { token },
      include: {
        assessment: {
          include: {
            company: true,
            securitySetting: true,
            _count: { select: { questions: true } }
          }
        }
      }
    });
  }

  async upsertCandidate(companyId: string, email: string, name: string) {
    // Check if candidate exists for this company
    const existing = await prisma.candidate.findFirst({
      where: { companyId, email }
    });

    if (existing) {
      return await prisma.candidate.update({
        where: { id: existing.id },
        data: { name } // Update name if it changed
      });
    }

    return await prisma.candidate.create({
      data: {
        companyId,
        email,
        name
      }
    });
  }

  async createSession(candidateId: string, assessmentId: string) {
    return await prisma.session.create({
      data: {
        candidateId,
        assessmentId,
        status: SessionStatus.STARTED
      }
    });
  }

  async findSessionByCandidateAndAssessment(candidateId: string, assessmentId: string) {
    return await prisma.session.findFirst({
      where: { candidateId, assessmentId }
    });
  }

  async findSessionById(sessionId: string) {
    return await prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        assessment: {
          select: { durationMinutes: true }
        }
      }
    });
  }

  async getAssessmentQuestions(assessmentId: string) {
    // Only return questions that are not soft-deleted
    return await prisma.assessmentQuestion.findMany({
      where: { 
        assessmentId,
        question: { deletedAt: null }
      },
      include: {
        question: {
          include: {
            options: true,
            testCases: true,
            questionLanguages: { include: { language: true } }
          }
        }
      },
      orderBy: { orderIdx: 'asc' }
    });
  }


  async verifyQuestionInAssessment(questionId: string, assessmentId: string) {
    const aq = await prisma.assessmentQuestion.findUnique({
      where: {
        assessmentId_questionId: {
          assessmentId,
          questionId
        }
      },
      include: {
        question: { select: { deletedAt: true } }
      }
    });
    return aq !== null && aq.question.deletedAt === null;
  }

  async upsertQuestionAttempt(sessionId: string, questionId: string, answer: string, language?: string) {
    return await prisma.questionAttempt.upsert({
      where: {
        sessionId_questionId: {
          sessionId,
          questionId
        }
      },
      update: {
        answer,
        language,
        status: AttemptStatus.SUBMITTED
      },
      create: {
        sessionId,
        questionId,
        answer,
        language,
        status: AttemptStatus.SUBMITTED
      }
    });
  }

  async finishSession(sessionId: string) {
    return await prisma.session.update({
      where: { id: sessionId },
      data: {
        status: SessionStatus.COMPLETED,
        completedAt: new Date()
      }
    });
  }
  async logActivityEvent(sessionId: string, eventType: ActivityEventType, details: any) {
    return await prisma.activityEvent.create({
      data: {
        sessionId,
        eventType,
        details
      }
    });
  }
}

export const publicRepository = new PublicRepository();
