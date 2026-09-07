import { Router } from 'express';
import { userController } from './user.controller.js';
import { requireAuth } from '../../middleware/authMiddleware.js';

export const userRouter = Router();

userRouter.get('/me', requireAuth, userController.getMe);
userRouter.patch('/me', requireAuth, userController.updateMe);
userRouter.get('/', userController.getUsers);
userRouter.get('/:id', userController.getUser);
userRouter.post('/', userController.createUser);
