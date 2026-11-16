-- Phase 4 Hardening: Prevent destructive cascade deletion of consent history, cleanup snapshots,
-- engagement events, mailing lists, campaigns, and re-engagement plans when removing a customer connection.
-- Connections with history must use the safe Disable & Archive workflow instead of hard delete.

ALTER TABLE "MailingList" DROP CONSTRAINT IF EXISTS "MailingList_customerConnectionId_fkey";
ALTER TABLE "MailingList" ADD CONSTRAINT "MailingList_customerConnectionId_fkey"
  FOREIGN KEY ("customerConnectionId") REFERENCES "MailWizzCustomerConnection"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ListSegment" DROP CONSTRAINT IF EXISTS "ListSegment_customerConnectionId_fkey";
ALTER TABLE "ListSegment" ADD CONSTRAINT "ListSegment_customerConnectionId_fkey"
  FOREIGN KEY ("customerConnectionId") REFERENCES "MailWizzCustomerConnection"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Subscriber" DROP CONSTRAINT IF EXISTS "Subscriber_customerConnectionId_fkey";
ALTER TABLE "Subscriber" ADD CONSTRAINT "Subscriber_customerConnectionId_fkey"
  FOREIGN KEY ("customerConnectionId") REFERENCES "MailWizzCustomerConnection"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Campaign" DROP CONSTRAINT IF EXISTS "Campaign_customerConnectionId_fkey";
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_customerConnectionId_fkey"
  FOREIGN KEY ("customerConnectionId") REFERENCES "MailWizzCustomerConnection"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EngagementEvent" DROP CONSTRAINT IF EXISTS "EngagementEvent_customerConnectionId_fkey";
ALTER TABLE "EngagementEvent" ADD CONSTRAINT "EngagementEvent_customerConnectionId_fkey"
  FOREIGN KEY ("customerConnectionId") REFERENCES "MailWizzCustomerConnection"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CleanupOperation" DROP CONSTRAINT IF EXISTS "CleanupOperation_customerConnectionId_fkey";
ALTER TABLE "CleanupOperation" ADD CONSTRAINT "CleanupOperation_customerConnectionId_fkey"
  FOREIGN KEY ("customerConnectionId") REFERENCES "MailWizzCustomerConnection"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CleanupOperationRecord" DROP CONSTRAINT IF EXISTS "CleanupOperationRecord_customerConnectionId_fkey";
ALTER TABLE "CleanupOperationRecord" ADD CONSTRAINT "CleanupOperationRecord_customerConnectionId_fkey"
  FOREIGN KEY ("customerConnectionId") REFERENCES "MailWizzCustomerConnection"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ReengagementPlan" DROP CONSTRAINT IF EXISTS "ReengagementPlan_customerConnectionId_fkey";
ALTER TABLE "ReengagementPlan" ADD CONSTRAINT "ReengagementPlan_customerConnectionId_fkey"
  FOREIGN KEY ("customerConnectionId") REFERENCES "MailWizzCustomerConnection"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
