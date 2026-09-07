import { Request, Response, NextFunction } from 'express';
import { companyService } from './company.service.js';
import { z } from 'zod';
import { AppError } from '../../utils/AppError.js';
import { catchAsync } from '../../utils/catchAsync.js';

// Zod Schema for validation
const createCompanySchema = z.object({
  name: z.string().min(2, 'Company name must be at least 2 characters'),
});

export class CompanyController {
  create = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    // 1. Validate payload
    const parseResult = createCompanySchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new AppError(parseResult.error.issues[0].message, 400);
    }

    // 2. Delegate to Service
    const { name } = parseResult.data;
    const company = await companyService.createCompany(name);

    // 3. Return JSON exactly as per the rule `{ success: true, data: { ... } }`
    res.status(201).json({
      success: true,
      data: company,
    });
  });

  getAll = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const companies = await companyService.getAllCompanies();
    res.status(200).json({
      success: true,
      data: companies,
    });
  });
}

export const companyController = new CompanyController();
