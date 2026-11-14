import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getServerSession } from '@/services/security/auth';
import { deriveCsrfToken } from '@/services/security/csrf';
import { isMailWizzMutationsEnabled } from '@/services/mutations/gate';
import { ReengagementView } from '@/components/ReengagementView';

export const dynamic = 'force-dynamic';

export default async function ReengagementPage() {
  const session = await getServerSession();
  if (!session) redirect('/login');

  const [cfg, lists, plans] = await Promise.all([
    prisma.appConfig.upsert({
      where: { id: 'default' },
      update: {},
      create: { id: 'default' },
    }),
    prisma.mailingList.findMany({
      orderBy: { syncedSubscriberCount: 'desc' },
      select: { id: true, name: true, listUid: true, syncedSubscriberCount: true },
    }),
    prisma.reengagementPlan.findMany({
      orderBy: { createdAt: 'desc' },
      take: 25,
      include: { mailingList: { select: { name: true, listUid: true } } },
    }),
  ]);

  return (
    <ReengagementView
      adminEmail={session.adminEmail}
      csrfToken={deriveCsrfToken(session)}
      isDemoMode={cfg.isDemoMode}
      phase1ReadOnly={!isMailWizzMutationsEnabled()}
      lists={lists}
      initialPlans={plans.map((p) => ({
        ...p,
        createdAt: p.createdAt.toISOString(),
      }))}
    />
  );
}
