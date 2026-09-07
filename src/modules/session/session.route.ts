import { Router } from 'express';
import { sessionController } from './session.controller.js';
import { requireAuth } from '../../middleware/authMiddleware.js';

const router = Router();

// Apply auth middleware to all session routes (Recruiter context)
router.use(requireAuth);

router.get('/', sessionController.getAllSessions);
router.get('/:sessionId/report', sessionController.getSessionReport);
router.patch('/:sessionId/score', sessionController.updateQuestionScore);
router.patch('/:sessionId/review', sessionController.updateReviewStatus);

export default router;
