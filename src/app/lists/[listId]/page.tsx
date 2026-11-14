import { redirect } from 'next/navigation';
import { getServerSession } from '@/services/security/auth';
import { deriveCsrfToken } from '@/services/security/csrf';
import { isMailWizzMutationsEnabled } from '@/services/mutations/gate';
import { ListDetailView } from '@/components/ListDetailView';

export const dynamic = 'force-dynamic';

export default async function ListPage({
  params,
}: {
  params: Promise<{ listId: string }>;
}) {
  const session = await getServerSession();
  if (!session) {
    redirect('/login');
  }
  const { listId } = await params;

  return (
    <ListDetailView
      adminEmail={session.adminEmail}
      csrfToken={deriveCsrfToken(session)}
      listId={listId}
      phase1ReadOnly={!isMailWizzMutationsEnabled()}
    />
  );
}
