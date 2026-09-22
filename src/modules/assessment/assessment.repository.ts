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
    sortDir?: string,
    status?: 'ACTIVE' | 'ARCHIVED' | 'ALL'
  ) {
    const skip = (page - 1) * limit;

    const where: any = { companyId };
    
    if (status === 'ARCHIVED') {
      where.deletedAt = { not: null };
    } else if (status === 'ALL') {
      // Do not filter by deletedAt
    } else {
      // Default to ACTIVE
      where.deletedAt = null;
    }
    
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
            select: { questions: true, sessions: true, invitations: true }
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

    const mappedData = data.map(item => ({
      ...item,
      hasCandidateActivity: item._count.sessions > 0 || item._count.invitations > 0
    }));

    return {
      data: mappedData,
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
    // Soft Delete (Archive)
    return await prisma.assessment.update({
      where: { id },
      data: {
        deletedAt: new Date()
      }
    });
  }

  async hardDelete(id: string, companyId: string) {
    return await prisma.assessment.delete({
      where: { id, companyId }
    });
  }

  async countCandidateActivity(id: string): Promise<number> {
    const [sessionCount, inviteCount] = await Promise.all([
      prisma.session.count({ where: { assessmentId: id } }),
      prisma.assessmentInvitation.count({ where: { assessmentId: id } })
    ]);
    return sessionCount + inviteCount;
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

  // --- Invitation Management ---

  async createInvitation(data: { assessmentId: string; email: string; name?: string | null; token: string }) {
    return await prisma.assessmentInvitation.create({
      data: {
        assessmentId: data.assessmentId,
        email: data.email,
        name: data.name,
        token: data.token,
        status: "SENT",
      }
    });
  }

  async findInvitationsByAssessment(
    assessmentId: string, 
    options: { page?: number; limit?: number; search?: string } = {}
  ) {
    const page = options.page || 1;
    const limit = options.limit || 10;
    const skip = (page - 1) * limit;

    const where: any = { assessmentId };
    
    if (options.search) {
      where.OR = [
        { email: { contains: options.search, mode: 'insensitive' } },
        { name: { contains: options.search, mode: 'insensitive' } }
      ];
    }

    const [data, total] = await Promise.all([
      prisma.assessmentInvitation.findMany({
        where,
        orderBy: { sentAt: "desc" },
        skip,
        take: limit
      }),
      prisma.assessmentInvitation.count({ where })
    ]);

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async findInvitationByEmailAndAssessment(assessmentId: string, email: string) {
    return await prisma.assessmentInvitation.findFirst({
      where: { assessmentId, email },
      orderBy: { sentAt: "desc" }
    });
  }

  async findInvitationById(inviteId: string) {
    return await prisma.assessmentInvitation.findUnique({
      where: { id: inviteId }
    });
  }

  async updateInvitationSentAt(inviteId: string) {
    return await prisma.assessmentInvitation.update({
      where: { id: inviteId },
      data: { sentAt: new Date() }
    });
  }

  /** Count sessions that are currently active (STARTED or IN_PROGRESS) for an assessment. */
  async countActiveSessionsByAssessment(assessmentId: string): Promise<number> {
    return await prisma.session.count({
      where: {
        assessmentId,
        status: { in: ["STARTED", "IN_PROGRESS"] }
      }
    });
  }
}


export const assessmentRepository = new AssessmentRepository();
