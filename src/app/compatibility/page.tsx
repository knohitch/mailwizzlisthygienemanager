import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getServerSession } from '@/services/security/auth';
import { deriveCsrfToken } from '@/services/security/csrf';
import { getCompatibilityDashboardData } from '@/services/mailwizz/compatibility-validator';
import { CompatibilityView } from '@/components/CompatibilityView';

export const dynamic = 'force-dynamic';

export default async function CompatibilityPage({
  searchParams,
}: {
  searchParams?: Promise<{ customerConnectionId?: string }>;
}) {
  const session = await getServerSession();
  if (!session) redirect('/login');

  const sp = searchParams ? await searchParams : {};
  const connections = await prisma.mailWizzCustomerConnection.findMany({
    where: { isQuarantine: false },
    orderBy: [{ isPrimary: 'desc' }, { customerName: 'asc' }],
    select: {
      id: true,
      customerName: true,
      customerSlug: true,
      status: true,
      isEnabled: true,
    },
  });

  const requestedConnId = sp.customerConnectionId?.trim() || connections[0]?.id;
  const initialData = await getCompatibilityDashboardData(requestedConnId);

  return (
    <CompatibilityView
      adminEmail={session.adminEmail}
      csrfToken={deriveCsrfToken(session)}
      connections={connections}
      initialConnectionId={initialData.report.customerConnectionId ?? requestedConnId ?? ''}
      initialData={JSON.parse(JSON.stringify(initialData))}
    />
  );
}
