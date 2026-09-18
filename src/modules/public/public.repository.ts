import { prisma } from '../../lib/prisma.js';
import { AttemptStatus, SessionStatus, ActivityEventType } from '@prisma/client';

export class PublicRepository {
  async findAssessmentByToken(token: string) {
    // 1. Check assessmentLink
    const link = await prisma.assessmentLink.findUnique({
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
    if (link) return link;

    // 2. Check assessmentInvitation
    const invite = await prisma.assessmentInvitation.findUnique({
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
    if (invite) {
      return {
        id: invite.id,
        assessmentId: invite.assessmentId,
        token: invite.token,
        email: invite.email,
        isActive: !(invite.status === "EXPIRED" || (invite.expiresAt && new Date() > invite.expiresAt)),
        assessment: invite.assessment,
      };
    }

    return null;
  }

  async markInvitationOpened(token: string) {
    try {
      const invite = await prisma.assessmentInvitation.findUnique({ where: { token } });
      if (invite && invite.status === "SENT") {
        await prisma.assessmentInvitation.update({
          where: { token },
          data: { status: "OPENED", openedAt: new Date() }
        });
      }
    } catch (e) {
      console.error("Error marking invitation opened:", e);
    }
  }

  async markInvitationStarted(token: string, email: string, assessmentId: string) {
    try {
      // First try by token
      const inviteByToken = await prisma.assessmentInvitation.findUnique({ where: { token } });
      if (inviteByToken && (inviteByToken.status === "SENT" || inviteByToken.status === "OPENED")) {
        await prisma.assessmentInvitation.update({
          where: { token },
          data: { status: "STARTED", startedAt: new Date() }
        });
        return;
      }

      // Also match by email and assessmentId if candidate joined via public link
      const inviteByEmail = await prisma.assessmentInvitation.findFirst({
        where: { assessmentId, email: { equals: email, mode: "insensitive" } },
        orderBy: { sentAt: "desc" }
      });
      if (inviteByEmail && (inviteByEmail.status === "SENT" || inviteByEmail.status === "OPENED")) {
        await prisma.assessmentInvitation.update({
          where: { id: inviteByEmail.id },
          data: { status: "STARTED", startedAt: new Date() }
        });
      }
    } catch (e) {
      console.error("Error marking invitation started:", e);
    }
  }

  async markInvitationCompleted(candidateId: string, assessmentId: string) {
    try {
      const candidate = await prisma.candidate.findUnique({ where: { id: candidateId } });
      if (!candidate) return;

      const invite = await prisma.assessmentInvitation.findFirst({
        where: { assessmentId, email: { equals: candidate.email, mode: "insensitive" } },
        orderBy: { sentAt: "desc" }
      });

      if (invite && invite.status !== "COMPLETED") {
        await prisma.assessmentInvitation.update({
          where: { id: invite.id },
          data: { status: "COMPLETED", completedAt: new Date() }
        });
      }
    } catch (e) {
      console.error("Error marking invitation completed:", e);
    }
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
