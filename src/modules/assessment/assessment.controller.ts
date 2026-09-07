import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AppError } from '../../utils/AppError.js';
import { catchAsync } from '../../utils/catchAsync.js';
import { assessmentService } from './assessment.service.js';

const assessmentSecuritySettingSchema = z.object({
  fullscreenRequired: z.boolean().optional(),
  tabSwitchDetection: z.boolean().optional(),
  windowFocusDetection: z.boolean().optional(),
  copyPasteBlocking: z.boolean().optional(),
  largePasteDetection: z.boolean().optional(),
  unusualActivityAlerts: z.boolean().optional(),
});

const assessmentQuestionSchema = z.object({
  questionId: z.string().uuid(),
  orderIdx: z.number().int().min(0),
  points: z.number().int().min(1)
});

const createAssessmentSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters'),
  description: z.string().optional(),
  durationMinutes: z.number().int().positive('Duration must be a positive number').optional(),
  passingPercentage: z.number().min(0).max(100).optional(),
  isPublished: z.boolean().optional(),
  securitySetting: assessmentSecuritySettingSchema.optional(),
  questions: z.array(assessmentQuestionSchema).optional().refine(
    (questions) => {
      if (!questions) return true;
      const ids = questions.map(q => q.questionId);
      if (new Set(ids).size !== ids.length) return false;
      
      const orders = questions.map(q => q.orderIdx);
      if (new Set(orders).size !== orders.length) return false;

      return true;
    },
    { message: "Questions must be unique and have unique order indices" }
  )
});


const updateAssessmentSchema = createAssessmentSchema.partial();

export class AssessmentController {
  
  create = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const parseResult = createAssessmentSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new AppError(parseResult.error.issues[0].message, 400);
    }

    const data = {
      ...parseResult.data,
      companyId: req.user!.companyId,
    };

    const result = await assessmentService.createAssessment(data);
    
    res.status(201).json({
      success: true,
      data: result,
    });
  });
  getAll = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const companyId = req.user!.companyId;
    
    // Parse query params
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const search = req.query.search as string;
    const sortBy = req.query.sortBy as string;
    const sortDir = req.query.sortDir as string;
    
    const results = await assessmentService.getAllAssessments(companyId, page, limit, search, sortBy, sortDir);
    
    res.status(200).json({
      success: true,
      data: results.data,
      meta: results.meta
    });
  });

  getById = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const companyId = req.user!.companyId;
    const { id } = req.params;
    
    const result = await assessmentService.getAssessmentById(id, companyId);
    
    res.status(200).json({
      success: true,
      data: result,
    });
  });

  update = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const parseResult = updateAssessmentSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new AppError(parseResult.error.issues[0].message, 400);
    }

    const companyId = req.user!.companyId;
    const { id } = req.params;
    
    const result = await assessmentService.updateAssessment(id, companyId, parseResult.data);
    
    res.status(200).json({
      success: true,
      data: result,
    });
  });

  delete = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const companyId = req.user!.companyId;
    const { id } = req.params;
    
    await assessmentService.deleteAssessment(id, companyId);
    
    res.status(200).json({
      success: true,
      message: 'Assessment deleted successfully',
    });
  });

  // --- Link Management ---

  createLink = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const companyId = req.user!.companyId;
    const { id: assessmentId } = req.params;

    const result = await assessmentService.generateLink(assessmentId, companyId);

    res.status(201).json({
      success: true,
      data: result,
    });
  });

  toggleLinkStatus = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const { id, linkId } = req.params;
    const { isActive } = req.body;
    const companyId = req.user!.companyId;

    const data = await assessmentService.toggleLinkStatus(id, linkId, companyId, isActive);

    res.status(200).json({
      success: true,
      data
    });
  });

  getResults = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const companyId = req.user!.companyId;

    const data = await assessmentService.getAssessmentResults(id, companyId);

    res.status(200).json({
      success: true,
      data
    });
  });

  getLinks = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const companyId = req.user!.companyId;
    const { id: assessmentId } = req.params;

    const result = await assessmentService.getAssessmentLinks(assessmentId, companyId);

    res.status(200).json({
      success: true,
      data: result,
    });
  });

  updateLinkStatus = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const companyId = req.user!.companyId;
    const { id: assessmentId, linkId } = req.params;
    
    // Validate body directly since it's just one boolean field
    if (typeof req.body.isActive !== 'boolean') {
      throw new AppError('isActive must be a boolean', 400);
    }

    const result = await assessmentService.toggleLinkStatus(assessmentId, linkId, companyId, req.body.isActive);

    res.status(200).json({
      success: true,
      data: result,
    });
  });
}

export const assessmentController = new AssessmentController();
