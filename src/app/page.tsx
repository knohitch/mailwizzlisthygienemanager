import { redirect } from 'next/navigation';
import { getServerSession } from '@/services/security/auth';
import { deriveCsrfToken } from '@/services/security/csrf';
import { getDashboardSummary } from '@/services/dashboard/summary';
import { DashboardView } from '@/components/DashboardView';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const session = await getServerSession();
  if (!session) {
    redirect('/login');
  }

  const initialData = await getDashboardSummary();

  return (
    <DashboardView
      adminEmail={session.adminEmail}
      csrfToken={deriveCsrfToken(session)}
      initialData={initialData}
    />
  );
}
