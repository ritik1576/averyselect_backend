import { Request, Response, NextFunction } from 'express';
import { catchAsync } from '../../utils/catchAsync.js';
import { sessionService } from './session.service.js';
import { z } from 'zod';

// ── Validation schemas ────────────────────────────────────────────────────────

const listSessionsSchema = z.object({
  page:    z.coerce.number().int().min(1).default(1),
  limit:   z.coerce.number().int().min(1).max(100).default(10),
  search:  z.string().max(200).optional(),
  status:  z.enum(['STARTED', 'IN_PROGRESS', 'COMPLETED', 'TERMINATED', 'EXPIRED']).optional(),
  assessmentId: z.string().uuid().optional(),
  reviewStatus: z.enum(['passed', 'rejected', 'to_review']).optional(),
  dateFrom: z.string().optional().refine(v => !v || !isNaN(Date.parse(v)), {
    message: 'dateFrom must be a valid ISO date string'
  }),
  dateTo: z.string().optional().refine(v => !v || !isNaN(Date.parse(v)), {
    message: 'dateTo must be a valid ISO date string'
  }),
  sortBy:  z.enum(['startedAt', 'candidateName', 'assessmentTitle', 'score']).default('startedAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc')
});

const updateScoreSchema = z.object({
  questionId: z.string().min(1),
  score:      z.number().min(0)
});


const updateReviewStatusSchema = z.object({
  isPassed: z.boolean().nullable()
});

// ── Controller ────────────────────────────────────────────────────────────────

export class SessionController {
  getAllSessions = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
    const { companyId } = req.user!;

    const parsed = listSessionsSchema.parse(req.query);

    const result = await sessionService.getAllSessions(companyId, {
      page:     parsed.page,
      limit:    parsed.limit,
      search:   parsed.search,
      status:   parsed.status,
      assessmentId: parsed.assessmentId,
      reviewStatus: parsed.reviewStatus,
      dateFrom: parsed.dateFrom,
      dateTo:   parsed.dateTo,
      sortBy:   parsed.sortBy,
      sortDir:  parsed.sortDir
    });

    res.status(200).json({
      success: true,
      data: result.data,
      meta: result.meta
    });
  });

  getSessionReport = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
    const { companyId } = req.user!;
    const { sessionId } = req.params;

    const report = await sessionService.getSessionReport(sessionId, companyId);

    res.status(200).json({ success: true, data: report });
  });

  updateQuestionScore = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
    const { companyId } = req.user!;
    const { sessionId } = req.params;

    const parsed = updateScoreSchema.parse(req.body);

    const result = await sessionService.updateQuestionScore(
      sessionId, companyId, parsed.questionId, parsed.score
    );

    res.status(200).json({ success: true, data: result });
  });
  updateReviewStatus = catchAsync(async (req: Request, res: Response, _next: NextFunction) => {
    const { companyId } = req.user!;
    const { sessionId } = req.params;

    const parsed = updateReviewStatusSchema.parse(req.body);

    const result = await sessionService.updateReviewStatus(
      sessionId, companyId, parsed.isPassed
    );

    res.status(200).json({ success: true, data: result });
  });
}


export const sessionController = new SessionController();
