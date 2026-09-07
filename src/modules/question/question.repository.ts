import { prisma } from '../../lib/prisma.js';
import { QuestionType } from '@prisma/client';

// Define complex types for inputs
export type CreateOptionData = {
  text: string;
  isCorrect: boolean;
};

export type CreateTestCaseData = {
  input: string;
  expectedOutput: string;
  isHidden: boolean;
};

export type CreateQuestionData = {
  companyId: string;
  title: string;
  text: string;
  type: QuestionType;
  points?: number;
  estimated_time_seconds?: number;
  difficulty?: number;
  options?: CreateOptionData[];
  testCases?: CreateTestCaseData[];
  language?: string;
  starter_code?: string;
};

export class QuestionRepository {
  async create(data: CreateQuestionData) {
    return await prisma.question.create({
      data: {
        companyId: data.companyId,
        title: data.title,
        text: data.text,
        type: data.type,
        points: data.points || 1,
        estimatedTimeSeconds: data.estimated_time_seconds,
        difficulty: data.difficulty || 3,
        options: data.options ? {
          create: data.options
        } : undefined,
        testCases: data.testCases ? {
          create: data.testCases
        } : undefined,
        questionLanguages: (data.language && data.starter_code) ? {
          create: [{
            language: { connectOrCreate: { where: { name: data.language }, create: { name: data.language } } },
            starterCode: data.starter_code
          }]
        } : undefined,
      },
      include: {
        options: true,
        testCases: true,
        _count: { select: { assessments: true } },
      }
    });
  }

  async findAllByCompany(companyId: string, page: number = 1, limit: number = 10, search?: string, type?: QuestionType, difficulty?: number, domain?: string) {
    const where: any = { companyId, deletedAt: null };
    
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { text: { contains: search, mode: 'insensitive' } }
      ];
    }
    if (type) {
      where.type = type;
    }
    if (difficulty) {
      where.difficulty = difficulty;
    }
    if (domain) {
      where.questionDomains = {
        some: {
          domain: {
            name: domain
          }
        }
      };
    }
    
    const skip = (page - 1) * limit;
    
    const [data, total, totalCoding, totalMCQ] = await Promise.all([
      prisma.question.findMany({
        where,
        include: {
          options: true,
          testCases: true,
          _count: { select: { assessments: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.question.count({
        where: { companyId, deletedAt: null },
      }),
      prisma.question.count({
        where: { companyId, deletedAt: null, type: 'CODING' },
      }),
      prisma.question.count({
        where: { companyId, deletedAt: null, type: 'MULTIPLE_CHOICE' },
      })
    ]);

    return {
      data,
      meta: {
        total,
        totalCoding,
        totalMCQ,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  async findById(id: string, companyId: string) {
    return await prisma.question.findFirst({
      where: { 
        id,
        companyId,
        deletedAt: null 
      },
      include: {
        options: true,
        testCases: true,
        _count: { select: { assessments: true } },
      }
    });
  }

  async countByIds(ids: string[], companyId: string) {
    return await prisma.question.count({
      where: {
        id: { in: ids },
        companyId,
        deletedAt: null
      }
    });
  }

  async delete(id: string, companyId: string) {
    // Soft Delete
    return await prisma.question.update({
      where: { id }, // Ownership is verified in service layer
      data: {
        deletedAt: new Date()
      }
    });
  }

  async update(id: string, data: Partial<CreateQuestionData>) {
    return await prisma.question.update({
      where: { id },
      data: {
        title: data.title,
        text: data.text,
        points: data.points,
        estimatedTimeSeconds: data.estimated_time_seconds,
        difficulty: data.difficulty || 3,
        // Atomically replace all options if provided
        options: data.options ? {
          deleteMany: {},
          create: data.options
        } : undefined,
        // Atomically replace all test cases if provided
        testCases: data.testCases ? {
          deleteMany: {},
          create: data.testCases
        } : undefined,
        questionLanguages: (data.language && data.starter_code) ? {
          deleteMany: {},
          create: [{
            language: { connectOrCreate: { where: { name: data.language }, create: { name: data.language } } },
            starterCode: data.starter_code
          }]
        } : undefined,
      },
      include: {
        options: true,
        testCases: true,
        _count: { select: { assessments: true } },
      }
    });
  }
}

export const questionRepository = new QuestionRepository();
