import { NextRequest, NextResponse } from 'next/server';
import { requireApiAuth } from '@/lib/api-auth';
import { getMailWizzClientWithContext } from '@/services/mailwizz/client-factory';
import {
  MailWizzCampaignSummarySchema,
  MailWizzListRecordSchema,
  MailWizzPaginatedEnvelopeSchema,
  MailWizzSubscriberRecordSchema,
} from '@/services/mailwizz/types';
import { maskEmail } from '@/services/cleanup/safety';
import { recordAuditLog } from '@/services/security/audit';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireApiAuth(req, {
    rateLimitBucket: 'connections-sample',
    limitPerMin: 20,
  });
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const sp = req.nextUrl.searchParams;
  const limit = Math.max(1, Math.min(25, Number(sp.get('limit')) || 10));
  const requestedListUid = sp.get('listUid')?.trim() || undefined;

  try {
    const ctx = await getMailWizzClientWithContext(id);

    const listsRes = await ctx.client.getJson(
      '/lists',
      MailWizzPaginatedEnvelopeSchema(MailWizzListRecordSchema),
      { page: 1, per_page: limit }
    );
    const lists = (listsRes.data?.records ?? []).slice(0, limit).map((l) => ({
      listUid: l.general.list_uid,
      name: l.general.name,
      subscribersCount: l.general.subscribers_count ?? null,
      optIn: l.general.opt_in ?? null,
    }));

    const sampleListUid = requestedListUid ?? lists[0]?.listUid ?? null;
    let subscribers: Array<{
      subscriberUid: string;
      maskedEmail: string;
      status: string;
      dateAdded: string | null;
    }> = [];
    let subscribersTotalReported: number | null = null;

    if (sampleListUid) {
      const subsRes = await ctx.client.getJson(
        `/lists/${encodeURIComponent(sampleListUid)}/subscribers`,
        MailWizzPaginatedEnvelopeSchema(MailWizzSubscriberRecordSchema),
        { page: 1, per_page: limit }
      );
      subscribersTotalReported = subsRes.data?.count ?? null;
      subscribers = (subsRes.data?.records ?? []).slice(0, limit).map((s) => ({
        subscriberUid: s.subscriber_uid,
        maskedEmail: maskEmail(s.EMAIL ?? s.email ?? ''),
        status: s.status ?? 'unknown',
        dateAdded: s.date_added ?? null,
      }));
    }

    let campaigns: Array<{ campaignUid: string; name: string; status: string }> = [];
    let campaignsTotalReported: number | null = null;
    try {
      const campsRes = await ctx.client.getJson(
        '/campaigns',
        MailWizzPaginatedEnvelopeSchema(MailWizzCampaignSummarySchema),
        { page: 1, per_page: limit }
      );
      campaignsTotalReported = campsRes.data?.count ?? null;
      campaigns = (campsRes.data?.records ?? []).slice(0, limit).map((c) => ({
        campaignUid: c.campaign_uid,
        name: c.name,
        status: c.status,
      }));
    } catch {
      campaigns = [];
    }

    await recordAuditLog({
      customerConnectionId: ctx.connectionId,
      actorEmail: auth.session.adminEmail,
      action: 'READ_ONLY_LIVE_SAMPLE',
      resourceType: 'MailWizzCustomerConnection',
      resourceId: ctx.connectionId,
      outcome: 'SUCCESS',
      ipAddress: auth.ip,
      details: {
        limit,
        sampleListUid,
        listsCount: lists.length,
        subscribersSampled: subscribers.length,
        campaignsSampled: campaigns.length,
      },
    });

    return NextResponse.json({
      readOnly: true,
      connection: {
        id: ctx.connectionId,
        customerName: ctx.customerName,
        customerSlug: ctx.customerSlug,
        baseUrl: ctx.baseUrl,
        apiKeyMasked: `****${ctx.apiKeyLast4}`,
        credentialVersion: ctx.credentialVersion,
      },
      limit,
      totalListsReported: listsRes.data?.count ?? lists.length,
      lists,
      sampledListUid: sampleListUid,
      subscribersTotalReported,
      subscribers,
      campaignsTotalReported,
      campaigns,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to inspect live sample.' },
      { status: 400 }
    );
  }
}
