import { Router } from 'express';
import { questionController } from './question.controller.js';
import { requireAuth } from '../../middleware/authMiddleware.js';

const router = Router();

// All question routes require authentication
router.use(requireAuth);

router.post('/', questionController.create.bind(questionController));
router.get('/', questionController.getAll.bind(questionController));
router.get('/:id', questionController.getById.bind(questionController));
router.put('/:id', questionController.update.bind(questionController));
router.delete('/:id', questionController.delete.bind(questionController));

export default router;
