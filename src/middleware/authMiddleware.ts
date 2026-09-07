import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

// Extend the Express Request type so TypeScript knows req.user exists
declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        companyId: string;
      };
    }
  }
}

export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  // 1. Check if the Authorization header exists
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new AppError('You are not logged in. Please provide a token.', 401));
  }

  // 2. Extract the token (format is "Bearer <token>")
  const token = authHeader.split(' ')[1];

  try {
    // 3. Verify the token using our secret
    const decoded = jwt.verify(token, env.JWT_SECRET) as { userId: string; companyId: string };
    
    // 4. Attach the decoded payload to the request object so future routes can use it
    req.user = decoded;
    
    // 5. Let the request continue to the controller
    next();
  } catch (error) {
    return next(new AppError('Invalid or expired token', 401));
  }
};
