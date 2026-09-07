import { Request, Response, NextFunction } from 'express';
import { authService } from './auth.service.js';
import { z } from 'zod';
import { AppError } from '../../utils/AppError.js';

import { catchAsync } from '../../utils/catchAsync.js';

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

const signupSchema = z.object({
  companyName: z.string().min(2, 'Company name must be at least 2 characters'),
  userName: z.string().min(2, 'User name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

export class AuthController {
  login = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    // 1. Validate the payload
    const parseResult = loginSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new AppError(parseResult.error.issues[0].message, 400);
    }

    // 2. Delegate to the service
    const { email, password } = parseResult.data;
    const result = await authService.login(email, password);

    // 3. Return the token and user
    res.status(200).json({
      success: true,
      data: result,
    });
  });

  signup = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    // 1. Validate the payload
    const parseResult = signupSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new AppError(parseResult.error.issues[0].message, 400);
    }

    // 2. Delegate to the service
    const { companyName, userName, email, password } = parseResult.data;
    const result = await authService.signup(companyName, userName, email, password);

    // 3. Return the token, company and user
    res.status(201).json({
      success: true,
      data: result,
    });
  });
}

export const authController = new AuthController();
