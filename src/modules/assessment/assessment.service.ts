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

    for (const cand of candidates) {
      const email = cand.email.trim().toLowerCase();
      const name = cand.name?.trim() || null;

      // 1. Check for duplicate invitation
      let invitation = await assessmentRepository.findInvitationByEmailAndAssessment(assessmentId, email);

      if (!invitation) {
        // Unique token for this invitation
        const inviteToken = crypto.randomBytes(16).toString("hex");

        invitation = await assessmentRepository.createInvitation({
          assessmentId,
          email,
          name,
          token: inviteToken,
        });
      } else {
        // Optional: Update name if provided
        // And we will re-use the existing token
        await assessmentRepository.updateInvitationSentAt(invitation.id);
      }

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
