import express, { Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import { env } from './config/env.js';
import { userRouter } from './modules/user/user.route.js';
import companyRouter from './modules/company/company.route.js';
import authRouter from './modules/auth/auth.route.js';
import questionRouter from './modules/question/question.route.js';
import assessmentRouter from './modules/assessment/assessment.route.js';
import publicRouter from './modules/public/public.route.js';
import sessionRouter from './modules/session/session.route.js';
import { requireAuth } from './middleware/authMiddleware.js';
import { errorHandler } from './middleware/errorHandler.js';
import { AppError } from './utils/AppError.js';

dotenv.config();

const app = express();
const port = env.PORT;

// CORS Middleware - allow cross-origin requests and handle preflights
app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, PUT, PATCH, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  next();
});

app.use(express.json());

// Public routes (Recruiter Auth & Candidate Public APIs)
app.use('/api/auth', authRouter);
app.use('/api/public', publicRouter);

// Protected routes (Recruiters only)
app.use('/api/companies', companyRouter);
app.use('/api/users', userRouter);
app.use('/api/questions', questionRouter);
app.use('/api/assessments', assessmentRouter);
app.use('/api/sessions', sessionRouter);

app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', environment: env.NODE_ENV });
});

// 404 Route Handler - Catch all undefined routes
app.all('*', (req: Request, res: Response, next: NextFunction) => {
  next(new AppError(`Route ${req.originalUrl} not found on this server`, 404));
});

// Global Error Handling Middleware (must be the last app.use)
app.use(errorHandler);

app.listen(port, () => {
  console.log(`Server is running in ${env.NODE_ENV} mode on port ${port}`);
});
