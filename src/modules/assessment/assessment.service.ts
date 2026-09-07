import crypto from 'crypto';
import { AppError } from '../../utils/AppError.js';
import { assessmentRepository, CreateAssessmentData } from './assessment.repository.js';
import { questionRepository } from '../question/question.repository.js';

export class AssessmentService {
  async createAssessment(data: CreateAssessmentData) {
    // If questions are provided, verify that all questions belong to the company
    if (data.questions && data.questions.length > 0) {
      const questionIds = data.questions.map(q => q.questionId);
      const validCount = await questionRepository.countByIds(questionIds, data.companyId);
      
      if (validCount !== questionIds.length) {
        throw new AppError(`One or more questions are invalid, deleted, or do not belong to your company.`, 404);
      }
    }

    return await assessmentRepository.create(data);
  }
  async getAllAssessments(
    companyId: string, 
    page: number = 1, 
    limit: number = 10,
    search?: string,
    sortBy?: string,
    sortDir?: string
  ) {
    return await assessmentRepository.findAllByCompany(companyId, page, limit, search, sortBy, sortDir);
  }

  async getAssessmentById(id: string, companyId: string) {
    const assessment = await assessmentRepository.findById(id, companyId);
    
    if (!assessment) {
      throw new AppError('Assessment not found', 404);
    }
    
    return assessment;
  }

  async updateAssessment(id: string, companyId: string, data: Partial<CreateAssessmentData>) {
    // 1. Verify existence and ownership
    await this.getAssessmentById(id, companyId);

    // 2. If updating questions, verify ownership
    if (data.questions && data.questions.length > 0) {
      const questionIds = data.questions.map(q => q.questionId);
      const validCount = await questionRepository.countByIds(questionIds, companyId);
      
      if (validCount !== questionIds.length) {
        throw new AppError(`One or more questions are invalid, deleted, or do not belong to your company.`, 404);
      }
    }

    // 3. Perform update
    return await assessmentRepository.update(id, data);
  }

  async deleteAssessment(id: string, companyId: string) {
    // 1. Verify existence and ownership
    await this.getAssessmentById(id, companyId);

    // 2. Perform soft delete
    return await assessmentRepository.delete(id, companyId);
  }

  // --- Link Management ---

  async generateLink(assessmentId: string, companyId: string) {
    // 1. Verify existence and ownership
    await this.getAssessmentById(assessmentId, companyId);

    // 2. Generate a secure random token (e.g., 16 hex chars)
    const token = crypto.randomBytes(8).toString('hex');

    // 3. Save and return link
    return await assessmentRepository.createLink(assessmentId, token);
  }

  async getAssessmentLinks(assessmentId: string, companyId: string) {
    // 1. Verify existence and ownership
    await this.getAssessmentById(assessmentId, companyId);

    // 2. Return links
    return await assessmentRepository.findLinksByAssessment(assessmentId);
  }

  async toggleLinkStatus(assessmentId: string, linkId: string, companyId: string, isActive: boolean) {
    // 1. Verify existence and ownership of the assessment
    await this.getAssessmentById(assessmentId, companyId);

    // 2. Verify link exists
    const link = await assessmentRepository.findLinkById(linkId);
    if (!link) {
      throw new AppError('Link not found', 404);
    }

    // 3. Verify link belongs to this assessment
    if (link.assessmentId !== assessmentId) {
      throw new AppError('Link does not belong to this assessment', 400);
    }

    // 4. Update status
    return await assessmentRepository.updateLinkStatus(linkId, isActive);
  }

  // --- Results Management ---
  async getAssessmentResults(assessmentId: string, companyId: string) {
    // 1. Verify existence and ownership
    await this.getAssessmentById(assessmentId, companyId);

    // 2. Fetch results
    return await assessmentRepository.getResultsByAssessment(assessmentId);
  }
}

export const assessmentService = new AssessmentService();
