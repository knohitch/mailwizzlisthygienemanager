import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireApiAuth } from '@/lib/api-auth';
import {
  mailWizzMutationService,
  MutationGateLockedError,
} from '@/services/mutations/gate';

const PreviewSchema = z.object({
  operation: z.enum(['unsubscribe', 'create_segment', 'copy_clean_list']),
  listUid: z.string().min(1),
  subscriberUid: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const auth = await requireApiAuth(req, {
    requireCsrf: true,
    rateLimitBucket: 'mutation-gate',
  });
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const parsed = PreviewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  try {
    if (parsed.data.operation === 'unsubscribe') {
      await mailWizzMutationService.unsubscribeSubscriber({
        listUid: parsed.data.listUid,
        subscriberUid: parsed.data.subscriberUid ?? 'unknown',
        actorEmail: auth.session.adminEmail,
      });
    } else if (parsed.data.operation === 'create_segment') {
      await mailWizzMutationService.createHygieneSegment({
        listUid: parsed.data.listUid,
        segmentName: 'Phase2 Preview',
        subscriberUids: [],
        actorEmail: auth.session.adminEmail,
      });
    } else {
      await mailWizzMutationService.copySubscribersToCleanList({
        sourceListUid: parsed.data.listUid,
        targetListName: 'Phase2 Clean List',
        subscriberUids: [],
        actorEmail: auth.session.adminEmail,
      });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof MutationGateLockedError) {
      return NextResponse.json(
        { error: err.message, locked: true, phase: 'phase-1-readonly' },
        { status: 403 }
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Mutation failed.' },
      { status: 500 }
    );
  }
}
