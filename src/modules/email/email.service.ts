import * as nodemailer from 'nodemailer';
export interface SendInvitationParams {
  toEmail: string;
  candidateName?: string | null;
  assessmentTitle: string;
  companyName: string;
  durationMinutes?: number | null;
  invitationUrl: string;
  expiresAt?: Date | null;
}

export class EmailService {
  private resendApiKey?: string;
  private emailFrom: string;
  private smtpHost?: string;
  private smtpPort?: number;
  private smtpUser?: string;
  private smtpPass?: string;

  constructor() {
    this.resendApiKey = process.env.RESEND_API_KEY;
    this.emailFrom = process.env.EMAIL_FROM || 'AverySelect <invitations@averyselect.com>';
    this.smtpHost = process.env.SMTP_HOST;
    this.smtpPort = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT) : undefined;
    this.smtpUser = process.env.SMTP_USER;
    this.smtpPass = process.env.SMTP_PASS;
  }

  /**
   * Generates a modern, responsive HTML email template for candidate invitations.
   */
  generateInvitationHtml(params: SendInvitationParams): string {
    const candidateGreeting = params.candidateName ? `Hello ${params.candidateName},` : 'Hello,';
    const durationText = params.durationMinutes ? `${params.durationMinutes} Minutes` : 'Untimed';
    const expiresText = params.expiresAt 
      ? `<p style="margin-top: 16px; font-size: 13px; color: #6b7280;">This invitation link will expire on <strong>${params.expiresAt.toLocaleDateString()}</strong>.</p>` 
      : '';

    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invitation to Technical Assessment</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 580px; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); overflow: hidden; border: 1px solid #e2e8f0;">
          <!-- Header Banner -->
          <tr>
            <td style="padding: 32px 40px 24px; background: #ffffff; border-bottom: 1px solid #f1f5f9;">
              <span style="display: inline-block; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #ef4623; background: #fff5f2; padding: 4px 12px; border-radius: 9999px; margin-bottom: 12px;">
                ${params.companyName}
              </span>
              <h1 style="margin: 0; font-size: 22px; font-weight: 700; color: #0f172a; line-height: 1.3;">
                Technical Assessment Invitation
              </h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 32px 40px;">
              <p style="font-size: 15px; color: #334155; line-height: 1.6; margin-top: 0;">
                ${candidateGreeting}
              </p>
              <p style="font-size: 15px; color: #334155; line-height: 1.6;">
                You have been invited by <strong>${params.companyName}</strong> to complete the following assessment on AverySelect:
              </p>

              <!-- Assessment Details Card -->
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 24px 0; background-color: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0;">
                <tr>
                  <td style="padding: 20px;">
                    <div style="font-size: 17px; font-weight: 600; color: #0f172a; margin-bottom: 8px;">
                      ${params.assessmentTitle}
                    </div>
                    <div style="font-size: 14px; color: #64748b;">
                      ⏱ Duration: <strong style="color: #334155;">${durationText}</strong> &nbsp;•&nbsp; 🔒 Proctoring: <strong style="color: #334155;">Standard</strong>
                    </div>
                  </td>
                </tr>
              </table>

              <p style="font-size: 14px; color: #475569; line-height: 1.5;">
                When you are ready in a quiet environment with a stable internet connection, click the button below to review instructions and start your session:
              </p>

              <!-- CTA Button -->
              <table border="0" cellspacing="0" cellpadding="0" style="margin: 28px 0 16px;">
                <tr>
                  <td align="center" style="border-radius: 8px; background-color: #ef4623;">
                    <a href="${params.invitationUrl}" target="_blank" style="font-size: 15px; font-weight: 600; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 8px; display: inline-block;">
                      Start Assessment &rarr;
                    </a>
                  </td>
                </tr>
              </table>

              <p style="font-size: 12px; color: #94a3b8; word-break: break-all; margin-top: 20px;">
                If the button above does not work, copy and paste this link into your browser:<br>
                <a href="${params.invitationUrl}" style="color: #ef4623; text-decoration: underline;">${params.invitationUrl}</a>
              </p>

              ${expiresText}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 20px 40px; background-color: #f8fafc; border-top: 1px solid #e2e8f0; font-size: 12px; color: #94a3b8; text-align: center;">
              Sent via <strong>AverySelect</strong> • Technical Screening & Assessment Platform
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;
  }

  /**
   * Sends or logs the candidate invitation email.
   */
  async sendInvitation(params: SendInvitationParams): Promise<{ success: boolean; provider: string; messageId?: string }> {
    const html = this.generateInvitationHtml(params);
    const subject = `Invitation to complete ${params.assessmentTitle} with ${params.companyName}`;

    // 1. Resend REST API (Zero heavy dependencies, works via native fetch)
    if (this.resendApiKey) {
      try {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.resendApiKey}`,
          },
          body: JSON.stringify({
            from: this.emailFrom,
            to: [params.toEmail],
            subject,
            html,
          }),
        });

        if (response.ok) {
          const data = (await response.json()) as any;
          return { success: true, provider: 'resend', messageId: data.id };
        } else {
          const errText = await response.text();
          console.error('[EmailService] Resend dispatch failed:', errText);
        }
      } catch (err) {
        console.error('[EmailService] Error dispatching to Resend:', err);
      }
    }

    // 2. SMTP Fallback
    if (this.smtpHost && this.smtpUser && this.smtpPass) {
      try {
        const transporter = nodemailer.createTransport({
          host: this.smtpHost,
          port: this.smtpPort || 465,
          secure: (this.smtpPort === 465), 
          auth: {
            user: this.smtpUser,
            pass: this.smtpPass,
          },
        });

        const info = await transporter.sendMail({
          from: this.emailFrom,
          to: params.toEmail,
          subject: subject,
          html: html,
        });

        console.log(`📧 [SMTP EMAIL LOGGER] CANDIDATE INVITATION EMAIL DISPATCHED via SMTP to ${params.toEmail}`);
        return { success: true, provider: 'smtp', messageId: info.messageId };
      } catch (err) {
        console.error('[EmailService] Error dispatching via SMTP fallback:', err);
      }
    }

    // 3. Dev Logger Fallback (Always displays formatted box in terminal during dev/testing)
    console.log('\n' + '='.repeat(70));
    console.log('📧 [DEV EMAIL LOGGER] CANDIDATE INVITATION EMAIL DISPATCHED');
    console.log('='.repeat(70));
    console.log(`To:          ${params.candidateName ? `"${params.candidateName}" ` : ''}<${params.toEmail}>`);
    console.log(`From:        ${this.emailFrom}`);
    console.log(`Subject:     ${subject}`);
    console.log(`Assessment:  ${params.assessmentTitle} (${params.companyName})`);
    console.log(`Duration:    ${params.durationMinutes ? `${params.durationMinutes} mins` : 'Untimed'}`);
    console.log('-'.repeat(70));
    console.log(`🔗 INVITATION TEST URL:`);
    console.log(`   \x1b[36m${params.invitationUrl}\x1b[0m`);
    console.log('='.repeat(70) + '\n');

    return { success: true, provider: 'dev-logger' };
  }
}

export const emailService = new EmailService();
