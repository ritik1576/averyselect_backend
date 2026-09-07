import { Router } from 'express';
import { companyController } from './company.controller.js';

const router = Router();

// Create a new company
router.post('/', companyController.create.bind(companyController));

// Get all companies
router.get('/', companyController.getAll.bind(companyController));

export default router;
