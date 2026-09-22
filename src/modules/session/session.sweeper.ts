import { prisma } from '../../lib/prisma.js';
import { gradingService } from '../grading/grading.service.js';

export class SessionSweeper {
  private timer: NodeJS.Timeout | null = null;
  private isSweeping = false;

  async sweepExpiredSessions() {
    if (this.isSweeping) return;
    this.isSweeping = true;

    try {
      // Find all potentially active sessions
      const activeSessions = await prisma.session.findMany({
        where: {
          status: { in: ['STARTED', 'IN_PROGRESS'] },
        },
        include: {
          assessment: {
            select: { durationMinutes: true }
          }
        }
      });

      const now = Date.now();

      for (const session of activeSessions) {
        if (!session.startedAt || !session.assessment?.durationMinutes) continue;
        
        // Expiry time + 1 minute grace period for any frontend networking lag
        const expiresAt = new Date(session.startedAt).getTime() + (session.assessment.durationMinutes + 1) * 60_000;
        
        if (now > expiresAt) {
          try {
            // Atomic transition: only transition if it's exactly the active status we saw
            const result = await prisma.session.updateMany({
              where: {
                id: session.id,
                status: session.status // optimistic lock
              },
              data: {
                status: 'COMPLETED',
                completedAt: new Date()
              }
            });

            // If count === 1, we successfully transitioned it and we "own" the grading trigger
            if (result.count === 1) {
              console.log(`[Sweeper] Auto-completed expired session ${session.id}. Triggering grading.`);
              gradingService.gradeSession(session.id).catch(err => {
                console.error(`[Sweeper] Error triggering grading for session ${session.id}:`, err);
              });
            }
          } catch (error) {
            console.error(`[Sweeper] Error finalizing expired session ${session.id}:`, error);
          }
        }
      }
    } catch (error) {
      console.error('[Sweeper] Failed to fetch active sessions:', error);
    } finally {
      this.isSweeping = false;
    }
  }

  start(intervalMs = 60_000) {
    if (this.timer) {
      return; // prevent multiple intervals in the same process
    }
    
    this.timer = setInterval(() => {
      this.sweepExpiredSessions().catch(err => console.error('[Sweeper] execution failed:', err));
    }, intervalMs);
    
    console.log('[Sweeper] Initialized periodic session sweeping.');
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

export const sessionSweeper = new SessionSweeper();
