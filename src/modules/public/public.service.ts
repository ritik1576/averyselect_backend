import { getStarterCode, isStaleStarterCode } from "../../utils/starterCode.js";
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

    // Track invitation opened
    await publicRepository.markInvitationOpened(token);

    // Only return safe public info
    return {
      title: link.assessment.title,
      description: link.assessment.description,
      durationMinutes: link.assessment.durationMinutes,
      companyName: link.assessment.company.name,
      assessmentId: link.assessment.id,
      securitySetting: link.assessment.securitySetting,
      questionCount: link.assessment._count.questions
    };
  }

  async startSession(token: string, email: string, name: string) {
    // 1. Verify link
    const link = await publicRepository.findAssessmentByToken(token);
    if (!link || !link.isActive || link.assessment.deletedAt !== null) {
      throw new AppError('Invalid or inactive assessment link', 403);
    }

    // Security check: If it's a private invitation, enforce the email matches
    if ('email' in link && (link as any).email && (link as any).email.toLowerCase() !== email.toLowerCase()) {
      throw new AppError('This invitation is registered to a different email address.', 403);
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

    // Track invitation started
    await publicRepository.markInvitationStarted(token, email, assessmentId);

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

      // Security: completely omit hidden test cases from candidate-facing payload.
      // The frontend only needs public test cases for display. Hidden tests are
      // used exclusively by the server-side ExecutionEngine during final grading.
      const strippedTestCases = q.testCases.filter(tc => !tc.isHidden);

      return {
        questionId: q.id,
        title: q.title,
        text: q.text,
        type: q.type,
        points: aq.points,
        orderIdx: aq.orderIdx,
        options: q.type === QuestionType.MULTIPLE_CHOICE ? strippedOptions : undefined,
        testCases: q.type === QuestionType.CODING ? strippedTestCases : undefined,
        languages: q.type === QuestionType.CODING ? q.questionLanguages.map((l: any) => {
          let sCode = l.starterCode;
          if (q.executionMode === "FUNCTION" && q.functionContract) {
            if (!sCode || isStaleStarterCode(sCode)) {
              sCode = getStarterCode(l.language.name, "FUNCTION", q.functionContract as any);
            }
          }
          return { languageName: l.language.name, starterCode: sCode };
        }) : undefined,
        // Execution contract — required by CandidateTestRunner for Run Code
        executionMode: q.type === QuestionType.CODING ? q.executionMode : undefined,
        functionContract: q.type === QuestionType.CODING ? (q.functionContract ?? null) : undefined,
      };
    });
  }

  async submitAttempt(sessionId: string, questionId: string, answer: string, language?: string) {
    const session = await publicRepository.findSessionById(sessionId);
    if (!session) throw new AppError('Session not found', 404);
    
    await this.enforceTimer(session);

    const isAuthorized = await publicRepository.verifyQuestionInAssessment(questionId, session.assessmentId);
    if (!isAuthorized) {
      throw new AppError('Question not found in this assessment', 404);
    }

    if (language) {
      const { prisma } = await import('../../lib/prisma.js');
      const question = await prisma.question.findUnique({
        where: { id: questionId },
        include: { questionLanguages: { include: { language: true } } }
      });
      if (question && question.type === 'CODING') {
        const normalizedRequestedLang = language.toLowerCase();
        const isLangAllowed = question.questionLanguages.some(
          (ql: any) => ql.language.name.toLowerCase() === normalizedRequestedLang
        );
        if (!isLangAllowed) {
          throw new AppError(`Language '${language}' is not enabled for this question.`, 400);
        }
      }
    }

    return await publicRepository.upsertQuestionAttempt(sessionId, questionId, answer, language);
  }


  async runCode(sessionId: string, questionId: string, code: string, language: string) {
    // Verify session is still active
    const session = await publicRepository.findSessionById(sessionId);
    if (!session) throw new AppError('Session not found', 404);
    await this.enforceTimer(session);

    // Fetch the question with its execution contract and PUBLIC test cases only
    const { prisma } = await import('../../lib/prisma.js');
    const question = await prisma.question.findFirst({
      where: { 
        id: questionId, 
        deletedAt: null,
        assessments: {
          some: { assessmentId: session.assessmentId }
        }
      },
      include: {
        testCases: {
          where: { isHidden: false }, // Run Code only against public test cases
        },
        questionLanguages: {
          include: { language: true }
        }
      },
    });

    if (!question) throw new AppError('Question not found', 404);

    const normalizedRequestedLang = language.toLowerCase();
    const isLangAllowed = question.questionLanguages.some(
      (ql: any) => ql.language.name.toLowerCase() === normalizedRequestedLang
    );
    if (!isLangAllowed) {
      throw new AppError(`Language '${language}' is not enabled for this question.`, 400);
    }

    // Dynamically import the engine (avoids circular deps at startup)
    const { executionEngine } = await import('../execution/execution.engine.js');

    const result = await executionEngine.execute({
      code,
      language: language.toLowerCase(),
      executionMode: question.executionMode as 'FULL_PROGRAM' | 'FUNCTION',
      functionContract: (question.functionContract as any) ?? null,
      comparisonMode: (question as any).comparisonMode || 'TRIMMED',
      testCases: question.testCases.map((tc) => ({
        id: tc.id,
        input: tc.input,
        expectedOutput: tc.expectedOutput,
        isHidden: false,
      })),
    });

    return result;
  }

  async finishSession(sessionId: string) {
    const session = await publicRepository.findSessionById(sessionId);
    if (!session) throw new AppError('Session not found', 404);
    if (session.status === 'COMPLETED') return session; // idempotent — already completed

    const updatedSession = await publicRepository.finishSession(sessionId);
    await publicRepository.markInvitationCompleted(session.candidateId, session.assessmentId);

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
