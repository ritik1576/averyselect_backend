import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { AppError } from '../../utils/AppError.js';
import { publicRepository } from './public.repository.js';
import { QuestionType } from '@prisma/client';

export class PublicService {
  async getAssessmentByToken(token: string) {
    const link = await publicRepository.findAssessmentByToken(token);
    
    if (!link) {
      throw new AppError('Invalid assessment link', 404);
    }
    if (!link.isActive) {
      throw new AppError('This assessment link is no longer active', 403);
    }
    if (link.assessment.deletedAt !== null) {
      throw new AppError('This assessment has been deleted', 404);
    }

    // Only return safe public info
    return {
      title: link.assessment.title,
      description: link.assessment.description,
      durationMinutes: link.assessment.durationMinutes,
      companyName: link.assessment.company.name,
      assessmentId: link.assessment.id,
      securitySetting: link.assessment.securitySetting
    };
  }

  async startSession(token: string, email: string, name: string) {
    // 1. Verify link
    const link = await publicRepository.findAssessmentByToken(token);
    if (!link || !link.isActive || link.assessment.deletedAt !== null) {
      throw new AppError('Invalid or inactive assessment link', 403);
    }

    const companyId = link.assessment.companyId;
    const assessmentId = link.assessment.id;

    // 2. Upsert Candidate
    const candidate = await publicRepository.upsertCandidate(companyId, email, name);

    // 3. Find existing session or create new
    let session = await publicRepository.findSessionByCandidateAndAssessment(candidate.id, assessmentId);
    
    if (session) {
      if (session.status === 'COMPLETED') {
        throw new AppError('You have already completed this assessment.', 403);
      }
      
      // If they are resuming, strictly enforce their timer.
      // If time is up, this throws an error and auto-submits their session.
      await this.enforceTimer(session);
    } else {
      session = await publicRepository.createSession(candidate.id, assessmentId);
    }

    // 4. Generate Session JWT
    const sessionToken = jwt.sign(
      { 
        sessionId: session.id,
        candidateId: candidate.id,
        assessmentId: assessmentId
      },
      env.JWT_SECRET,
      { expiresIn: '24h' } // Sessions valid for 24h
    );

    return {
      sessionToken,
      sessionId: session.id
    };
  }

  private async enforceTimer(session: any) {
    if (session.status === 'COMPLETED') {
      throw new AppError('Session is already completed', 403);
    }
    
    const now = new Date().getTime();
    const started = new Date(session.startedAt).getTime();
    const durationMs = (session.assessment?.durationMinutes || 60) * 60 * 1000;
    
    // 1 minute grace period for network latency
    if (now > started + durationMs + 60000) {
      await this.finishSession(session.id);
      throw new AppError('Time is up! Your session has been automatically submitted.', 403);
    }
  }

  async getSessionQuestions(sessionId: string, assessmentId: string) {
    const session = await publicRepository.findSessionById(sessionId);
    if (!session) throw new AppError('Session not found', 404);
    
    await this.enforceTimer(session);

    const questions = await publicRepository.getAssessmentQuestions(assessmentId);

    // CRITICAL SECURITY STEP: Data Stripping
    // We must never send `isCorrect` or hidden `expectedOutput` to the client.
    
    return questions.map(aq => {
      const q = aq.question;
      
      const strippedOptions = q.options.map(opt => {
        // Exclude isCorrect
        const { isCorrect, ...safeOption } = opt;
        return safeOption;
      });

      const strippedTestCases = q.testCases.map(tc => {
        if (tc.isHidden) {
          // If hidden, hide the expectedOutput (and maybe input too, but usually just output so they can't hardcode)
          const { expectedOutput, ...safeTestCase } = tc;
          return safeTestCase;
        }
        return tc;
      });

      return {
        questionId: q.id,
        title: q.title,
        text: q.text,
        type: q.type,
        points: aq.points,
        orderIdx: aq.orderIdx,
        options: q.type === QuestionType.MULTIPLE_CHOICE ? strippedOptions : undefined,
        testCases: q.type === QuestionType.CODING ? strippedTestCases : undefined
      };
    });
  }

  async submitAttempt(sessionId: string, questionId: string, answer: string, language?: string) {
    const session = await publicRepository.findSessionById(sessionId);
    if (!session) throw new AppError('Session not found', 404);
    
    await this.enforceTimer(session);

    return await publicRepository.upsertQuestionAttempt(sessionId, questionId, answer, language);
  }

  async finishSession(sessionId: string) {
    const session = await publicRepository.findSessionById(sessionId);
    if (!session) throw new AppError('Session not found', 404);
    if (session.status === 'COMPLETED') throw new AppError('Session is already completed', 403);

    const updatedSession = await publicRepository.finishSession(sessionId);

    // Trigger auto-grading in the background
    // We intentionally don't await this so the API responds instantly
    import('../grading/grading.service.js').then(({ gradingService }) => {
      gradingService.gradeSession(sessionId).catch(console.error);
    });

    return updatedSession;
  }
  async logActivityEvent(sessionId: string, eventType: any, details: any) {
    const session = await publicRepository.findSessionById(sessionId);
    if (!session) {
      throw new AppError('Session not found', 404);
    }
    await this.enforceTimer(session);
    return await publicRepository.logActivityEvent(sessionId, eventType, details);
  }
}

export const publicService = new PublicService();
