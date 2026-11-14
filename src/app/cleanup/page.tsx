import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getServerSession } from '@/services/security/auth';
import { deriveCsrfToken } from '@/services/security/csrf';
import { isMailWizzMutationsEnabled } from '@/services/mutations/gate';
import { CleanupWorkspaceView } from '@/components/CleanupWorkspaceView';

export const dynamic = 'force-dynamic';

export default async function CleanupPage() {
  const session = await getServerSession();
  if (!session) redirect('/login');

  const [cfg, lists, ops] = await Promise.all([
    prisma.appConfig.upsert({
      where: { id: 'default' },
      update: {},
      create: { id: 'default' },
    }),
    prisma.mailingList.findMany({
      orderBy: { syncedSubscriberCount: 'desc' },
      select: {
        id: true,
        listUid: true,
        name: true,
        syncedSubscriberCount: true,
      },
    }),
    prisma.cleanupOperation.findMany({
      orderBy: { createdAt: 'desc' },
      take: 25,
      include: { mailingList: { select: { name: true } } },
    }),
  ]);

  return (
    <CleanupWorkspaceView
      adminEmail={session.adminEmail}
      csrfToken={deriveCsrfToken(session)}
      isDemoMode={cfg.isDemoMode}
      phase1ReadOnly={!isMailWizzMutationsEnabled()}
      lists={lists}
      initialOperations={ops.map((o) => ({
        id: o.id,
        actionType: o.actionType,
        status: o.status,
        dryRunOnly: o.dryRunOnly,
        matchedCount: o.matchedCount,
        eligibleCount: o.eligibleCount,
        excludedCount: o.excludedCount,
        succeededCount: o.succeededCount,
        skippedCount: o.skippedCount,
        failedCount: o.failedCount,
        reconciledCount: o.reconciledCount,
        autoStopReason: o.autoStopReason,
        createdAt: o.createdAt.toISOString(),
        mailingList: o.mailingList,
      }))}
    />
  );
}
