-- CreateEnum
CREATE TYPE "ExecutionMode" AS ENUM ('FULL_PROGRAM', 'FUNCTION');

-- AlterTable
ALTER TABLE "questions" ADD COLUMN     "executionMode" "ExecutionMode" NOT NULL DEFAULT 'FULL_PROGRAM',
ADD COLUMN     "functionContract" JSONB;

