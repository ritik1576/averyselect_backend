import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

// Extend the Express Request type for candidates
declare global {
  namespace Express {
    interface Request {
      sessionData?: {
        sessionId: string;
        candidateId: string;
        assessmentId: string;
      };
    }
  }
}

export const requireSession = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new AppError('You are not authorized. Please provide a session token.', 401));
  }

  const token = authHeader.split(' ')[1];

  try {
    // Verify the candidate session token
    const decoded = jwt.verify(token, env.JWT_SECRET) as { 
      sessionId: string; 
      candidateId: string;
      assessmentId: string;
    };
    
    req.sessionData = decoded;
    
    next();
  } catch (error) {
    return next(new AppError('Invalid or expired session token', 401));
  }
};
