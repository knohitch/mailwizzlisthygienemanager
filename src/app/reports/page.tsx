import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getServerSession } from '@/services/security/auth';
import { deriveCsrfToken } from '@/services/security/csrf';
import { isMailWizzMutationsEnabled } from '@/services/mutations/gate';
import { generateAllReportsSummary } from '@/services/reports/generator';
import { ReportsView } from '@/components/ReportsView';

export const dynamic = 'force-dynamic';

export default async function ReportsPage() {
  const session = await getServerSession();
  if (!session) redirect('/login');

  const [cfg, lists, summary] = await Promise.all([
    prisma.appConfig.upsert({
      where: { id: 'default' },
      update: {},
      create: { id: 'default' },
    }),
    prisma.mailingList.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    generateAllReportsSummary(),
  ]);

  return (
    <ReportsView
      adminEmail={session.adminEmail}
      csrfToken={deriveCsrfToken(session)}
      isDemoMode={cfg.isDemoMode}
      phase1ReadOnly={!isMailWizzMutationsEnabled()}
      lists={lists}
      initialSummary={summary}
    />
  );
}
