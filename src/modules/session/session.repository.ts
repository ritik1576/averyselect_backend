import { prisma } from '../../lib/prisma.js';

// ─── Filter types ────────────────────────────────────────────────────────────
export interface SessionFilters {
  assessmentId?: string;
  reviewStatus?: string;
  search?: string;
  /** DB-level statuses: STARTED | IN_PROGRESS | COMPLETED | TERMINATED
   *  Note: EXPIRED is computed in the service layer and is NOT passed here. */
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  sortBy?: 'startedAt' | 'candidateName' | 'assessmentTitle' | 'score';
  sortDir?: 'asc' | 'desc';
}

// ─── Shared include block (keeps both queries in sync) ───────────────────────
const SESSION_INCLUDE = {
  candidate: {
    select: { id: true, name: true, email: true }
  },
  assessment: {
    select: {
      id: true,
      title: true,
      createdAt: true,
      durationMinutes: true,
      questions: {
        include: {
          question: { select: { points: true } }
        }
      }
    }
  },
  result: {
    select: { totalScore: true, maxScore: true, percentage: true, isPassed: true }
  }
} as const;

export class SessionRepository {
  // ── List sessions with server-side filter / sort / paginate ─────────────────
  async findAllSessions(
    companyId: string,
    page: number,
    limit: number,
    filters: SessionFilters = {}
  ) {
    const skip = (page - 1) * limit;
    const dir = filters.sortDir ?? 'desc';

    // ── Build WHERE ────────────────────────────────────────────────
    const where: any = {
      assessment: { companyId }
    };

    if (filters.assessmentId) {
      where.assessmentId = filters.assessmentId;
    }
    if (filters.reviewStatus) {
      if (filters.reviewStatus === 'passed') where.result = { isPassed: true };
      else if (filters.reviewStatus === 'rejected') where.result = { isPassed: false };
      else if (filters.reviewStatus === 'to_review') {
        // Candidates with no result row at all, OR result.isPassed = null
        where.AND = [
          ...(where.AND || []),
          { OR: [{ result: null }, { result: { isPassed: null } }] }
        ];
      }
    }

    // Full-text search across candidate name / email / assessment title
    if (filters.search?.trim()) {
      const term = filters.search.trim();
      where.AND = [
        ...(where.AND || []),
        {
          OR: [
            { candidate: { name:  { contains: term, mode: 'insensitive' } } },
            { candidate: { email: { contains: term, mode: 'insensitive' } } },
            { assessment: { title: { contains: term, mode: 'insensitive' } } }
          ]
        }
      ];
    }

    // Status filter (EXPIRED is computed; handled in service, not here)
    if (filters.status) {
      where.status = filters.status.toUpperCase();
    }
    if (filters.dateFrom || filters.dateTo) {
      where.startedAt = {};
      if (filters.dateFrom) where.startedAt.gte = new Date(filters.dateFrom);
      if (filters.dateTo) {
        const toDate = new Date(filters.dateTo);
        toDate.setHours(23, 59, 59, 999);
        where.startedAt.lte = toDate;
      }
    }

    // ── Build ORDER BY ─────────────────────────────────────────────
    let orderBy: any = { startedAt: 'desc' }; // default

    if (filters.sortBy === 'candidateName') {
      orderBy = { candidate: { name: dir } };
    } else if (filters.sortBy === 'assessmentTitle') {
      orderBy = { assessment: { title: dir } };
    } else if (filters.sortBy === 'startedAt') {
      orderBy = { startedAt: dir };
    } else if (filters.sortBy === 'score') {
      // Sort by stored totalScore in Result table
      orderBy = { result: { totalScore: dir } };
    }

    // ── Base WHERE for tab badge counts (no reviewStatus, but keeps search/date/assessmentId) ──
    const baseWhere: any = { assessment: { companyId } };
    if (filters.assessmentId) baseWhere.assessmentId = filters.assessmentId;
    if (filters.status) baseWhere.status = filters.status.toUpperCase();
    if (filters.search?.trim()) {
      const term = filters.search.trim();
      baseWhere.AND = [{
        OR: [
          { candidate: { name:  { contains: term, mode: 'insensitive' } } },
          { candidate: { email: { contains: term, mode: 'insensitive' } } },
          { assessment: { title: { contains: term, mode: 'insensitive' } } }
        ]
      }];
    }
    if (filters.dateFrom || filters.dateTo) {
      baseWhere.startedAt = {};
      if (filters.dateFrom) baseWhere.startedAt.gte = new Date(filters.dateFrom);
      if (filters.dateTo) {
        const toDate = new Date(filters.dateTo);
        toDate.setHours(23, 59, 59, 999);
        baseWhere.startedAt.lte = toDate;
      }
    }

    // ── Run queries in parallel ─────────────────────────────────────────────────
    // filteredTotal: actual count for THIS tab (used for pagination totalPages)
    // Tab badge counts: always computed from baseWhere (no reviewStatus) so all tabs stay accurate
    const [sessions, filteredTotal, allTotal, passed, rejected, toReview] = await Promise.all([
      prisma.session.findMany({
        where,
        include: SESSION_INCLUDE,
        orderBy,
        skip,
        take: limit
      }),
      prisma.session.count({ where }),
      prisma.session.count({ where: baseWhere }),
      prisma.session.count({ where: { ...baseWhere, result: { isPassed: true } } }),
      prisma.session.count({ where: { ...baseWhere, result: { isPassed: false } } }),
      prisma.session.count({ where: { ...baseWhere, OR: [ { result: null }, { result: { isPassed: null } } ] } }),
    ]);

    return {
      data: sessions,
      meta: { 
        total: filteredTotal,
        page,
        limit,
        totalPages: Math.ceil(filteredTotal / limit),
        counts: {
          all:       allTotal,
          passed:    passed,
          rejected:  rejected,
          to_review: toReview
        }
      }
    };
  }

  // ── Fetch STARTED/IN_PROGRESS sessions for EXPIRED computation ──────────────
  // Used by service layer when status=expired filter is requested.
  async findInProgressSessions(companyId: string, filters: Omit<SessionFilters, 'status'> = {}) {
    const where: any = {
      assessment: { companyId },
      status: { in: ['STARTED', 'IN_PROGRESS'] }
    };

    if (filters.assessmentId) {
      where.assessmentId = filters.assessmentId;
    }
    if (filters.reviewStatus) {
      if (filters.reviewStatus === 'passed') where.result = { isPassed: true };
      else if (filters.reviewStatus === 'rejected') where.result = { isPassed: false };
      else if (filters.reviewStatus === 'to_review') {
        where.AND = [
          ...(where.AND || []),
          { OR: [{ result: null }, { result: { isPassed: null } }] }
        ];
      }
    }

    if (filters.search?.trim()) {
      const term = filters.search.trim();
      where.AND = [
        ...(where.AND || []),
        {
          OR: [
            { candidate: { name:  { contains: term, mode: 'insensitive' } } },
            { candidate: { email: { contains: term, mode: 'insensitive' } } },
            { assessment: { title: { contains: term, mode: 'insensitive' } } }
          ]
        }
      ];
    }
    if (filters.dateFrom || filters.dateTo) {
      where.startedAt = {};
      if (filters.dateFrom) where.startedAt.gte = new Date(filters.dateFrom);
      if (filters.dateTo) {
        const toDate = new Date(filters.dateTo);
        toDate.setHours(23, 59, 59, 999);
        where.startedAt.lte = toDate;
      }
    }

    return prisma.session.findMany({
      where,
      include: SESSION_INCLUDE,
      orderBy: { startedAt: 'desc' }
    });
  }

  // ── Single session full report ───────────────────────────────────────────────
  async findSessionReport(sessionId: string, companyId: string) {
    return await prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        assessment: {
          select: {
            id: true,
            title: true,
            companyId: true,
            questions: {
              include: {
                question: {
                  select: {
                    id: true, title: true, text: true,
                    type: true, points: true,
                    options: { select: { id: true, text: true, isCorrect: true } }
                  }
                }
              },
              orderBy: { orderIdx: 'asc' }
            }
          }
        },
        candidate: { select: { id: true, name: true, email: true } },
        result: {
          include: { questionResults: true, domainResults: true }
        },
        activityEvents: { orderBy: { createdAt: 'asc' } },
        attempts: {
          include: {
            question: {
              select: {
                id: true, title: true, text: true, type: true, points: true,
                options: { select: { id: true, text: true, isCorrect: true } }
              }
            },
            executions: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              include: { language: true }
            }
          }
        }
      }
    });
  }

  // ── Manual score override ────────────────────────────────────────────────────
  async updateQuestionScore(sessionId: string, questionId: string, score: number) {
    const result = await prisma.result.findUnique({
      where: { sessionId },
      include: {
        questionResults: true,
        session: {
          include: {
            assessment: {
              include: {
                questions: { select: { questionId: true, points: true } }
              }
            }
          }
        }
      }
    });

    if (!result) throw new Error('Result not found for this session');

    const questionResult = result.questionResults.find(qr => qr.questionId === questionId);
    if (!questionResult) throw new Error('Question result not found');

    // Use Question.points as authoritative maxScore (auto-grader hardcoded 10 in QuestionResult.maxScore)
    const trueQuestionMaxScore = await prisma.question.findUnique({
      where: { id: questionId },
      select: { points: true }
    });
    const effectiveMaxScore = trueQuestionMaxScore?.points ?? questionResult.maxScore;
    const isCorrect = score > 0 && score >= effectiveMaxScore;

    await prisma.questionResult.update({
      where: { id: questionResult.id },
      data: { score, isCorrect }
    });

    // Recalculate total from all updated question results
    const allResults = await prisma.questionResult.findMany({
      where: { resultId: result.id }
    });
    const totalScore = allResults.reduce((acc, curr) => acc + curr.score, 0);

    // maxScore = sum of Question.points across the assessment (authoritative)
    const aqWithPoints = await prisma.assessmentQuestion.findMany({
      where: { assessmentId: result.session.assessmentId },
      include: { question: { select: { points: true } } }
    });
    const trueMaxScore = aqWithPoints.reduce(
      (acc: number, aq: any) => acc + (aq.question?.points ?? aq.points ?? 0), 0
    );
    const maxScore = trueMaxScore > 0 ? trueMaxScore : result.maxScore;
    const percentage = maxScore > 0 ? (totalScore / maxScore) * 100 : 0;
    const passingPercentage = result.session.assessment.passingPercentage ?? 60;

    return prisma.result.update({
      where: { id: result.id },
      data: { totalScore, maxScore, percentage, isPassed: percentage >= passingPercentage }
    });
  }

  async updateResultReviewStatus(sessionId: string, isPassed: boolean | null) {
    return prisma.result.upsert({
      where: { sessionId },
      update: { isPassed },
      create: {
        sessionId,
        isPassed,
        totalScore: 0,
        maxScore: 0,
        percentage: 0
      }
    });
  }
}

export const sessionRepository = new SessionRepository();
