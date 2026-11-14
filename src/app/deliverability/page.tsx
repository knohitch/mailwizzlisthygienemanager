import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getServerSession } from '@/services/security/auth';
import { deriveCsrfToken } from '@/services/security/csrf';
import { isMailWizzMutationsEnabled } from '@/services/mutations/gate';
import { getDeliverabilityDashboardData } from '@/services/deliverability/metrics';
import { DeliverabilityView } from '@/components/DeliverabilityView';

export const dynamic = 'force-dynamic';

export default async function DeliverabilityPage() {
  const session = await getServerSession();
  if (!session) redirect('/login');

  const [cfg, initialData] = await Promise.all([
    prisma.appConfig.upsert({
      where: { id: 'default' },
      update: {},
      create: { id: 'default' },
    }),
    getDeliverabilityDashboardData({ days: 365 }),
  ]);

  return (
    <DeliverabilityView
      adminEmail={session.adminEmail}
      csrfToken={deriveCsrfToken(session)}
      isDemoMode={cfg.isDemoMode}
      phase1ReadOnly={!isMailWizzMutationsEnabled()}
      alibabaKeyLast4={cfg.alibabaKeyLast4 ?? null}
      initialData={JSON.parse(JSON.stringify(initialData))}
    />
  );
}
