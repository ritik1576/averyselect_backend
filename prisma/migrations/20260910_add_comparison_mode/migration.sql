-- CreateEnum
CREATE TYPE "ComparisonMode" AS ENUM ('EXACT', 'TRIMMED', 'TOKENIZED', 'JSON', 'FLOAT');

-- AlterTable
ALTER TABLE "questions" ADD COLUMN "comparisonMode" "ComparisonMode" NOT NULL DEFAULT 'TRIMMED';
