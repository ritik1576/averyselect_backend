import { Request, Response, NextFunction } from 'express';

/**
 * Wraps async Express controllers to automatically catch errors and pass them to next().
 * This eliminates the need for repetitive try/catch blocks in every controller method.
 */
export const catchAsync = (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
