import { redirect } from 'next/navigation';
import { getServerSession } from '@/services/security/auth';
import { deriveCsrfToken } from '@/services/security/csrf';
import { getDashboardSummary } from '@/services/dashboard/summary';
import { DashboardView } from '@/components/DashboardView';

export const dynamic = 'force-dynamic';

export default async function HomePage({
  searchParams,
}: {
  searchParams?: Promise<{ customerConnectionId?: string }>;
}) {
  const session = await getServerSession();
  if (!session) {
    redirect('/login');
  }

  const sp = searchParams ? await searchParams : {};
  const customerConnectionId = sp.customerConnectionId?.trim() || undefined;
  const initialData = await getDashboardSummary({ customerConnectionId });

  return (
    <DashboardView
      adminEmail={session.adminEmail}
      csrfToken={deriveCsrfToken(session)}
      initialData={initialData}
    />
  );
}
