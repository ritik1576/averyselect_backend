import { questionRepository, CreateQuestionData } from './question.repository.js';
import { AppError } from '../../utils/AppError.js';
import { QuestionType } from '@prisma/client';

export class QuestionService {
  
  async createQuestion(data: CreateQuestionData) {
    // 1. Validate business rules based on Question Type
    if (data.type === QuestionType.MULTIPLE_CHOICE) {
      if (!data.options || data.options.length < 2) {
        throw new AppError('Multiple choice questions must have at least 2 options.', 400);
      }
      
      const correctOptions = data.options.filter(opt => opt.isCorrect);
      if (correctOptions.length !== 1) {
        throw new AppError('Multiple choice questions must have exactly one correct option.', 400);
      }
      
      // Ensure testCases is undefined for multiple choice
      data.testCases = undefined;
    } 
    else if (data.type === QuestionType.CODING) {
      if (!data.testCases || data.testCases.length < 1) {
        throw new AppError('Coding questions must have at least 1 test case.', 400);
      }
      
      // Ensure options is undefined for coding questions
      data.options = undefined;
    }
    // TEXT type needs neither, so we strip both
    else if (data.type === QuestionType.TEXT) {
      data.options = undefined;
      data.testCases = undefined;
    }

    // 2. Delegate to repository
    return await questionRepository.create(data);
  }

  async getAllQuestions(companyId: string, page: number = 1, limit: number = 10, search?: string, type?: QuestionType, difficulty?: number, domain?: string) {
    return await questionRepository.findAllByCompany(companyId, page, limit, search, type, difficulty, domain);
  }

  async getQuestionById(id: string, companyId: string) {
    const question = await questionRepository.findById(id, companyId);
    if (!question) {
      throw new AppError('Question not found or access denied', 404);
    }
    return question;
  }  async updateQuestion(id: string, companyId: string, data: Partial<CreateQuestionData>) {
    // Verify ownership and get question
    const question = await this.getQuestionById(id, companyId);
    
    if (question._count?.assessments > 0) {
      throw new AppError('This question is already used in an assessment and cannot be edited. Please create a new question.', 400);
    }
    
    // Perform update
    return await questionRepository.update(id, data);
  }  async deleteQuestion(id: string, companyId: string) {
    // Verify ownership first
    const question = await this.getQuestionById(id, companyId);
    
    if (question._count?.assessments > 0) {
      throw new AppError('This question is already used in an assessment and cannot be deleted.', 400);
    }
    
    // Proceed with deletion
    return await questionRepository.delete(id, companyId);
  }
}

export const questionService = new QuestionService();
