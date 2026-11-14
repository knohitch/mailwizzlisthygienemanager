-- CreateEnum
CREATE TYPE "DnsCheckStatus" AS ENUM ('PASS', 'WARN', 'FAIL', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "MailboxProvider" AS ENUM ('GMAIL', 'OUTLOOK', 'YAHOO', 'OTHER');

-- CreateEnum
CREATE TYPE "PlacementLocation" AS ENUM ('PRIMARY', 'PROMOTIONS', 'OTHER', 'SPAM', 'MISSING');

-- CreateEnum
CREATE TYPE "DirectMailSource" AS ENUM ('ALIBABA_API', 'ALIBABA_CSV_IMPORT', 'SYNTHETIC_DEMO');

-- AlterTable
ALTER TABLE "AppConfig" ADD COLUMN     "alibabaAccessKeyIdEnc" TEXT,
ADD COLUMN     "alibabaAccessKeySecretEnc" TEXT,
ADD COLUMN     "alibabaAccountStatus" TEXT,
ADD COLUMN     "alibabaKeyLast4" TEXT,
ADD COLUMN     "alibabaLastSyncedAt" TIMESTAMP(3),
ADD COLUMN     "alibabaRegion" TEXT NOT NULL DEFAULT 'ap-southeast-1',
ADD COLUMN     "googlePostmasterDomain" TEXT,
ADD COLUMN     "googlePostmasterTokenEnc" TEXT;

-- CreateTable
CREATE TABLE "DomainAuthCheck" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "fromDomain" TEXT,
    "trackingDomain" TEXT,
    "dkimSelector" TEXT,
    "spfStatus" "DnsCheckStatus" NOT NULL DEFAULT 'UNKNOWN',
    "spfRecord" TEXT,
    "spfDetail" TEXT NOT NULL,
    "dkimStatus" "DnsCheckStatus" NOT NULL DEFAULT 'UNKNOWN',
    "dkimRecord" TEXT,
    "dkimDetail" TEXT NOT NULL,
    "dmarcStatus" "DnsCheckStatus" NOT NULL DEFAULT 'UNKNOWN',
    "dmarcPolicy" TEXT,
    "dmarcAlignmentOk" BOOLEAN,
    "dmarcRecord" TEXT,
    "dmarcDetail" TEXT NOT NULL,
    "mxStatus" "DnsCheckStatus" NOT NULL DEFAULT 'UNKNOWN',
    "mxRecordsJson" JSONB NOT NULL DEFAULT '[]',
    "trackingStatus" "DnsCheckStatus" NOT NULL DEFAULT 'UNKNOWN',
    "trackingDetail" TEXT NOT NULL,
    "recommendationsJson" JSONB NOT NULL DEFAULT '[]',
    "checkedByEmail" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DomainAuthCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DirectMailDailyMetric" (
    "id" TEXT NOT NULL,
    "metricDate" TIMESTAMP(3) NOT NULL,
    "domainName" TEXT NOT NULL DEFAULT 'all',
    "source" "DirectMailSource" NOT NULL,
    "requestsCount" INTEGER NOT NULL DEFAULT 0,
    "deliveredCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "invalidAddressCount" INTEGER NOT NULL DEFAULT 0,
    "complaintCount" INTEGER,
    "accountStatus" TEXT,
    "notes" TEXT,
    "rawPayloadJson" JSONB,
    "isDemoData" BOOLEAN NOT NULL DEFAULT false,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DirectMailDailyMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboxPlacementTest" (
    "id" TEXT NOT NULL,
    "testDomain" TEXT NOT NULL,
    "sendingProvider" TEXT NOT NULL DEFAULT 'Alibaba Cloud DirectMail (SMTP)',
    "campaignUid" TEXT,
    "recipientProvider" "MailboxProvider" NOT NULL,
    "customProviderName" TEXT,
    "testedAt" TIMESTAMP(3) NOT NULL,
    "placement" "PlacementLocation" NOT NULL,
    "spfPass" BOOLEAN,
    "dkimPass" BOOLEAN,
    "dmarcPass" BOOLEAN,
    "postmasterReputation" TEXT,
    "notes" TEXT,
    "recordedByEmail" TEXT NOT NULL,
    "isDemoData" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboxPlacementTest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostmasterStat" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "statDate" TIMESTAMP(3) NOT NULL,
    "domainReputation" TEXT,
    "userReportedSpamRatio" DOUBLE PRECISION,
    "dkimSuccessRatio" DOUBLE PRECISION,
    "dmarcSuccessRatio" DOUBLE PRECISION,
    "spfSuccessRatio" DOUBLE PRECISION,
    "inboundEncryptionRatio" DOUBLE PRECISION,
    "source" TEXT NOT NULL DEFAULT 'MANUAL_ENTRY',
    "notes" TEXT,
    "isDemoData" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostmasterStat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DomainAuthCheck_domain_checkedAt_idx" ON "DomainAuthCheck"("domain", "checkedAt");

-- CreateIndex
CREATE INDEX "DirectMailDailyMetric_metricDate_idx" ON "DirectMailDailyMetric"("metricDate");

-- CreateIndex
CREATE UNIQUE INDEX "DirectMailDailyMetric_metricDate_domainName_source_key" ON "DirectMailDailyMetric"("metricDate", "domainName", "source");

-- CreateIndex
CREATE INDEX "InboxPlacementTest_testedAt_idx" ON "InboxPlacementTest"("testedAt");

-- CreateIndex
CREATE INDEX "InboxPlacementTest_recipientProvider_idx" ON "InboxPlacementTest"("recipientProvider");

-- CreateIndex
CREATE INDEX "PostmasterStat_statDate_idx" ON "PostmasterStat"("statDate");

-- CreateIndex
CREATE UNIQUE INDEX "PostmasterStat_domain_statDate_source_key" ON "PostmasterStat"("domain", "statDate", "source");
