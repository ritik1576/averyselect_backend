import { Router } from 'express';
import { authController } from './auth.controller.js';

const router = Router();

// /api/auth/login
router.post('/login', authController.login.bind(authController));

// /api/auth/signup
router.post('/signup', authController.signup.bind(authController));

export default router;
