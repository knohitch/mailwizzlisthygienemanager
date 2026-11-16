'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import * as Tabs from '@radix-ui/react-tabs';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Database,
  Download,
  FlaskConical,
  HelpCircle,
  Lock,
  Mail,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Users,
  XCircle,
} from 'lucide-react';
import { AppShell } from './AppShell';
import { Badge, Button, Card } from './ui';

interface CustomerAccountSummary {
  id: string;
  customerName: string;
  customerSlug: string;
  baseUrl: string;
  hostname: string;
  status: string;
  isEnabled: boolean;
  isQuarantine: boolean;
  isDemoData: boolean;
  apiKeyMasked: string | null;
  detectedVersion: string | null;
  isPaused: boolean;
  lastSyncStatus: string | null;
  lastSyncAt: string | null;
  lastErrorSafe: string | null;
  listsCount: number;
  subscribersCount: number;
  campaignsCount: number;
  engagedSubscribersCount: number;
  inactiveSubscribersCount: number;
}

interface DashboardData {
  scope?: 'GLOBAL' | 'CUSTOMER';
  selectedCustomerConnectionId?: string | null;
  isDemoMode: boolean;
  phase1ReadOnly: boolean;
  connectionConfigured: boolean;
  customerAccounts?: CustomerAccountSummary[];
  periodDays: number;
  lookbackDays: number;
  minDeliveredCampaigns: number;
  timezone: string;
  kpis: {
    totalLists: number;
    totalSubscribers: number;
    confirmedSubscribers: number;
    unconfirmedSubscribers: number;
    unsubscribedSubscribers: number;
    blacklistedSubscribers: number;
    hardBouncedSubscribers: number;
    complainedSubscribers: number;
    recentlyEngagedTotal: number;
    engagedStrong: number;
    engagedOpenOnly: number;
    potentiallyInactiveSubscribers: number;
    insufficientHistorySubscribers: number;
    unknownHistorySubscribers: number;
    excludedSubscribers: number;
    campaignsSentInPeriod: number;
    totalDeliverySuccess: number;
    totalDeliveryErrors: number;
    totalUniqueOpens: number;
    totalUniqueClicks: number;
    totalHardBounces: number;
    totalSoftBounces: number;
    totalInternalBounces: number;
    totalComplaints: number;
  };
  lists: Array<{
    id: string;
    customerConnectionId?: string;
    customerConnection?: { id: string; customerName: string; customerSlug: string; status: string };
    listUid: string;
    name: string;
    syncedSubscriberCount: number;
    confirmedCount: number;
    unconfirmedCount: number;
    unsubscribedCount: number;
    blacklistedCount: number;
    hardBouncedCount: number;
    complaintCount: number;
    reconciliationStatus: string;
    reconciliationNote: string | null;
    isDemoData: boolean;
    lastSyncedAt: string | null;
  }>;
  campaigns: Array<{
    id: string;
    campaignUid: string;
    name: string;
    status: string;
    sendAt: string | null;
    subscribersCount: number;
    deliverySuccessCount: number;
    deliveryErrorCount: number;
    uniqueOpensCount: number;
    uniqueOpensRate: number;
    uniqueClicksCount: number;
    uniqueClicksRate: number;
    hardBouncesCount: number;
    softBouncesCount: number;
    complaintsCount: number;
    reconciliationStatus: string;
    isDemoData: boolean;
  }>;
  capabilities: Array<{
    id: string;
    capabilityKey: string;
    category: string;
    endpointOrFeature: string;
    status: 'VERIFIED' | 'UNAVAILABLE' | 'NOT_YET_TESTED';
    notes: string;
    checkedAt: string;
  }>;
  recentJobs: Array<{
    id: string;
    type: string;
    status: string;
    progressCurrent: number;
    progressTotal: number;
    progressMessage: string | null;
    lastError: string | null;
    createdAt: string;
  }>;
}

interface AuditEntry {
  id: string;
  actorEmail: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  outcome: string;
  createdAt: string;
}

function KpiCard({
  label,
  value,
  subtext,
  tone = 'slate',
  icon,
}: {
  label: string;
  value: number | string;
  subtext?: string;
  tone?: 'slate' | 'emerald' | 'teal' | 'amber' | 'rose' | 'indigo' | 'sky';
  icon?: React.ReactNode;
}) {
  const accent: Record<string, string> = {
    slate: 'border-l-slate-400',
    emerald: 'border-l-emerald-500',
    teal: 'border-l-teal-500',
    amber: 'border-l-amber-500',
    rose: 'border-l-rose-500',
    indigo: 'border-l-indigo-500',
    sky: 'border-l-sky-500',
  };
  return (
    <Card className={`border-l-4 p-4 ${accent[tone]}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
          {label}
        </div>
        {icon && <div className="text-slate-400">{icon}</div>}
      </div>
      <div className="mt-1.5 text-2xl font-bold tabular-nums text-slate-900">
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      {subtext && <div className="mt-1 text-xs text-slate-500">{subtext}</div>}
    </Card>
  );
}

export function DashboardView({
  adminEmail,
  csrfToken,
  initialData,
}: {
  adminEmail: string;
  csrfToken: string;
  initialData: DashboardData;
}) {
  const [data, setData] = useState<DashboardData>(initialData);
  const [periodDays, setPeriodDays] = useState<number>(initialData.periodDays || 90);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>(
    initialData.selectedCustomerConnectionId ?? ''
  );
  const [selectedListId, setSelectedListId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [bannerMsg, setBannerMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null
  );
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([]);

  const refresh = useCallback(
    async (
      pDays = periodDays,
      listId = selectedListId,
      connId = selectedConnectionId
    ) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ periodDays: String(pDays) });
        if (connId) params.set('customerConnectionId', connId);
        if (listId) params.set('listId', listId);
        const auditUrl = connId
          ? `/api/audit?customerConnectionId=${encodeURIComponent(connId)}`
          : '/api/audit';
        const [dashRes, auditRes] = await Promise.all([
          fetch(`/api/dashboard?${params.toString()}`),
          fetch(auditUrl),
        ]);
        if (dashRes.ok) {
          setData((await dashRes.json()) as DashboardData);
        }
        if (auditRes.ok) {
          const auditJson = (await auditRes.json()) as { logs: AuditEntry[] };
          setAuditLogs(auditJson.logs);
        }
      } finally {
        setLoading(false);
      }
    },
    [periodDays, selectedListId, selectedConnectionId]
  );

  useEffect(() => {
    let active = true;
    fetch('/api/audit')
      .then((res) => (res.ok ? res.json() : null))
      .then((auditJson: { logs?: AuditEntry[] } | null) => {
        if (active && auditJson?.logs) {
          setAuditLogs(auditJson.logs);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  async function triggerSyncAction(
    action:
      | 'FULL_SYNC'
      | 'ANALYZE_HYGIENE'
      | 'SEED_DEMO_DATA'
      | 'CLEAR_DEMO_DATA'
  ) {
    setBannerMsg(null);
    setLoading(true);
    try {
      const res = await fetch('/api/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({
          action,
          ...(selectedConnectionId && (action === 'FULL_SYNC' || action === 'ANALYZE_HYGIENE')
            ? { customerConnectionId: selectedConnectionId }
            : {}),
        }),
      });
      const json = (await res.json()) as { error?: string; job?: { id: string } };
      if (!res.ok) {
        setBannerMsg({ type: 'err', text: json.error ?? 'Action failed.' });
        return;
      }
      setBannerMsg({
        type: 'ok',
        text:
          action === 'SEED_DEMO_DATA'
            ? 'Synthetic demo fixtures seeded (~2,190 subscribers across 3 lists).'
            : action === 'CLEAR_DEMO_DATA'
              ? 'Synthetic demo data cleared.'
              : `Background job queued (${json.job?.id ?? 'pending'}).`,
      });
      await refresh();
    } finally {
      setLoading(false);
    }
  }

  async function testPhase2Gate() {
    const res = await fetch('/api/mutations/preview', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({
        operation: 'unsubscribe',
        listUid: data.lists[0]?.listUid ?? 'demo-list',
        subscriberUid: 'test-sub',
      }),
    });
    const json = (await res.json()) as { error?: string };
    setBannerMsg({
      type: res.status === 403 ? 'ok' : 'err',
      text:
        res.status === 403
          ? `Phase 1 Gate Verified (HTTP 403): ${json.error}`
          : 'Unexpected mutation gate status.',
    });
    await refresh();
  }

  const k = data.kpis;

  return (
    <AppShell
      adminEmail={adminEmail}
      csrfToken={csrfToken}
      isDemoMode={data.isDemoMode}
      phase1ReadOnly={data.phase1ReadOnly}
    >
      <div className="space-y-6">
        {/* Top Control Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Deliverability &amp; List Hygiene Overview
            </h1>
            <p className="text-sm text-slate-600">
              Lookback: <span className="font-medium">{data.lookbackDays} days</span> • Min delivered campaigns before inactive classification:{' '}
              <span className="font-medium">{data.minDeliveredCampaigns}</span> • Timezone:{' '}
              <span className="font-medium">{data.timezone}</span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {(data.customerAccounts?.length ?? 0) > 0 && (
              <select
                aria-label="Filter by customer account"
                data-testid="dashboard-customer-selector"
                value={selectedConnectionId}
                onChange={(e) => {
                  const next = e.target.value;
                  setSelectedConnectionId(next);
                  setSelectedListId('');
                  void refresh(periodDays, '', next);
                }}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800"
              >
                <option value="">
                  Global Overview (All {data.customerAccounts?.length ?? 0} Accounts)
                </option>
                {data.customerAccounts?.map((acct) => (
                  <option key={acct.id} value={acct.id}>
                    {acct.customerName} ({acct.status})
                  </option>
                ))}
              </select>
            )}

            <select
              aria-label="Reporting period"
              value={periodDays}
              onChange={(e) => {
                const next = Number(e.target.value);
                setPeriodDays(next);
                void refresh(next, selectedListId, selectedConnectionId);
              }}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700"
            >
              <option value={30}>Last 30 days</option>
              <option value={60}>Last 60 days</option>
              <option value={90}>Last 90 days</option>
              <option value={180}>Last 180 days</option>
              <option value={365}>Last 365 days</option>
            </select>

            <select
              aria-label="Filter by list"
              value={selectedListId}
              onChange={(e) => {
                const next = e.target.value;
                setSelectedListId(next);
                void refresh(periodDays, next, selectedConnectionId);
              }}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700"
            >
              <option value="">All Mailing Lists ({data.lists.length})</option>
              {data.lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} ({l.syncedSubscriberCount})
                </option>
              ))}
            </select>

            <Button
              variant="outline"
              size="sm"
              onClick={() => triggerSyncAction('ANALYZE_HYGIENE')}
              disabled={loading}
            >
              <Sparkles className="h-3.5 w-3.5" />
              Re-Analyze
            </Button>

            <Button
              variant="secondary"
              size="sm"
              onClick={() => triggerSyncAction('FULL_SYNC')}
              disabled={loading || !data.connectionConfigured}
              title={
                data.connectionConfigured
                  ? 'Queue read-only MailWizz sync job'
                  : 'Configure a customer connection in Customer Connections first'
              }
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              Sync MailWizz
            </Button>

            <a
              href={`/api/exports/subscribers?format=csv&encrypted=true${
                selectedConnectionId
                  ? `&customerConnectionId=${encodeURIComponent(selectedConnectionId)}`
                  : ''
              }${selectedListId ? `&listId=${encodeURIComponent(selectedListId)}` : ''}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <Download className="h-3.5 w-3.5" />
              Encrypted Export
            </a>
          </div>
        </div>

        {/* Connection / Action Alerts */}
        {!data.connectionConfigured && (
          <Card className="border-indigo-200 bg-indigo-50/70 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                <Database className="mt-0.5 h-5 w-5 text-indigo-700" />
                <div>
                  <h2 className="text-sm font-semibold text-indigo-950">
                    Live MailWizz 3.0.5 Connection Not Configured Yet
                  </h2>
                  <p className="text-xs text-indigo-800">
                    No live MailWizz instance is accessed until you provide your API URL and{' '}
                    <code>X-Api-Key</code> in Settings. You can test the full console safely using synthetic demo fixtures.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {!data.isDemoMode ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => triggerSyncAction('SEED_DEMO_DATA')}
                    disabled={loading}
                  >
                    <FlaskConical className="h-3.5 w-3.5" />
                    Load Synthetic Demo Data
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => triggerSyncAction('CLEAR_DEMO_DATA')}
                    disabled={loading}
                  >
                    Clear Demo Data
                  </Button>
                )}
                <Link
                  href="/settings"
                  className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500"
                >
                  Configure MailWizz
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>
          </Card>
        )}

        {bannerMsg && (
          <div
            role="status"
            className={`rounded-lg border px-4 py-2.5 text-sm ${
              bannerMsg.type === 'ok'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                : 'border-rose-200 bg-rose-50 text-rose-900'
            }`}
          >
            {bannerMsg.text}
          </div>
        )}

        {/* Multi-Customer Account Health Strip */}
        {(data.customerAccounts?.length ?? 0) > 0 && (
          <section aria-label="Customer accounts overview" data-testid="customer-accounts-overview">
            <Card className="p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-slate-900">
                    {selectedConnectionId
                      ? 'Active Customer Account Scope'
                      : `Global Admin Overview (${data.customerAccounts?.length ?? 0} Customer Connections)`}
                  </h2>
                  {selectedConnectionId && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedConnectionId('');
                        setSelectedListId('');
                        void refresh(periodDays, '', '');
                      }}
                      className="text-xs font-medium text-indigo-600 hover:underline"
                    >
                      Show All Customers
                    </button>
                  )}
                </div>
                <Link
                  href="/connections"
                  className="text-xs font-medium text-indigo-600 hover:underline"
                >
                  Manage Customer Connections &rarr;
                </Link>
              </div>
              <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 lg:grid-cols-3">
                {data.customerAccounts?.map((acct) => {
                  const active = selectedConnectionId === acct.id;
                  return (
                    <div
                      key={acct.id}
                      className={`rounded-lg border p-3 text-xs transition-colors ${
                        active
                          ? 'border-indigo-400 bg-indigo-50/50'
                          : 'border-slate-200 bg-slate-50/50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-semibold text-slate-900 truncate">
                          {acct.customerName}
                        </div>
                        <Badge
                          tone={
                            acct.status === 'CONNECTED'
                              ? 'emerald'
                              : acct.status === 'AUTH_FAILED' || acct.status === 'ERROR'
                                ? 'rose'
                                : acct.isQuarantine
                                  ? 'amber'
                                  : 'slate'
                          }
                        >
                          {acct.isQuarantine ? 'QUARANTINED' : acct.status}
                        </Badge>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[11px] text-slate-600">
                        <span>{acct.hostname}</span>
                        <span>Key: <code>{acct.apiKeyMasked ?? 'none'}</code></span>
                        {acct.isPaused && <span className="text-amber-700 font-medium">Paused</span>}
                      </div>
                      <div className="mt-2 flex items-center justify-between text-[11px] text-slate-700">
                        <span>
                          {acct.listsCount} lists • {acct.subscribersCount.toLocaleString()} subs
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedConnectionId(acct.id);
                            setSelectedListId('');
                            void refresh(periodDays, '', acct.id);
                          }}
                          className="font-medium text-indigo-600 hover:underline"
                        >
                          {active ? 'Viewing' : 'Inspect Account'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </section>
        )}

        {/* Primary Hygiene & Subscriber Status KPIs */}
        <section aria-label="Subscriber and hygiene KPIs">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="Total MailWizz Lists"
              value={k.totalLists}
              subtext="Auto-discovered via API"
              tone="slate"
              icon={<Database className="h-4 w-4" />}
            />
            <KpiCard
              label="Total Subscribers"
              value={k.totalSubscribers}
              subtext={`${k.confirmedSubscribers.toLocaleString()} confirmed • ${k.unconfirmedSubscribers.toLocaleString()} unconfirmed`}
              tone="indigo"
              icon={<Users className="h-4 w-4" />}
            />
            <KpiCard
              label="Recently Engaged (Total)"
              value={k.recentlyEngagedTotal}
              subtext={`${k.engagedStrong.toLocaleString()} strong (clicks/replies) • ${k.engagedOpenOnly.toLocaleString()} open-only`}
              tone="emerald"
              icon={<CheckCircle2 className="h-4 w-4" />}
            />
            <KpiCard
              label="Potentially Inactive"
              value={k.potentiallyInactiveSubscribers}
              subtext={`Verified >= ${data.minDeliveredCampaigns} delivered campaigns & 0 engagement`}
              tone="amber"
              icon={<AlertTriangle className="h-4 w-4" />}
            />

            <KpiCard
              label="Strong Engagement (Click+)"
              value={k.engagedStrong}
              subtext="Verified click, reply, or conversion in lookback"
              tone="emerald"
            />
            <KpiCard
              label="Open-Only Engagement"
              value={k.engagedOpenOnly}
              subtext="Tracked separately (open pixel/MPP caveat)"
              tone="teal"
            />
            <KpiCard
              label="Insufficient History"
              value={k.insufficientHistorySubscribers}
              subtext={`Fewer than ${data.minDeliveredCampaigns} delivered campaigns`}
              tone="sky"
            />
            <KpiCard
              label="UNKNOWN History"
              value={k.unknownHistorySubscribers}
              subtext="Inactivity decisions disabled (needs Priority B/C/D)"
              tone="slate"
              icon={<HelpCircle className="h-4 w-4" />}
            />

            <KpiCard
              label="Already Unsubscribed"
              value={k.unsubscribedSubscribers}
              subtext={`${k.blacklistedSubscribers.toLocaleString()} blacklisted`}
              tone="slate"
            />
            <KpiCard
              label="Hard-Bounced Contacts"
              value={k.hardBouncedSubscribers}
              subtext="From MailWizz campaign bounce logs"
              tone="rose"
              icon={<XCircle className="h-4 w-4" />}
            />
            <KpiCard
              label="Spam Complaints"
              value={k.complainedSubscribers}
              subtext={`Campaign aggregate complaints: ${k.totalComplaints}`}
              tone="rose"
              icon={<ShieldAlert className="h-4 w-4" />}
            />
            <KpiCard
              label="Excluded (Protected)"
              value={k.excludedSubscribers}
              subtext="VIP domains, protected sources, or recent grace window"
              tone="indigo"
            />
          </div>
        </section>

        {/* Campaign Summary Strip */}
        <section aria-label="Campaign delivery and engagement metrics">
          <Card className="p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Mail className="h-4 w-4 text-slate-600" />
                Campaign Delivery &amp; Engagement ({periodDays}-Day Window)
              </h2>
              <span className="text-xs text-slate-500">
                Aggregated from MailWizz <code>GET /campaigns/&#123;uid&#125;/stats</code>
              </span>
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              <div>
                <div className="text-xs text-slate-500">Campaigns Sent</div>
                <div className="text-lg font-semibold tabular-nums">
                  {k.campaignsSentInPeriod.toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Delivery Success</div>
                <div className="text-lg font-semibold tabular-nums text-emerald-700">
                  {k.totalDeliverySuccess.toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Unique Opens</div>
                <div className="text-lg font-semibold tabular-nums text-teal-700">
                  {k.totalUniqueOpens.toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Unique Clicks</div>
                <div className="text-lg font-semibold tabular-nums text-indigo-700">
                  {k.totalUniqueClicks.toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Delivery Errors</div>
                <div className="text-lg font-semibold tabular-nums text-rose-700">
                  {k.totalDeliveryErrors.toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Bounces (Hard / Soft)</div>
                <div className="text-lg font-semibold tabular-nums text-amber-700">
                  {k.totalHardBounces.toLocaleString()} / {k.totalSoftBounces.toLocaleString()}
                </div>
              </div>
            </div>
          </Card>
        </section>

        {/* Detailed Operational Tabs */}
        <Tabs.Root defaultValue="lists" className="space-y-4">
          <Tabs.List
            aria-label="Dashboard sections"
            className="flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1"
          >
            {[
              { id: 'lists', label: `Mailing Lists (${data.lists.length})` },
              { id: 'campaigns', label: `Campaigns (${data.campaigns.length})` },
              { id: 'capabilities', label: 'MailWizz 3.0.5 API Matrix' },
              { id: 'jobs', label: `Jobs & Audit (${data.recentJobs.length})` },
            ].map((tab) => (
              <Tabs.Trigger
                key={tab.id}
                value={tab.id}
                className="rounded-lg px-3.5 py-2 text-sm font-medium text-slate-600 transition-colors data-[state=active]:bg-slate-900 data-[state=active]:text-white"
              >
                {tab.label}
              </Tabs.Trigger>
            ))}
          </Tabs.List>

          {/* Lists Tab */}
          <Tabs.Content value="lists">
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-3">List</th>
                      <th className="px-4 py-3 text-right">Total</th>
                      <th className="px-4 py-3 text-right">Confirmed</th>
                      <th className="px-4 py-3 text-right">Unconfirmed</th>
                      <th className="px-4 py-3 text-right">Unsubscribed</th>
                      <th className="px-4 py-3 text-right">Hard Bounced</th>
                      <th className="px-4 py-3">Reconciliation</th>
                      <th className="px-4 py-3 text-right">Inspect</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {data.lists.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                          No mailing lists synced yet. Connect MailWizz in Settings or load synthetic demo data.
                        </td>
                      </tr>
                    ) : (
                      data.lists.map((list) => (
                        <tr key={list.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2 font-medium text-slate-900">
                              {list.name}
                              {list.isDemoData && <Badge tone="amber">Demo</Badge>}
                              {list.customerConnection && (
                                <Badge tone="slate">{list.customerConnection.customerName}</Badge>
                              )}
                            </div>
                            <div className="text-xs text-slate-500">
                              UID: <code>{list.listUid}</code>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums font-medium">
                            {list.syncedSubscriberCount.toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-emerald-700">
                            {list.confirmedCount.toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                            {list.unconfirmedCount.toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                            {list.unsubscribedCount.toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-rose-700">
                            {list.hardBouncedCount.toLocaleString()}
                          </td>
                          <td className="px-4 py-3">
                            <Badge
                              tone={
                                list.reconciliationStatus === 'MATCHED'
                                  ? 'emerald'
                                  : list.reconciliationStatus === 'DISCREPANCY'
                                    ? 'amber'
                                    : 'slate'
                              }
                            >
                              {list.reconciliationStatus}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Link
                              href={`/lists/${list.id}`}
                              className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                            >
                              Open List
                              <ArrowRight className="h-3 w-3" />
                            </Link>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </Tabs.Content>

          {/* Campaigns Tab */}
          <Tabs.Content value="campaigns">
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Campaign</th>
                      <th className="px-4 py-3">Sent Date</th>
                      <th className="px-4 py-3 text-right">Delivered</th>
                      <th className="px-4 py-3 text-right">Unique Opens</th>
                      <th className="px-4 py-3 text-right">Unique Clicks</th>
                      <th className="px-4 py-3 text-right">Hard / Soft Bounces</th>
                      <th className="px-4 py-3 text-right">Complaints</th>
                      <th className="px-4 py-3">Bounce Recon</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {data.campaigns.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                          No campaigns found in selected period.
                        </td>
                      </tr>
                    ) : (
                      data.campaigns.map((camp) => (
                        <tr key={camp.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2 font-medium text-slate-900">
                              {camp.name}
                              {camp.isDemoData && <Badge tone="amber">Demo</Badge>}
                            </div>
                            <div className="text-xs text-slate-500">
                              UID: <code>{camp.campaignUid}</code> • Status: {camp.status}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-600">
                            {camp.sendAt
                              ? new Date(camp.sendAt).toLocaleDateString()
                              : 'Not scheduled'}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            {camp.deliverySuccessCount.toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            {camp.uniqueOpensCount.toLocaleString()} ({camp.uniqueOpensRate}%)
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            {camp.uniqueClicksCount.toLocaleString()} ({camp.uniqueClicksRate}%)
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-rose-700">
                            {camp.hardBouncesCount} / {camp.softBouncesCount}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            {camp.complaintsCount}
                          </td>
                          <td className="px-4 py-3">
                            <Badge
                              tone={
                                camp.reconciliationStatus === 'MATCHED'
                                  ? 'emerald'
                                  : 'amber'
                              }
                            >
                              {camp.reconciliationStatus}
                            </Badge>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </Tabs.Content>

          {/* Capability Matrix Tab */}
          <Tabs.Content value="capabilities">
            <Card className="overflow-hidden">
              <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                <h3 className="text-sm font-semibold text-slate-900">
                  MailWizz 3.0.5 API &amp; Historical Engagement Capability Matrix
                </h3>
                <p className="text-xs text-slate-600">
                  Tracks verified capabilities vs API gaps. Tracking endpoints (<code>trackOpening</code>, <code>trackUrl</code>) are blocked at transport level so false engagement data can never be generated.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-200 bg-white text-xs font-semibold uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Category</th>
                      <th className="px-4 py-3">Endpoint / Feature</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Verification &amp; Technical Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {data.capabilities.map((cap) => (
                      <tr key={cap.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium text-slate-800">
                          {cap.category}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-700">
                          {cap.endpointOrFeature}
                        </td>
                        <td className="px-4 py-3">
                          <Badge
                            tone={
                              cap.status === 'VERIFIED'
                                ? 'emerald'
                                : cap.status === 'UNAVAILABLE'
                                  ? 'rose'
                                  : 'amber'
                            }
                          >
                            {cap.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-600">{cap.notes}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </Tabs.Content>

          {/* Jobs & Audit Tab */}
          <Tabs.Content value="jobs" className="space-y-4">
            <Card className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <Lock className="h-4 w-4 text-emerald-700" />
                    Phase 2 Mutation Gate Status
                  </h3>
                  <p className="text-xs text-slate-600">
                    <code>ENABLE_MAILWIZZ_MUTATIONS=false</code> — All unsubscribe, segment creation, and subscriber move interfaces are disabled in Phase 1.
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={testPhase2Gate}>
                  Verify Mutation Gate Block
                </Button>
              </div>
            </Card>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card className="overflow-hidden">
                <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-900">
                  Recent Background Worker Jobs
                </div>
                <div className="divide-y divide-slate-200">
                  {data.recentJobs.length === 0 ? (
                    <div className="p-4 text-xs text-slate-500">No background jobs queued yet.</div>
                  ) : (
                    data.recentJobs.map((job) => (
                      <div key={job.id} className="flex items-center justify-between px-4 py-3 text-xs">
                        <div>
                          <div className="font-medium text-slate-900">{job.type}</div>
                          <div className="text-slate-500">
                            {job.progressMessage ?? 'Pending'} ({job.progressCurrent}/{job.progressTotal})
                          </div>
                          {job.lastError && (
                            <div className="mt-0.5 text-rose-700">{job.lastError}</div>
                          )}
                        </div>
                        <Badge
                          tone={
                            job.status === 'COMPLETED'
                              ? 'emerald'
                              : job.status === 'FAILED'
                                ? 'rose'
                                : job.status === 'RUNNING'
                                  ? 'indigo'
                                  : 'amber'
                          }
                        >
                          {job.status}
                        </Badge>
                      </div>
                    ))
                  )}
                </div>
              </Card>

              <Card className="overflow-hidden">
                <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-900">
                  Administrative Audit Log (PII-Redacted)
                </div>
                <div className="divide-y divide-slate-200">
                  {auditLogs.length === 0 ? (
                    <div className="p-4 text-xs text-slate-500">No audit entries yet.</div>
                  ) : (
                    auditLogs.slice(0, 10).map((log) => (
                      <div key={log.id} className="flex items-center justify-between px-4 py-2.5 text-xs">
                        <div>
                          <div className="font-medium text-slate-900">
                            {log.action}{' '}
                            <span className="font-normal text-slate-500">
                              ({log.resourceType})
                            </span>
                          </div>
                          <div className="text-slate-500">
                            {log.actorEmail} • {new Date(log.createdAt).toLocaleString()}
                          </div>
                        </div>
                        <Badge
                          tone={
                            log.outcome === 'SUCCESS'
                              ? 'emerald'
                              : log.outcome === 'DENIED'
                                ? 'amber'
                                : 'rose'
                          }
                        >
                          {log.outcome}
                        </Badge>
                      </div>
                    ))
                  )}
                </div>
              </Card>
            </div>
          </Tabs.Content>
        </Tabs.Root>
      </div>
    </AppShell>
  );
}
