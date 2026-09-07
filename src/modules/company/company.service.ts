import { companyRepository } from './company.repository.js';
import { AppError } from '../../utils/AppError.js';

export class CompanyService {
  async createCompany(name: string) {
    // 1. Business Logic / Validation
    const existingCompany = await companyRepository.findByName(name);
    if (existingCompany) {
      // 2. Use our centralized error handler
      throw new AppError('A company with this name already exists.', 400);
    }

    // 3. Delegate to Repository
    return await companyRepository.create({ name });
  }

  async getAllCompanies() {
    return await companyRepository.findAll();
  }
}

export const companyService = new CompanyService();
