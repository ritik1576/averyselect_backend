import { Router } from 'express';
import { publicController } from './public.controller.js';
import { requireSession } from '../../middleware/sessionMiddleware.js';

const router = Router();

// 1. Unprotected public routes (accessed via token in the URL)
router.get('/assessments/:token', publicController.getAssessmentInfo);
router.post('/assessments/:token/start', publicController.startSession);

// 2. Protected candidate session routes (require Session JWT)
router.use('/sessions', requireSession); // Apply to all /sessions routes

router.get('/sessions/questions', publicController.getSessionQuestions);
router.post('/sessions/questions/:questionId/attempt', publicController.submitAttempt);
router.post('/sessions/events', publicController.logEvent);
router.post('/sessions/finish', publicController.finishSession);

export default router;
