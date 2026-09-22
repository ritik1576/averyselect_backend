import { emailService } from "../email/email.service.js";
import { prisma } from "../../lib/prisma.js";
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
    sortDir?: string,
    status?: 'ACTIVE' | 'ARCHIVED' | 'ALL'
  ) {
    return await assessmentRepository.findAllByCompany(companyId, page, limit, search, sortBy, sortDir, status);
  }

  async getAssessmentById(id: string, companyId: string) {
    const assessment = await assessmentRepository.findById(id, companyId);
    
    if (!assessment) {
      throw new AppError('Assessment not found', 404);
    }

    // Attach live active session count so the frontend can warn the recruiter
    const activeSessionCount = await assessmentRepository.countActiveSessionsByAssessment(id);
    return { ...assessment, activeSessionCount };
  }

  async updateAssessment(id: string, companyId: string, data: Partial<CreateAssessmentData>) {
    // 1. Verify existence and ownership
    await this.getAssessmentById(id, companyId);

    // 2. Guard: block structural edits (questions / points / duration) when active sessions exist.
    //    Settings-only changes (toggle, security flags) are still allowed.
    const isStructuralEdit = data.questions !== undefined || data.durationMinutes !== undefined || data.passingPercentage !== undefined;
    if (isStructuralEdit) {
      const activeCount = await assessmentRepository.countActiveSessionsByAssessment(id);
      if (activeCount > 0) {
        throw new AppError(
          `Cannot edit this assessment while ${activeCount} candidate${activeCount > 1 ? "s are" : " is"} actively taking it. Wait for all active sessions to finish or expire.`,
          409
        );
      }
    }

    // 3. If updating questions, verify ownership
    if (data.questions && data.questions.length > 0) {
      const questionIds = data.questions.map(q => q.questionId);
      const validCount = await questionRepository.countByIds(questionIds, companyId);
      
      if (validCount !== questionIds.length) {
        throw new AppError(`One or more questions are invalid, deleted, or do not belong to your company.`, 404);
      }
    }

    // 4. Perform update
    return await assessmentRepository.update(id, data);
  }

  async deleteAssessment(id: string, companyId: string) {
    // 1. Verify existence and ownership
    const assessment = await this.getAssessmentById(id, companyId);

    // 2. Check Candidate Activity
    const activityCount = await assessmentRepository.countCandidateActivity(id);

    // 3. Delete Rules: ONLY Draft with ZERO candidate activity
    if (!assessment.isPublished && activityCount === 0) {
      return await assessmentRepository.hardDelete(id, companyId);
    } else {
      throw new AppError("Hard delete is only allowed for Draft assessments with no candidate activity.", 409);
    }
  }

  async archiveAssessment(id: string, companyId: string) {
    // 1. Verify existence and ownership
    const assessment = await this.getAssessmentById(id, companyId);

    // 2. Perform soft delete
    return await assessmentRepository.delete(id, companyId);
  }

  async duplicateAssessment(id: string, companyId: string) {
    // 1. Verify existence and ownership (using internal prisma call to get full tree safely)
    const existing = await prisma.assessment.findFirst({
      where: { id, companyId, deletedAt: null },
      include: {
        securitySetting: true,
        questions: true
      }
    });

    if (!existing) {
      throw new AppError('Assessment not found', 404);
    }

    // 2. Create the duplicate in a transaction
    return await prisma.$transaction(async (tx) => {
      let baseTitle = existing.title;
      // if it ends with (Copy), maybe don't add another, or just let it stack. Stacking is fine.
      const newTitle = `${baseTitle} (Copy)`;

      const newAssessment = await tx.assessment.create({
        data: {
          companyId,
          title: newTitle,
          description: existing.description,
          durationMinutes: existing.durationMinutes,
          passingPercentage: existing.passingPercentage,
          isPublished: false, // Must be draft
          securitySetting: existing.securitySetting ? {
            create: {
              fullscreenRequired: existing.securitySetting.fullscreenRequired,
              tabSwitchDetection: existing.securitySetting.tabSwitchDetection,
              windowFocusDetection: existing.securitySetting.windowFocusDetection,
              copyPasteBlocking: existing.securitySetting.copyPasteBlocking,
              largePasteDetection: existing.securitySetting.largePasteDetection,
              unusualActivityAlerts: existing.securitySetting.unusualActivityAlerts,
            }
          } : undefined,
          questions: {
            create: existing.questions.map(q => ({
              questionId: q.questionId,
              orderIdx: q.orderIdx,
              points: q.points
            }))
          }
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

      return newAssessment;
    });
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

  // --- Invitation Management ---

  async inviteCandidates(
    assessmentId: string,
    companyId: string,
    candidates: { name?: string; email: string }[]
  ) {
    const assessment = await this.getAssessmentById(assessmentId, companyId);
    if (!assessment.questions || assessment.questions.length === 0) {
      throw new AppError("Cannot invite candidates to an assessment with no questions.", 400);
    }
    const company = await prisma.company.findUnique({ where: { id: companyId } });
    const companyName = company?.name || "AverySelect Assessments";

    // Ensure active link exists
    let activeLink = await prisma.assessmentLink.findFirst({
      where: { assessmentId, isActive: true },
      orderBy: { createdAt: "desc" },
    });

    if (!activeLink) {
      const linkToken = crypto.randomBytes(8).toString("hex");
      activeLink = await assessmentRepository.createLink(assessmentId, linkToken);
    }

    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    const results = [];

    const emailPromises = [];

    // Pre-check for duplicate invitations to ensure atomicity
    for (const cand of candidates) {
      const email = cand.email.trim().toLowerCase();
      const existingInvite = await assessmentRepository.findInvitationByEmailAndAssessment(assessmentId, email);
      if (existingInvite) {
        throw new AppError(`Candidate ${email} has already been invited to this assessment.`, 400);
      }
    }

    for (const cand of candidates) {
      const email = cand.email.trim().toLowerCase();
      const name = cand.name?.trim() || null;

      // Unique token for this invitation
      const inviteToken = crypto.randomBytes(16).toString("hex");

      const invitation = await assessmentRepository.createInvitation({
        assessmentId,
        email,
        name,
        token: inviteToken,
      });

      const invitationUrl = `${frontendUrl}/take/${invitation.token}?email=${encodeURIComponent(email)}${name ? `&name=${encodeURIComponent(name)}` : ""}`;

      // Queue email dispatch as a Promise
      const emailPromise = emailService.sendInvitation({
        toEmail: email,
        candidateName: name,
        assessmentTitle: assessment.title,
        companyName,
        durationMinutes: assessment.durationMinutes,
        invitationUrl,
      });
      emailPromises.push(emailPromise);

      results.push(invitation);
    }

    // Fire and forget emails (or wait without failing the main request if we wanted to log)
    // We use Promise.allSettled so if one email fails, it doesn't crash the others
    Promise.allSettled(emailPromises).then((settled) => {
      const failed = settled.filter(r => r.status === 'rejected');
      if (failed.length > 0) {
        console.error(`[Email Dispatch] ${failed.length} invitations failed to send.`);
      }
    });

    return results;
  }

  async getInvitations(assessmentId: string, companyId: string, options: { page?: number; limit?: number; search?: string } = {}) {
    await this.getAssessmentById(assessmentId, companyId);
    return await assessmentRepository.findInvitationsByAssessment(assessmentId, options);
  }

  async resendInvitation(assessmentId: string, inviteId: string, companyId: string) {
    const assessment = await this.getAssessmentById(assessmentId, companyId);
    const company = await prisma.company.findUnique({ where: { id: companyId } });
    const companyName = company?.name || "AverySelect Assessments";

    const invitation = await assessmentRepository.findInvitationById(inviteId);
    if (!invitation || invitation.assessmentId !== assessmentId) {
      throw new AppError("Invitation not found", 404);
    }

    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    const invitationUrl = `${frontendUrl}/take/${invitation.token}?email=${encodeURIComponent(invitation.email)}${invitation.name ? `&name=${encodeURIComponent(invitation.name)}` : ""}`;

    await emailService.sendInvitation({
      toEmail: invitation.email,
      candidateName: invitation.name,
      assessmentTitle: assessment.title,
      companyName,
      durationMinutes: assessment.durationMinutes,
      invitationUrl,
    });

    return await assessmentRepository.updateInvitationSentAt(inviteId);
  }
}


export const assessmentService = new AssessmentService();
