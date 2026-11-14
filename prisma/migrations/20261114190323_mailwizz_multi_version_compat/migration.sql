-- AlterEnum
ALTER TYPE "EventSource" ADD VALUE 'API_ACTIVITY_LOG';

-- AlterTable
ALTER TABLE "AppConfig" ADD COLUMN     "mailwizzAuthMode" TEXT NOT NULL DEFAULT 'auto',
ADD COLUMN     "mailwizzDetectedVersion" TEXT;
