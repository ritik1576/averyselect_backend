import { gradingRepository } from './grading.repository.js';
import { QuestionType, ExecutionStatus } from '@prisma/client';
import { executionEngine, type EngineResult } from '../execution/execution.engine.js';

export class GradingService {
  // Simple in-memory queue to prevent Judge0 rate limit exhaustion
  private static gradingQueue: string[] = [];
  private static isGrading = false;

  async recoverIncompleteGrading() {
    try {
      const incompleteSessions = await gradingRepository.getIncompleteGradingSessions();
      if (incompleteSessions.length > 0) {
        console.log(`[GradingRecovery] Found ${incompleteSessions.length} incomplete grading sessions. Resuming...`);
        for (const session of incompleteSessions) {
          this.gradeSession(session.id);
        }
      }
    } catch (e) {
      console.error('[GradingRecovery] Error during startup recovery:', e);
    }
  }

  async gradeSession(sessionId: string) {
    if (!GradingService.gradingQueue.includes(sessionId)) {
      GradingService.gradingQueue.push(sessionId);
    }
    this.processQueue();
  }

  private async processQueue() {
    if (GradingService.isGrading || GradingService.gradingQueue.length === 0) return;
    GradingService.isGrading = true;

    while (GradingService.gradingQueue.length > 0) {
      const sessionId = GradingService.gradingQueue.shift();
      if (sessionId) {
        try {
          await this.executeGrading(sessionId);
        } catch (e) {
          console.error(`Error grading session ${sessionId}:`, e);
        }
        // Add a 2-second cooldown between grading candidates to let Judge0 breathe
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    GradingService.isGrading = false;
  }

  async executeGrading(sessionId: string) {
    try {
      // 10A Idempotency Guard
      const existingResult = await gradingRepository.getResultBySessionId(sessionId);
      if (existingResult && existingResult.isPassed !== null) {
        return;
      }

      const data = await gradingRepository.getUnscoredSessionData(sessionId);
      if (!data) return;
      if (data.status !== 'COMPLETED') return;

      const result = await gradingRepository.createResult(sessionId);
      
      let totalScore = 0;
      // Authoritative maxScore must be the sum of AssessmentQuestion.points for ALL questions
      // assigned to this assessment, regardless of whether candidate attempted them.
      const assignedQuestions = data.assessment?.questions ?? await gradingRepository.getAssessmentQuestionMapping(data.assessmentId);
      const maxScore = assignedQuestions.reduce((sum, aq) => sum + (aq.points || 0), 0);

      // Iterate through attempts and evaluate
      for (const attempt of data.attempts) {
        const question = attempt.question;
        // AssessmentQuestion.points is the ONLY authoritative score for a question
        // within this assessment. The assessments array is pre-filtered to exactly
        // session.assessmentId by getUnscoredSessionData, so [0] is always THIS
        // assessment's row (if it exists).
        // If the row is missing (data-integrity failure), log and skip — do NOT fall
        // back to Question.points, which is the question-bank default and NOT
        // per-assessment authoritative.
        const aqPoints = question.assessments[0]?.points;
        if (aqPoints === undefined) {
          console.error(
            `[grading] CONFIGURATION_ERROR: No AssessmentQuestion row found for ` +
            `question ${question.id} in session ${sessionId}. Skipping attempt.`
          );
          continue;
        }
        const qMaxScore = aqPoints;

        let qScore = 0;
        let isCorrect = false;

        if (question.type === QuestionType.MULTIPLE_CHOICE) {
          const selectedOption = question.options.find((opt: any) => opt.id === (attempt.answer || ''));
          if (selectedOption && selectedOption.isCorrect) {
            isCorrect = true;
            qScore = qMaxScore;
          }
          await gradingRepository.createQuestionResult(result.id, question.id, qScore, qMaxScore, isCorrect);
        }
        else if (question.type === QuestionType.CODING) {
          const attemptLanguage = (attempt.language || '').trim().toLowerCase();
          const configuredLanguages = (question.questionLanguages || []).map((ql: any) => ql.language.name.toLowerCase());
          
          if (!configuredLanguages.includes(attemptLanguage)) {
            console.error(`[grading] CONFIGURATION_ERROR: Unauthorized language '${attemptLanguage}' for question ${question.id}. Skipping execution.`);
            
            await gradingRepository.createExecution(
              attempt.id,
              attemptLanguage || 'unknown',
              attempt.answer || '',
              ExecutionStatus.ERROR,
              `CONFIGURATION_ERROR: Language ${attemptLanguage} is not allowed for this question.`,
              [],
              0
            );

            await gradingRepository.createQuestionResult(result.id, question.id, 0, qMaxScore, false);
            totalScore += 0;
            continue;
          }

          // Use the shared ExecutionEngine — the single source of truth for execution.
          // executionMode and functionContract are sourced exclusively from the Question record.
          const engineResult: EngineResult = await executionEngine.execute({
            code: attempt.answer || '',
            language: attemptLanguage,
            executionMode: question.executionMode as 'FULL_PROGRAM' | 'FUNCTION',
            functionContract: (question.functionContract as any) ?? null,
            comparisonMode: (question as any).comparisonMode || 'TRIMMED',
            testCases: question.testCases.map((tc: any) => ({
              id: tc.id,
              input: tc.input,
              expectedOutput: tc.expectedOutput,
              isHidden: tc.isHidden ?? false,
            })),
          });

          // Map EngineResult status to Prisma ExecutionStatus
          const prismaStatus =
            engineResult.status === 'PASSED'
              ? ExecutionStatus.PASSED
              : engineResult.status === 'FAILED'
              ? ExecutionStatus.FAILED
              : ExecutionStatus.ERROR;

          await gradingRepository.createExecution(
            attempt.id,
            attempt.language || 'javascript',
            attempt.answer || '',
            prismaStatus,
            engineResult.output,
            engineResult.testCaseResults,
            engineResult.executionTimeMs
          );

          if (engineResult.status === 'PASSED') {
            isCorrect = true;
            qScore = qMaxScore;
          } else if (engineResult.status === 'FAILED' && engineResult.passCount > 0) {
            // Partial credit MVP
            qScore = Math.round((engineResult.passCount / question.testCases.length) * qMaxScore);
          }

          await gradingRepository.createQuestionResult(result.id, question.id, qScore, qMaxScore, isCorrect);
        }

        totalScore += qScore;
      }

      const passingPercentage = data.assessment?.passingPercentage ?? 60;
      await gradingRepository.finalizeResult(result.id, totalScore, maxScore, passingPercentage);

    } catch (error) {
      console.error('Error during auto-grading:', error);
    }
  }
}

export const gradingService = new GradingService();
