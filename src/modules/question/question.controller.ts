import { Request, Response, NextFunction } from 'express';
import { questionService } from './question.service.js';
import { z } from 'zod';
import { AppError } from '../../utils/AppError.js';
import { QuestionType } from '@prisma/client';

// Shared base schema
const baseQuestionSchema = z.object({
  title: z.string().min(3, 'Title is too short'),
  text: z.string().min(10, 'Question text is too short'),
  points: z.number().int().positive().optional(),
  estimated_time_seconds: z.number().int().positive().optional(),
  difficulty: z.number().int().min(1).max(5).optional(),
});

// Zod schemas for the nested items
const optionSchema = z.object({
  text: z.string().min(1, 'Option text is required'),
  isCorrect: z.boolean(),
});

const testCaseSchema = z.object({
  input: z.string(),
  expectedOutput: z.string(),
  isHidden: z.boolean().default(false),
});

// Discriminated union to strictly enforce the shape based on 'type'
const createQuestionSchema = z.discriminatedUnion('type', [
  baseQuestionSchema.extend({
    type: z.literal(QuestionType.MULTIPLE_CHOICE),
    options: z.array(optionSchema).min(2),
  }),
  baseQuestionSchema.extend({
    type: z.literal(QuestionType.CODING),
    testCases: z.array(testCaseSchema).min(1),
  }),
  baseQuestionSchema.extend({
    type: z.literal(QuestionType.TEXT),
  }),
]);

const updateQuestionSchema = baseQuestionSchema.partial().extend({
  options: z.array(optionSchema).optional(),
  testCases: z.array(testCaseSchema).optional(),
});

import { catchAsync } from '../../utils/catchAsync.js';

export class QuestionController {
  
  create = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const parseResult = createQuestionSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new AppError(parseResult.error.issues[0].message, 400);
    }

    // Add companyId from authenticated user
    const data = {
      ...parseResult.data,
      companyId: req.user!.companyId,
    };

    const result = await questionService.createQuestion(data);
    
    res.status(201).json({
      success: true,
      data: result,
    });
  });

  getAll = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const companyId = req.user!.companyId;
    
    // Parse pagination from query
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    
    // Parse filters
    const search = req.query.search as string | undefined;
    const typeStr = req.query.type as string | undefined;
    const difficultyStr = req.query.difficulty as string | undefined;
    const domain = req.query.domain as string | undefined;
    
    const type = typeStr ? (typeStr as QuestionType) : undefined;
    const difficulty = difficultyStr ? parseInt(difficultyStr) : undefined;
    
    const results = await questionService.getAllQuestions(companyId, page, limit, search, type, difficulty, domain);
    
    res.status(200).json({
      success: true,
      data: results.data,
      meta: results.meta
    });
  });

  getById = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const companyId = req.user!.companyId;
    const { id } = req.params;
    
    const result = await questionService.getQuestionById(id, companyId);
    
    res.status(200).json({
      success: true,
      data: result,
    });
  });

  update = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const parseResult = updateQuestionSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new AppError(parseResult.error.issues[0].message, 400);
    }

    const companyId = req.user!.companyId;
    const { id } = req.params;
    
    const result = await questionService.updateQuestion(id, companyId, parseResult.data);
    
    res.status(200).json({
      success: true,
      data: result,
    });
  });

  delete = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const companyId = req.user!.companyId;
    const { id } = req.params;
    
    await questionService.deleteQuestion(id, companyId);
    
    res.status(200).json({
      success: true,
      message: 'Question deleted successfully',
    });
  });
}

export const questionController = new QuestionController();
