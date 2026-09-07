import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/AppError.js';
import { env } from '../config/env.js';
import { ZodError } from 'zod';

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal Server Error';
  let errors = undefined;

  // Handle Zod Validation Errors
  if (err instanceof ZodError) {
    statusCode = 400;
    message = 'Validation Error';
    errors = (err as any).errors;
    (err as any).isOperational = true;
  }

  // Handle Prisma Unique Constraint Error
  if (err.code === 'P2002') {
    statusCode = 400;
    message = 'This record already exists.';
    err.isOperational = true;
  }

  // Handle known predictable errors vs unknown crashing bugs
  if (!err.isOperational) {
    console.error('💥 ERROR:', err);
    // In production, we don't leak details of unknown errors
    if (env.NODE_ENV === 'production') {
      message = 'Something went very wrong!';
    }
  }

  res.status(statusCode).json({
    success: false,
    message,
    ...(errors && { errors }),
    ...(env.NODE_ENV === 'development' && { stack: err.stack }), // Show stack only in dev
  });
};
