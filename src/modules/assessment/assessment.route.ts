import { Router } from 'express';
import { assessmentController } from './assessment.controller.js';
import { requireAuth } from '../../middleware/authMiddleware.js';

const router = Router();

// All assessment routes require authentication
router.use(requireAuth);

router.post('/', assessmentController.create);
router.get('/', assessmentController.getAll);
router.get('/:id', assessmentController.getById);
router.put('/:id', assessmentController.update);
router.delete('/:id', assessmentController.delete);
router.post('/:id/archive', assessmentController.archive);
router.post('/:id/duplicate', assessmentController.duplicate);

// Link routes
router.post('/:id/links', assessmentController.createLink);
router.get('/:id/links', assessmentController.getLinks);
router.patch('/:id/links/:linkId', assessmentController.updateLinkStatus);

// Results
router.get('/:id/results', assessmentController.getResults);

// Invites
router.post('/:id/invites', assessmentController.createInvites);
router.get('/:id/invites', assessmentController.getInvites);
router.post('/:id/invites/:inviteId/resend', assessmentController.resendInvite);

export default router;
