import { Request, Response, NextFunction } from 'express';
import { userService } from './user.service.js';
import { z } from 'zod';
import { AppError } from '../../utils/AppError.js';
import { catchAsync } from '../../utils/catchAsync.js';

// Zod schema for validating user creation
const createUserSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  companyId: z.string().uuid('Invalid company ID'),
});

const updateUserSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').optional(),
  password: z.string().min(6, 'Password must be at least 6 characters').optional(),
});

export class UserController {
  getMe = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.user?.userId;
    if (!userId) throw new AppError('Not authenticated', 401);
    
    const user = await userService.getUserById(userId);
    if (!user) throw new AppError('User not found', 404);
    
    // Don't send password hash back
    const { password, ...safeUser } = user as any;
    res.status(200).json({ success: true, data: safeUser });
  });

  updateMe = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.user?.userId;
    if (!userId) throw new AppError('Not authenticated', 401);

    const parseResult = updateUserSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new AppError(parseResult.error.issues[0].message, 400);
    }

    const updatedUser = await userService.updateUser(userId, parseResult.data);
    const { password, ...safeUser } = updatedUser as any;
    res.status(200).json({ success: true, data: safeUser });
  });

  getUsers = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const users = await userService.getAllUsers();
    res.status(200).json({ success: true, data: users });
  });

  getUser = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const id = req.params.id; // It's a UUID string now
    const user = await userService.getUserById(id);
    
    if (!user) {
      throw new AppError('User not found', 404);
    }
    
    res.status(200).json({ success: true, data: user });
  });

  createUser = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    // 1. Validate incoming data
    const parseResult = createUserSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new AppError(parseResult.error.issues[0].message, 400);
    }

    // 2. Delegate to service
    const user = await userService.createUser({
      name: parseResult.data.name,
      email: parseResult.data.email,
      passwordHash: parseResult.data.password,
      companyId: parseResult.data.companyId,
    });

    // 3. Respond
    res.status(201).json({ success: true, data: user });
  });
}

export const userController = new UserController();
