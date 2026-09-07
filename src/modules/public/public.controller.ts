import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { catchAsync } from '../../utils/catchAsync.js';
import { publicService } from './public.service.js';

export class PublicController {
  
  getAssessmentInfo = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const { token } = req.params;
    const data = await publicService.getAssessmentByToken(token);
    
    res.status(200).json({
      success: true,
      data
    });
  });

  startSession = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const { token } = req.params;
    
    const schema = z.object({
      name: z.string().min(2, 'Name must be at least 2 characters'),
      email: z.string().email('Invalid email address')
    });
    const parsedBody = schema.parse(req.body);

    const data = await publicService.startSession(token, parsedBody.email, parsedBody.name);

    res.status(201).json({
      success: true,
      data
    });
  });

  getSessionQuestions = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const { sessionId, assessmentId } = req.sessionData!; // Provided by requireSession

    const data = await publicService.getSessionQuestions(sessionId, assessmentId);

    res.status(200).json({
      success: true,
      data
    });
  });

  submitAttempt = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const { sessionId } = req.sessionData!; // Provided by requireSession
    const { questionId } = req.params;

    const schema = z.object({
      answer: z.string().min(1, 'Answer is required'),
      language: z.string().optional()
    });
    const parsedBody = schema.parse(req.body);

    const data = await publicService.submitAttempt(sessionId, questionId, parsedBody.answer, parsedBody.language);

    res.status(200).json({
      success: true,
      data
    });
  });

  finishSession = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const { sessionId } = req.sessionData!; // Provided by requireSession

    await publicService.finishSession(sessionId);

    res.status(200).json({
      success: true,
      message: 'Session finished successfully'
    });
  });
  logEvent = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const { sessionId } = req.sessionData!; // Provided by requireSession

    const schema = z.object({
      eventType: z.enum(['TAB_SWITCHED', 'LARGE_PASTE_DETECTED', 'QUESTION_OPENED', 'CODE_CHANGED', 'FULLSCREEN_EXITED', 'COPY_ATTEMPTED']),
      details: z.any().optional()
    });
    const parsedBody = schema.parse(req.body);

    const data = await publicService.logActivityEvent(sessionId, parsedBody.eventType, parsedBody.details);

    res.status(201).json({
      success: true,
      data
    });
  });
}

export const publicController = new PublicController();
