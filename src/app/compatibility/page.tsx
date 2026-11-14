import { redirect } from 'next/navigation';
import { getServerSession } from '@/services/security/auth';
import { deriveCsrfToken } from '@/services/security/csrf';
import { getCompatibilityDashboardData } from '@/services/mailwizz/compatibility-validator';
import { CompatibilityView } from '@/components/CompatibilityView';

export const dynamic = 'force-dynamic';

export default async function CompatibilityPage() {
  const session = await getServerSession();
  if (!session) redirect('/login');

  const initialData = await getCompatibilityDashboardData();

  return (
    <CompatibilityView
      adminEmail={session.adminEmail}
      csrfToken={deriveCsrfToken(session)}
      initialData={JSON.parse(JSON.stringify(initialData))}
    />
  );
}
