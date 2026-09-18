-- CreateEnum
CREATE TYPE "InviteStatus" AS ENUM ('SENT', 'OPENED', 'STARTED', 'COMPLETED', 'EXPIRED');

-- CreateTable
CREATE TABLE "assessment_invitations" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "token" TEXT NOT NULL,
    "status" "InviteStatus" NOT NULL DEFAULT 'SENT',
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "assessment_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assessment_invitations_token_key" ON "assessment_invitations"("token");

-- CreateIndex
CREATE INDEX "assessment_invitations_assessmentId_idx" ON "assessment_invitations"("assessmentId");

-- CreateIndex
CREATE INDEX "assessment_invitations_email_idx" ON "assessment_invitations"("email");

-- AddForeignKey
ALTER TABLE "assessment_invitations" ADD CONSTRAINT "assessment_invitations_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
