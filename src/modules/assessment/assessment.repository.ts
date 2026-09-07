import { prisma } from '../../lib/prisma.js';

export type CreateAssessmentQuestionData = {
  questionId: string;
  orderIdx: number;
  points: number;
};

export type AssessmentSecuritySettingData = {
  fullscreenRequired?: boolean;
  tabSwitchDetection?: boolean;
  windowFocusDetection?: boolean;
  copyPasteBlocking?: boolean;
  largePasteDetection?: boolean;
  unusualActivityAlerts?: boolean;
};

export type CreateAssessmentData = {
  companyId: string;
  title: string;
  description?: string;
  durationMinutes?: number;
  passingPercentage?: number;
  isPublished?: boolean;
  questions?: CreateAssessmentQuestionData[];
  securitySetting?: AssessmentSecuritySettingData;
};

export class AssessmentRepository {
  async create(data: CreateAssessmentData) {
    return await prisma.assessment.create({
      data: {
        companyId: data.companyId,
        title: data.title,
        description: data.description,
        durationMinutes: data.durationMinutes,
        passingPercentage: data.passingPercentage,
        isPublished: data.isPublished || false,
        questions: data.questions ? {
          create: data.questions.map(q => ({
            questionId: q.questionId,
            orderIdx: q.orderIdx,
            points: q.points
          }))
        } : undefined,
      },
      include: {
        securitySetting: true,
        questions: {
          include: {
            question: true
          },
          orderBy: {
            orderIdx: 'asc'
          }
        }
      }
    });
  }
  async findAllByCompany(
    companyId: string, 
    page: number = 1, 
    limit: number = 10,
    search?: string,
    sortBy?: string,
    sortDir?: string
  ) {
    const skip = (page - 1) * limit;

    const where: any = { companyId, deletedAt: null };
    
    if (search?.trim()) {
      const term = search.trim();
      where.OR = [
        { title: { contains: term, mode: 'insensitive' } },
        { description: { contains: term, mode: 'insensitive' } }
      ];
    }

    let orderBy: any = { createdAt: 'desc' };
    
    if (sortBy) {
      const dir = sortDir === 'asc' ? 'asc' : 'desc';
      // Map sort fields matching frontend properties
      if (sortBy === 'title') {
        orderBy = { title: dir };
      } else if (sortBy === 'updated_at') {
        orderBy = { updatedAt: dir };
      } else if (sortBy === 'created_at') {
        orderBy = { createdAt: dir };
      }
    }

    const [data, total] = await Promise.all([
      prisma.assessment.findMany({
        where,
        include: {
          _count: {
            select: { questions: true, sessions: true }
          }
        },
        orderBy,
        skip,
        take: limit,
      }),
      prisma.assessment.count({
        where
      })
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    };
  }



  async findById(id: string, companyId: string) {
    return await prisma.assessment.findFirst({
      where: {
        id,
        companyId,
        deletedAt: null
      },
      include: {
        securitySetting: true,
        questions: {
          include: {
            question: {
              include: {
                options: true,
                testCases: true
              }
            }
          },
          orderBy: {
            orderIdx: 'asc'
          }
        }
      }
    });
  }

  async update(id: string, data: Partial<CreateAssessmentData>) {
    return await prisma.assessment.update({
      where: { id },
      data: {
        title: data.title,
        description: data.description,
        durationMinutes: data.durationMinutes,
        passingPercentage: data.passingPercentage,
        isPublished: data.isPublished,
        // Atomically replace all questions if provided
        questions: data.questions ? {
          deleteMany: {},
          create: data.questions.map(q => ({
            questionId: q.questionId,
            orderIdx: q.orderIdx,
            points: q.points
          }))
        } : undefined,
        securitySetting: (data as any).securitySetting ? {
          upsert: {
            create: (data as any).securitySetting,
            update: (data as any).securitySetting
          }
        } : undefined,
      },
      include: {
        securitySetting: true,
        questions: {
          include: {
            question: true
          },
          orderBy: {
            orderIdx: 'asc'
          }
        }
      }
    });
  }

  async delete(id: string, companyId: string) {
    // Soft Delete
    return await prisma.assessment.update({
      where: { id },
      data: {
        deletedAt: new Date()
      }
    });
  }

  // --- Link Management ---

  async createLink(assessmentId: string, token: string) {
    return await prisma.assessmentLink.create({
      data: {
        assessmentId,
        token
      }
    });
  }

  async findLinksByAssessment(assessmentId: string) {
    return await prisma.assessmentLink.findMany({
      where: { assessmentId },
      orderBy: { createdAt: 'desc' }
    });
  }

  async updateLinkStatus(linkId: string, isActive: boolean) {
    return await prisma.assessmentLink.update({
      where: { id: linkId },
      data: { isActive }
    });
  }

  // --- Results Management ---

  async getResultsByAssessment(assessmentId: string) {
    return await prisma.result.findMany({
      where: {
        session: {
          assessmentId
        }
      },
      include: {
        session: {
          include: {
            candidate: true
          }
        }
      },
      orderBy: {
        percentage: 'desc'
      }
    });
  }

  async findLinkById(linkId: string) {
    return await prisma.assessmentLink.findUnique({
      where: { id: linkId }
    });
  }
}

export const assessmentRepository = new AssessmentRepository();
