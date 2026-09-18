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
      data.executionMode = 'FULL_PROGRAM';
      data.functionContract = null;
    } 
    else if (data.type === QuestionType.CODING) {
      if (!data.testCases || data.testCases.length < 1) {
        throw new AppError('Coding questions must have at least 1 test case.', 400);
      }
      
      // Execution Invariants
      const mode = data.executionMode || 'FULL_PROGRAM';
      if (mode === 'FULL_PROGRAM') {
        if (data.functionContract !== null && data.functionContract !== undefined) {
          throw new AppError('FULL_PROGRAM questions must not define a functionContract.', 400);
        }
      } else if (mode === 'FUNCTION') {
        if (!data.functionContract) {
          throw new AppError('FUNCTION questions must define a valid functionContract.', 400);
        }
      }
      
      // Ensure options is undefined for coding questions
      data.options = undefined;
    }
    // TEXT type needs neither, so we strip both
    else if (data.type === QuestionType.TEXT) {
      data.options = undefined;
      data.testCases = undefined;
      data.executionMode = 'FULL_PROGRAM';
      data.functionContract = null;
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
      throw new AppError('Cannot edit a question that is already assigned to an assessment. Duplicate the question to make changes.', 400);
    }
    
    const finalType = data.type || question.type;
    
    if (finalType !== QuestionType.CODING) {
      if (data.executionMode !== undefined || data.functionContract !== undefined) {
         throw new AppError('executionMode and functionContract can only be provided for CODING questions.', 400);
      }
      // If changing an existing CODING question to a non-CODING type, we must reset the execution configuration
      if (question.type === QuestionType.CODING) {
        data.executionMode = 'FULL_PROGRAM';
        data.functionContract = null;
      }
    } else {
      const mode = data.executionMode !== undefined ? data.executionMode : (question as any).executionMode;
      const contract = data.functionContract !== undefined ? data.functionContract : (question as any).functionContract;
      
      if (mode === 'FULL_PROGRAM' && contract !== null && contract !== undefined) {
          throw new AppError('FULL_PROGRAM questions must not define a functionContract.', 400);
      }
      if (mode === 'FUNCTION' && !contract) {
          throw new AppError('FUNCTION questions must define a valid functionContract.', 400);
      }
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
