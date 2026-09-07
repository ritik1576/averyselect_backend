import { sessionRepository, type SessionFilters } from './session.repository.js';
import { AppError } from '../../utils/AppError.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Compute the effective display status, applying on-the-fly EXPIRED logic. */
function computeStatus(session: any): string {
  const rawStatus = (session.status as string).toUpperCase();
  if (rawStatus === 'STARTED' || rawStatus === 'IN_PROGRESS') {
    const durationMinutes = session.assessment?.durationMinutes;
    if (durationMinutes && session.startedAt) {
      const expiresAt = new Date(session.startedAt).getTime() + durationMinutes * 60_000;
      if (Date.now() > expiresAt) return 'EXPIRED';
    }
  }
  return rawStatus;
}

/** Compute true maxScore from assessment question points. */
function computeMaxScore(session: any): number {
  const questions = session.assessment?.questions ?? [];
  const trueMax = questions.reduce(
    (acc: number, q: any) => acc + (q.question?.points ?? q.points ?? 0), 0
  );
  return trueMax > 0 ? trueMax : (session.result?.maxScore ?? 0);
}

/** Map a raw Prisma session row to the flat DTO sent to the frontend. */
function mapSession(session: any, overrideStatus?: string) {
  const status = overrideStatus ?? computeStatus(session);
  const maxScore = computeMaxScore(session);
  const totalScore = session.result?.totalScore ?? 0;
  const percentage = maxScore > 0 ? (totalScore / maxScore) * 100 : 0;

  // Cap completedAt at startedAt + durationMinutes so time-taken is never > test duration
  let completedAt = session.completedAt;
  const durationMinutes = session.assessment?.durationMinutes;
  if (completedAt && session.startedAt && durationMinutes) {
    const maxCompletedAt = new Date(session.startedAt).getTime() + durationMinutes * 60_000;
    if (new Date(completedAt).getTime() > maxCompletedAt) {
      completedAt = new Date(maxCompletedAt).toISOString();
    }
  }

  return {
    sessionId: session.id,
    assessmentId: session.assessment.id,
    assessmentTitle: session.assessment.title,
    assessmentCreatedAt: session.assessment.createdAt,
    startedAt: session.startedAt,
    completedAt,
    candidateId: session.candidate.id,
    candidateName: session.candidate.name,
    candidateEmail: session.candidate.email,
    totalScore,
    maxScore,
    percentage,
    status,
    isPassed: session.result?.isPassed,
    passingPercentage: session.assessment?.passingPercentage ?? 60
  };
}

// ── Service ──────────────────────────────────────────────────────────────────

export interface GetAllSessionsParams extends SessionFilters {
  page?: number;
  limit?: number;
  assessmentId?: string;
  reviewStatus?: string;
}

export class SessionService {
  async getAllSessions(companyId: string, params: GetAllSessionsParams = {}) {
    const { page = 1, limit = 10, ...filters } = params;
    const requestedStatus = filters.status?.toUpperCase();

    // ── EXPIRED is a computed status — handle separately ─────────────────────
    if (requestedStatus === 'EXPIRED') {
      // Fetch all STARTED/IN_PROGRESS sessions matching other filters (no DB pagination yet)
      const rawSessions = await sessionRepository.findInProgressSessions(companyId, {
        search: filters.search,
        assessmentId: filters.assessmentId,
        reviewStatus: filters.reviewStatus,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        // Note: sortBy/sortDir applied after filtering below
      });

      // Filter to only those whose duration has elapsed
      const expiredSessions = rawSessions.filter(s => {
        const dur = s.assessment?.durationMinutes;
        if (!dur || !s.startedAt) return false;
        const expiresAt = new Date(s.startedAt).getTime() + dur * 60_000;
        return Date.now() > expiresAt;
      });

      // Apply sort in-memory (score sort uses totalScore)
      const dir = filters.sortDir === 'asc' ? 1 : -1;
      expiredSessions.sort((a, b) => {
        if (filters.sortBy === 'candidateName')    return dir * a.candidate.name.localeCompare(b.candidate.name);
        if (filters.sortBy === 'assessmentTitle')  return dir * a.assessment.title.localeCompare(b.assessment.title);
        if (filters.sortBy === 'score') {
          return dir * ((a.result?.totalScore ?? 0) - (b.result?.totalScore ?? 0));
        }
        // Default: startedAt desc
        return dir * (new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
      });

      // Manual pagination
      const total = expiredSessions.length;
      const start = (page - 1) * limit;
      const paged = expiredSessions.slice(start, start + limit);

      return {
        data: paged.map(s => mapSession(s, 'EXPIRED')),
        meta: { total, page, limit, totalPages: Math.ceil(total / limit) }
      };
    }

    // ── Normal path: DB-level filter/sort/paginate ────────────────────────────
    const dbFilters: SessionFilters = {
      search: filters.search,
      status: requestedStatus,
      assessmentId: filters.assessmentId,
      reviewStatus: filters.reviewStatus,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      sortBy: filters.sortBy,
      sortDir: filters.sortDir
    };

    const raw = await sessionRepository.findAllSessions(companyId, page, limit, dbFilters);

    return {
      data: raw.data.map(s => mapSession(s)),
      meta: raw.meta
    };
  }

  async getSessionReport(sessionId: string, companyId: string) {
    const session = await sessionRepository.findSessionReport(sessionId, companyId);

    if (!session) throw new AppError('Session not found', 404);
    if (session.assessment.companyId !== companyId) throw new AppError('Access denied', 403);

    return session;
  }  async updateQuestionScore(sessionId: string, companyId: string, questionId: string, score: number) {
    const session = await sessionRepository.findSessionReport(sessionId, companyId);
    if (!session || session.assessment.companyId !== companyId) {
      throw new AppError('Session not found or access denied', 404);
    }
    
    // Validate session status
    if (session.status !== 'COMPLETED') {
      throw new AppError('Cannot update scores for unsubmitted sessions', 400);
    }
    
    // Validate score against max points
    const question = session.assessment.questions.find(q => q.questionId === questionId);
    if (!question) {
      throw new AppError('Question not found in this assessment', 404);
    }
    if (score > question.points) {
      throw new AppError(`Score cannot exceed the maximum points (${question.points})`, 400);
    }
    
    return sessionRepository.updateQuestionScore(sessionId, questionId, score);
  }
  async updateReviewStatus(sessionId: string, companyId: string, isPassed: boolean | null) {
    // Basic authorization check - ensure session belongs to company
    const session = await sessionRepository.findSessionReport(sessionId, companyId);
    if (!session || session.assessment.companyId !== companyId) {
      throw new AppError('Session not found', 404);
    }
    
    return sessionRepository.updateResultReviewStatus(sessionId, isPassed);
  }
}


export const sessionService = new SessionService();
