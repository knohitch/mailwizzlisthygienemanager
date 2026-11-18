'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import * as Tabs from '@radix-ui/react-tabs';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Database,
  Download,
  Filter,
  FlaskConical,
  GitCompareArrows,
  HelpCircle,
  Lock,
  Mail,
  MailCheck,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Users,
  XCircle,
} from 'lucide-react';
import { AppShell } from './AppShell';
import {
  AgentWorkflowStrip,
  Badge,
  Button,
  Card,
  StatusDot,
  type BadgeTone,
} from './ui';

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
    customerConnection?: {
      id: string;
      customerName: string;
      customerSlug: string;
      status: string;
    };
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

function TelemetryCell({
  label,
  value,
  subtext,
  tone = 'slate',
  icon,
}: {
  label: string;
  value: number | string;
  subtext?: string;
  tone?: BadgeTone;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col justify-between bg-[var(--bg-card)] p-4.5 transition-colors hover:bg-[var(--bg-well)]">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <StatusDot tone={tone} />
          <div className="font-display truncate text-xs font-bold text-[var(--fg-secondary)]">
            {label}
          </div>
        </div>
        {icon && <div className="shrink-0 text-[var(--fg-muted)]">{icon}</div>}
      </div>
      <div className="font-display mt-2 text-2xl font-extrabold tracking-tight tabular-nums text-[var(--fg-primary)]">
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      {subtext && (
        <div className="mt-1 text-xs leading-snug text-[var(--fg-secondary)]">
          {subtext}
        </div>
      )}
    </div>
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
  const [periodDays, setPeriodDays] = useState<number>(
    initialData.periodDays || 90
  );
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>(
    initialData.selectedCustomerConnectionId ?? ''
  );
  const [selectedListId, setSelectedListId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [bannerMsg, setBannerMsg] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);
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
          ...(selectedConnectionId &&
          (action === 'FULL_SYNC' || action === 'ANALYZE_HYGIENE')
            ? { customerConnectionId: selectedConnectionId }
            : {}),
        }),
      });
      const json = (await res.json()) as {
        error?: string;
        job?: { id: string };
      };
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
  const totalSubs = Math.max(1, k.totalSubscribers);
  const strongPct = Math.round((k.engagedStrong / totalSubs) * 100);
  const openOnlyPct = Math.round((k.engagedOpenOnly / totalSubs) * 100);
  const inactivePct = Math.round(
    (k.potentiallyInactiveSubscribers / totalSubs) * 100
  );
  const insufficientPct = Math.round(
    ((k.insufficientHistorySubscribers + k.unknownHistorySubscribers) /
      totalSubs) *
      100
  );

  return (
    <AppShell
      adminEmail={adminEmail}
      csrfToken={csrfToken}
      isDemoMode={data.isDemoMode}
      phase1ReadOnly={data.phase1ReadOnly}
    >
      <div className="space-y-6">
        {/* Top Command Header & Scope Controls */}
        <div className="flex flex-col justify-between gap-4 border-b border-[var(--border-subtle)] pb-5 lg:flex-row lg:items-center">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="font-display inline-flex items-center gap-1.5 rounded-md border border-[var(--accent-border)] bg-[var(--accent-bg)] px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider text-[var(--accent-fg)]">
                <Activity className="h-3.5 w-3.5" />
                Agent Command Center
              </span>
              <span className="text-xs font-medium text-[var(--fg-secondary)]">
                Timezone:{' '}
                <strong className="text-[var(--fg-primary)]">
                  {data.timezone}
                </strong>
              </span>
            </div>
            <h1 className="font-display mt-2 text-2xl font-extrabold tracking-tight text-[var(--fg-primary)]">
              Deliverability &amp; List Hygiene Overview
            </h1>
            <p className="mt-1 text-sm text-[var(--fg-secondary)]">
              Engagement lookback window:{' '}
              <strong className="text-[var(--fg-primary)]">
                {data.lookbackDays} days
              </strong>{' '}
              • Minimum delivered campaigns before inactive classification:{' '}
              <strong className="text-[var(--fg-primary)]">
                {data.minDeliveredCampaigns}
              </strong>
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
                className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-1.5 text-xs font-semibold text-[var(--fg-primary)]"
              >
                <option value="">
                  Global Overview (All {data.customerAccounts?.length ?? 0}{' '}
                  Accounts)
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
              className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-1.5 text-xs font-semibold text-[var(--fg-primary)]"
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
              className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-1.5 text-xs font-semibold text-[var(--fg-primary)]"
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
              <Sparkles className="h-3.5 w-3.5 text-[var(--accent-fg)]" />
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
              <RefreshCw
                className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`}
              />
              Sync MailWizz
            </Button>

            <a
              href={`/api/exports/subscribers?format=csv&encrypted=true${
                selectedConnectionId ||
                ((data.customerAccounts?.length ?? 0) > 1
                  ? data.customerAccounts?.[0]?.id
                  : '')
                  ? `&customerConnectionId=${encodeURIComponent(
                      selectedConnectionId ||
                        data.customerAccounts?.[0]?.id ||
                        ''
                    )}`
                  : ''
              }${selectedListId ? `&listId=${encodeURIComponent(selectedListId)}` : ''}`}
              className="font-display inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-1.5 text-xs font-bold text-[var(--fg-primary)] transition-colors hover:bg-[var(--bg-elevated)]"
            >
              <Download className="h-3.5 w-3.5 text-[var(--accent-fg)]" />
              Encrypted Export
            </a>
          </div>
        </div>

        {/* Autonomous Agent Workflow Pipeline Strip */}
        <AgentWorkflowStrip
          activeStage="analyze"
          phase1ReadOnly={data.phase1ReadOnly}
        />

        {/* Connection / Action Alerts */}
        {!data.connectionConfigured && (
          <Card className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-start gap-3.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-500">
                  <Database className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="font-display text-base font-bold text-[var(--fg-primary)]">
                    Live MailWizz 3.0.5 Connection Not Configured Yet
                  </h2>
                  <p className="mt-0.5 text-xs leading-relaxed text-[var(--fg-secondary)]">
                    No live MailWizz instance is accessed until you provide your
                    API URL and <code>X-Api-Key</code> in Customer Connections
                    or Settings. You can evaluate the full agent pipeline using
                    synthetic demo fixtures.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2.5">
                {!data.isDemoMode ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => triggerSyncAction('SEED_DEMO_DATA')}
                    disabled={loading}
                  >
                    <FlaskConical className="h-3.5 w-3.5 text-amber-500" />
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
                  className="font-display inline-flex items-center gap-1.5 rounded-lg bg-[var(--fg-primary)] px-3.5 py-1.5 text-xs font-bold text-[var(--bg-canvas)] hover:opacity-90"
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
            className={`rounded-lg border px-4 py-3 text-xs font-semibold ${
              bannerMsg.type === 'ok'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                : 'border-rose-200 bg-rose-50 text-rose-900'
            }`}
          >
            {bannerMsg.text}
          </div>
        )}

        {/* A. Multi-Customer Account Health & Operational Posture */}
        {(data.customerAccounts?.length ?? 0) > 0 && (
          <section
            aria-label="Customer accounts overview"
            data-testid="customer-accounts-overview"
          >
            <Card className="overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-well)] px-5 py-3">
                <div className="flex items-center gap-2.5">
                  <StatusDot tone="emerald" />
                  <h2 className="font-display text-sm font-bold text-[var(--fg-primary)]">
                    {selectedConnectionId
                      ? 'Active Customer Account Scope'
                      : `Connected Customer Accounts (${data.customerAccounts?.length ?? 0})`}
                  </h2>
                  {selectedConnectionId && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedConnectionId('');
                        setSelectedListId('');
                        void refresh(periodDays, '', '');
                      }}
                      className="font-display text-xs font-bold text-[var(--accent-fg)] hover:underline"
                    >
                      Show All Customers
                    </button>
                  )}
                </div>
                <Link
                  href="/connections"
                  className="font-display text-xs font-bold text-[var(--accent-fg)] hover:underline"
                >
                  Manage Customer Connections &rarr;
                </Link>
              </div>
              <div className="grid grid-cols-1 gap-3.5 p-5 md:grid-cols-2 lg:grid-cols-3">
                {data.customerAccounts?.map((acct) => {
                  const active = selectedConnectionId === acct.id;
                  return (
                    <div
                      key={acct.id}
                      className={`rounded-xl border p-4 text-xs transition-colors ${
                        active
                          ? 'border-[var(--accent-border)] bg-[var(--accent-bg)]'
                          : 'border-[var(--border-default)] bg-[var(--bg-well)] hover:border-[var(--border-strong)]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-display truncate text-sm font-bold text-[var(--fg-primary)]">
                          {acct.customerName}
                        </div>
                        <Badge
                          dot
                          tone={
                            acct.status === 'CONNECTED'
                              ? 'emerald'
                              : acct.status === 'AUTH_FAILED' ||
                                  acct.status === 'ERROR'
                                ? 'rose'
                                : acct.isQuarantine
                                  ? 'amber'
                                  : 'slate'
                          }
                        >
                          {acct.isQuarantine ? 'QUARANTINED' : acct.status}
                        </Badge>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 text-xs text-[var(--fg-secondary)]">
                        <span>{acct.hostname}</span>
                        <span>
                          Key: <code>{acct.apiKeyMasked ?? 'none'}</code>
                        </span>
                        {acct.isPaused && (
                          <span className="font-bold text-amber-500">
                            Paused
                          </span>
                        )}
                      </div>
                      <div className="mt-3 flex items-center justify-between border-t border-[var(--border-subtle)] pt-2.5 text-xs text-[var(--fg-secondary)]">
                        <span className="tabular-nums">
                          <strong className="text-[var(--fg-primary)]">
                            {acct.listsCount}
                          </strong>{' '}
                          lists •{' '}
                          <strong className="text-[var(--fg-primary)]">
                            {acct.subscribersCount.toLocaleString()}
                          </strong>{' '}
                          subscribers
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedConnectionId(acct.id);
                            setSelectedListId('');
                            void refresh(periodDays, '', acct.id);
                          }}
                          className="font-display font-bold text-[var(--accent-fg)] hover:underline"
                        >
                          {active ? 'Active Scope' : 'Inspect Account'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </section>
        )}

        {/* B. Unified Subscriber Intelligence Telemetry Matrix */}
        <section aria-label="Subscriber and hygiene KPIs">
          <Card className="overflow-hidden">
            {/* Matrix Header + Distribution Bar */}
            <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-well)] px-5 py-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="font-display text-sm font-bold text-[var(--fg-primary)]">
                  Audience Hygiene Distribution (
                  {k.totalSubscribers.toLocaleString()} Total Subscribers)
                </div>
                <div className="flex flex-wrap items-center gap-4 text-xs font-semibold text-[var(--fg-secondary)]">
                  <span className="flex items-center gap-1.5">
                    <StatusDot tone="emerald" />
                    Strong ({strongPct}%)
                  </span>
                  <span className="flex items-center gap-1.5">
                    <StatusDot tone="teal" />
                    Open-Only ({openOnlyPct}%)
                  </span>
                  <span className="flex items-center gap-1.5">
                    <StatusDot tone="amber" />
                    Inactive ({inactivePct}%)
                  </span>
                  <span className="flex items-center gap-1.5">
                    <StatusDot tone="sky" />
                    Insufficient / Unknown ({insufficientPct}%)
                  </span>
                </div>
              </div>
              <div className="mt-2.5 flex h-2 w-full overflow-hidden rounded-full bg-[var(--bg-elevated)]">
                <div
                  className="bg-emerald-500 transition-all"
                  style={{ width: `${strongPct}%` }}
                  title={`Strong Engagement: ${k.engagedStrong.toLocaleString()}`}
                />
                <div
                  className="bg-teal-500 transition-all"
                  style={{ width: `${openOnlyPct}%` }}
                  title={`Open-Only Engagement: ${k.engagedOpenOnly.toLocaleString()}`}
                />
                <div
                  className="bg-amber-500 transition-all"
                  style={{ width: `${inactivePct}%` }}
                  title={`Potentially Inactive: ${k.potentiallyInactiveSubscribers.toLocaleString()}`}
                />
                <div
                  className="bg-sky-500 transition-all"
                  style={{ width: `${insufficientPct}%` }}
                  title="Insufficient / Unknown History"
                />
              </div>
            </div>

            {/* Unified 12-Cell Hairline Telemetry Grid */}
            <div className="grid grid-cols-1 divide-x divide-y divide-[var(--border-subtle)] sm:grid-cols-2 lg:grid-cols-4">
              <TelemetryCell
                label="Total MailWizz Lists"
                value={k.totalLists}
                subtext="Auto-discovered via read-only API"
                tone="slate"
                icon={<Database className="h-4 w-4" />}
              />
              <TelemetryCell
                label="Total Subscribers"
                value={k.totalSubscribers}
                subtext={`${k.confirmedSubscribers.toLocaleString()} confirmed • ${k.unconfirmedSubscribers.toLocaleString()} unconfirmed`}
                tone="indigo"
                icon={<Users className="h-4 w-4" />}
              />
              <TelemetryCell
                label="Recently Engaged (Total)"
                value={k.recentlyEngagedTotal}
                subtext={`${k.engagedStrong.toLocaleString()} strong (clicks/replies) • ${k.engagedOpenOnly.toLocaleString()} open-only`}
                tone="emerald"
                icon={<CheckCircle2 className="h-4 w-4" />}
              />
              <TelemetryCell
                label="Potentially Inactive"
                value={k.potentiallyInactiveSubscribers}
                subtext={`Verified >= ${data.minDeliveredCampaigns} delivered campaigns & 0 engagement`}
                tone="amber"
                icon={<AlertTriangle className="h-4 w-4" />}
              />

              <TelemetryCell
                label="Strong Engagement (Click+)"
                value={k.engagedStrong}
                subtext="Verified click, reply, or conversion in lookback"
                tone="emerald"
              />
              <TelemetryCell
                label="Open-Only Engagement"
                value={k.engagedOpenOnly}
                subtext="Tracked separately (open pixel/MPP caveat)"
                tone="teal"
              />
              <TelemetryCell
                label="Insufficient History"
                value={k.insufficientHistorySubscribers}
                subtext={`Fewer than ${data.minDeliveredCampaigns} delivered campaigns`}
                tone="sky"
              />
              <TelemetryCell
                label="UNKNOWN History"
                value={k.unknownHistorySubscribers}
                subtext="Inactivity decisions disabled (needs Priority B/C/D)"
                tone="slate"
                icon={<HelpCircle className="h-4 w-4" />}
              />

              <TelemetryCell
                label="Already Unsubscribed"
                value={k.unsubscribedSubscribers}
                subtext={`${k.blacklistedSubscribers.toLocaleString()} blacklisted`}
                tone="slate"
              />
              <TelemetryCell
                label="Hard-Bounced Contacts"
                value={k.hardBouncedSubscribers}
                subtext="From MailWizz campaign bounce logs"
                tone="rose"
                icon={<XCircle className="h-4 w-4" />}
              />
              <TelemetryCell
                label="Spam Complaints"
                value={k.complainedSubscribers}
                subtext={`Campaign aggregate complaints: ${k.totalComplaints}`}
                tone="rose"
                icon={<ShieldAlert className="h-4 w-4" />}
              />
              <TelemetryCell
                label="Excluded (Protected)"
                value={k.excludedSubscribers}
                subtext="VIP domains, protected sources, or recent grace window"
                tone="indigo"
              />
            </div>
          </Card>
        </section>

        {/* C. Campaign Delivery Telemetry & Agent Action Launchpad */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          <section
            aria-label="Campaign delivery and engagement metrics"
            className="lg:col-span-7"
          >
            <Card className="h-full overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-well)] px-5 py-3">
                <h2 className="font-display flex items-center gap-2 text-sm font-bold text-[var(--fg-primary)]">
                  <Mail className="h-4 w-4 text-[var(--accent-fg)]" />
                  Campaign Delivery &amp; Engagement ({periodDays}-Day Window)
                </h2>
                <span className="text-xs text-[var(--fg-secondary)]">
                  <code>GET /campaigns/&#123;uid&#125;/stats</code>
                </span>
              </div>
              <div className="grid grid-cols-2 divide-x divide-y divide-[var(--border-subtle)] sm:grid-cols-3">
                <div className="p-4">
                  <div className="text-xs font-medium text-[var(--fg-secondary)]">
                    Campaigns Sent
                  </div>
                  <div className="font-display mt-1 text-xl font-extrabold tabular-nums text-[var(--fg-primary)]">
                    {k.campaignsSentInPeriod.toLocaleString()}
                  </div>
                </div>
                <div className="p-4">
                  <div className="text-xs font-medium text-[var(--fg-secondary)]">
                    Delivery Success
                  </div>
                  <div className="font-display mt-1 text-xl font-extrabold tabular-nums text-[var(--accent-fg)]">
                    {k.totalDeliverySuccess.toLocaleString()}
                  </div>
                </div>
                <div className="p-4">
                  <div className="text-xs font-medium text-[var(--fg-secondary)]">
                    Unique Opens
                  </div>
                  <div className="font-display mt-1 text-xl font-extrabold tabular-nums text-[var(--fg-primary)]">
                    {k.totalUniqueOpens.toLocaleString()}
                  </div>
                </div>
                <div className="p-4">
                  <div className="text-xs font-medium text-[var(--fg-secondary)]">
                    Unique Clicks
                  </div>
                  <div className="font-display mt-1 text-xl font-extrabold tabular-nums text-[var(--fg-primary)]">
                    {k.totalUniqueClicks.toLocaleString()}
                  </div>
                </div>
                <div className="p-4">
                  <div className="text-xs font-medium text-[var(--fg-secondary)]">
                    Delivery Errors
                  </div>
                  <div className="font-display mt-1 text-xl font-extrabold tabular-nums text-rose-500">
                    {k.totalDeliveryErrors.toLocaleString()}
                  </div>
                </div>
                <div className="p-4">
                  <div className="text-xs font-medium text-[var(--fg-secondary)]">
                    Bounces (Hard / Soft)
                  </div>
                  <div className="font-display mt-1 text-xl font-extrabold tabular-nums text-amber-500">
                    {k.totalHardBounces.toLocaleString()} /{' '}
                    {k.totalSoftBounces.toLocaleString()}
                  </div>
                </div>
              </div>
            </Card>
          </section>

          <section
            aria-label="Agent action workspace shortcuts"
            className="lg:col-span-5"
          >
            <Card className="h-full overflow-hidden">
              <div className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-well)] px-5 py-3">
                <h2 className="font-display text-sm font-bold text-[var(--fg-primary)]">
                  Recommended Agent Operations
                </h2>
                <Badge tone="emerald" dot>
                  Guarded
                </Badge>
              </div>
              <div className="grid grid-cols-1 divide-x divide-y divide-[var(--border-subtle)] sm:grid-cols-2">
                <Link
                  href="/cleanup"
                  className="group flex flex-col justify-between p-4 transition-colors hover:bg-[var(--bg-well)]"
                >
                  <div className="flex items-center justify-between">
                    <Filter className="h-4 w-4 text-[var(--accent-fg)]" />
                    <ArrowRight className="h-4 w-4 text-[var(--fg-muted)] group-hover:text-[var(--fg-primary)]" />
                  </div>
                  <div className="font-display mt-2.5 text-sm font-bold text-[var(--fg-primary)]">
                    Dry-Run Cleanup
                  </div>
                  <div className="text-xs text-[var(--fg-secondary)]">
                    {k.potentiallyInactiveSubscribers.toLocaleString()} inactive
                    candidates
                  </div>
                </Link>

                <Link
                  href="/reengagement"
                  className="group flex flex-col justify-between p-4 transition-colors hover:bg-[var(--bg-well)]"
                >
                  <div className="flex items-center justify-between">
                    <MailCheck className="h-4 w-4 text-[var(--accent-fg)]" />
                    <ArrowRight className="h-4 w-4 text-[var(--fg-muted)] group-hover:text-[var(--fg-primary)]" />
                  </div>
                  <div className="font-display mt-2.5 text-sm font-bold text-[var(--fg-primary)]">
                    Permission Pass
                  </div>
                  <div className="text-xs text-[var(--fg-secondary)]">
                    Manual campaign approval
                  </div>
                </Link>

                <Link
                  href="/reports"
                  className="group flex flex-col justify-between p-4 transition-colors hover:bg-[var(--bg-well)]"
                >
                  <div className="flex items-center justify-between">
                    <BarChart3 className="h-4 w-4 text-[var(--accent-fg)]" />
                    <ArrowRight className="h-4 w-4 text-[var(--fg-muted)] group-hover:text-[var(--fg-primary)]" />
                  </div>
                  <div className="font-display mt-2.5 text-sm font-bold text-[var(--fg-primary)]">
                    Before/After Reports
                  </div>
                  <div className="text-xs text-[var(--fg-secondary)]">
                    8 verified CSV report views
                  </div>
                </Link>

                <Link
                  href="/compatibility"
                  className="group flex flex-col justify-between p-4 transition-colors hover:bg-[var(--bg-well)]"
                >
                  <div className="flex items-center justify-between">
                    <GitCompareArrows className="h-4 w-4 text-[var(--accent-fg)]" />
                    <ArrowRight className="h-4 w-4 text-[var(--fg-muted)] group-hover:text-[var(--fg-primary)]" />
                  </div>
                  <div className="font-display mt-2.5 text-sm font-bold text-[var(--fg-primary)]">
                    Adapter Contracts
                  </div>
                  <div className="text-xs text-[var(--fg-secondary)]">
                    15 read-only endpoint probes
                  </div>
                </Link>
              </div>
            </Card>
          </section>
        </div>

        {/* D. Detailed Operational Tabs */}
        <Tabs.Root defaultValue="lists" className="space-y-4">
          <Tabs.List
            aria-label="Dashboard sections"
            className="inline-flex flex-wrap gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-well)] p-1.5"
          >
            {[
              { id: 'lists', label: `Mailing Lists (${data.lists.length})` },
              {
                id: 'campaigns',
                label: `Campaigns (${data.campaigns.length})`,
              },
              { id: 'capabilities', label: 'MailWizz 3.0.5 API Matrix' },
              {
                id: 'jobs',
                label: `Jobs & Audit (${data.recentJobs.length})`,
              },
            ].map((tab) => (
              <Tabs.Trigger
                key={tab.id}
                value={tab.id}
                className="font-display rounded-lg px-3.5 py-2 text-xs font-bold text-[var(--fg-secondary)] transition-colors hover:text-[var(--fg-primary)] data-[state=active]:border data-[state=active]:border-[var(--accent-border)] data-[state=active]:bg-[var(--accent-bg)] data-[state=active]:text-[var(--fg-primary)]"
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
                  <thead className="font-display border-b border-[var(--border-subtle)] bg-[var(--bg-well)] text-xs font-bold uppercase tracking-wider text-[var(--fg-secondary)]">
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
                  <tbody className="divide-y divide-[var(--border-subtle)]">
                    {data.lists.length === 0 ? (
                      <tr>
                        <td
                          colSpan={8}
                          className="px-4 py-8 text-center text-sm text-[var(--fg-secondary)]"
                        >
                          No mailing lists synced yet. Connect MailWizz in
                          Settings or load synthetic demo data.
                        </td>
                      </tr>
                    ) : (
                      data.lists.map((list) => (
                        <tr
                          key={list.id}
                          className="transition-colors hover:bg-[var(--bg-well)]"
                        >
                          <td className="px-4 py-3.5">
                            <div className="font-display flex flex-wrap items-center gap-2 font-bold text-[var(--fg-primary)]">
                              <span>{list.name}</span>
                              {list.isDemoData && (
                                <Badge tone="amber">Demo</Badge>
                              )}
                              {list.customerConnection && (
                                <Badge tone="slate">
                                  {list.customerConnection.customerName}
                                </Badge>
                              )}
                            </div>
                            <div className="mt-0.5 text-xs text-[var(--fg-secondary)]">
                              UID: <code>{list.listUid}</code>
                            </div>
                          </td>
                          <td className="font-display px-4 py-3.5 text-right font-bold tabular-nums">
                            {list.syncedSubscriberCount.toLocaleString()}
                          </td>
                          <td className="font-display px-4 py-3.5 text-right font-bold tabular-nums text-[var(--accent-fg)]">
                            {list.confirmedCount.toLocaleString()}
                          </td>
                          <td className="px-4 py-3.5 text-right tabular-nums text-[var(--fg-secondary)]">
                            {list.unconfirmedCount.toLocaleString()}
                          </td>
                          <td className="px-4 py-3.5 text-right tabular-nums text-[var(--fg-secondary)]">
                            {list.unsubscribedCount.toLocaleString()}
                          </td>
                          <td className="px-4 py-3.5 text-right font-bold tabular-nums text-rose-500">
                            {list.hardBouncedCount.toLocaleString()}
                          </td>
                          <td className="px-4 py-3.5">
                            <Badge
                              dot
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
                          <td className="px-4 py-3.5 text-right">
                            <Link
                              href={`/lists/${list.id}`}
                              className="font-display inline-flex items-center gap-1 rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-1.5 text-xs font-bold text-[var(--fg-primary)] transition-colors hover:bg-[var(--bg-elevated)]"
                            >
                              Open List
                              <ArrowRight className="h-3.5 w-3.5" />
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
                  <thead className="font-display border-b border-[var(--border-subtle)] bg-[var(--bg-well)] text-xs font-bold uppercase tracking-wider text-[var(--fg-secondary)]">
                    <tr>
                      <th className="px-4 py-3">Campaign</th>
                      <th className="px-4 py-3">Sent Date</th>
                      <th className="px-4 py-3 text-right">Delivered</th>
                      <th className="px-4 py-3 text-right">Unique Opens</th>
                      <th className="px-4 py-3 text-right">Unique Clicks</th>
                      <th className="px-4 py-3 text-right">
                        Hard / Soft Bounces
                      </th>
                      <th className="px-4 py-3 text-right">Complaints</th>
                      <th className="px-4 py-3">Bounce Recon</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)]">
                    {data.campaigns.length === 0 ? (
                      <tr>
                        <td
                          colSpan={8}
                          className="px-4 py-8 text-center text-sm text-[var(--fg-secondary)]"
                        >
                          No campaigns found in selected period.
                        </td>
                      </tr>
                    ) : (
                      data.campaigns.map((camp) => (
                        <tr
                          key={camp.id}
                          className="transition-colors hover:bg-[var(--bg-well)]"
                        >
                          <td className="px-4 py-3.5">
                            <div className="font-display flex items-center gap-2 font-bold text-[var(--fg-primary)]">
                              <span>{camp.name}</span>
                              {camp.isDemoData && (
                                <Badge tone="amber">Demo</Badge>
                              )}
                            </div>
                            <div className="mt-0.5 text-xs text-[var(--fg-secondary)]">
                              UID: <code>{camp.campaignUid}</code> • Status:{' '}
                              {camp.status}
                            </div>
                          </td>
                          <td className="px-4 py-3.5 text-xs text-[var(--fg-secondary)]">
                            {camp.sendAt
                              ? new Date(camp.sendAt).toLocaleDateString()
                              : 'Not scheduled'}
                          </td>
                          <td className="px-4 py-3.5 text-right tabular-nums">
                            {camp.deliverySuccessCount.toLocaleString()}
                          </td>
                          <td className="px-4 py-3.5 text-right tabular-nums">
                            {camp.uniqueOpensCount.toLocaleString()} (
                            {camp.uniqueOpensRate}%)
                          </td>
                          <td className="px-4 py-3.5 text-right tabular-nums">
                            {camp.uniqueClicksCount.toLocaleString()} (
                            {camp.uniqueClicksRate}%)
                          </td>
                          <td className="px-4 py-3.5 text-right font-bold tabular-nums text-rose-500">
                            {camp.hardBouncesCount} / {camp.softBouncesCount}
                          </td>
                          <td className="px-4 py-3.5 text-right tabular-nums">
                            {camp.complaintsCount}
                          </td>
                          <td className="px-4 py-3.5">
                            <Badge
                              dot
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
              <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-well)] px-5 py-3.5">
                <h3 className="font-display text-base font-bold text-[var(--fg-primary)]">
                  MailWizz 3.0.5 API &amp; Historical Engagement Capability
                  Matrix
                </h3>
                <p className="mt-0.5 text-xs text-[var(--fg-secondary)]">
                  Tracks verified capabilities vs API gaps. Tracking endpoints (
                  <code>trackOpening</code>, <code>trackUrl</code>) are blocked
                  at transport level so false engagement data can never be
                  generated.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="font-display border-b border-[var(--border-subtle)] bg-[var(--bg-card)] text-xs font-bold uppercase tracking-wider text-[var(--fg-secondary)]">
                    <tr>
                      <th className="px-4 py-3">Category</th>
                      <th className="px-4 py-3">Endpoint / Feature</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">
                        Verification &amp; Technical Notes
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)]">
                    {data.capabilities.map((cap) => (
                      <tr
                        key={cap.id}
                        className="transition-colors hover:bg-[var(--bg-well)]"
                      >
                        <td className="font-display px-4 py-3.5 font-bold text-[var(--fg-primary)]">
                          {cap.category}
                        </td>
                        <td className="px-4 py-3.5 font-mono text-xs text-[var(--fg-secondary)]">
                          {cap.endpointOrFeature}
                        </td>
                        <td className="px-4 py-3.5">
                          <Badge
                            dot
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
                        <td className="px-4 py-3.5 text-xs leading-relaxed text-[var(--fg-secondary)]">
                          {cap.notes}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </Tabs.Content>

          {/* Jobs & Audit Tab */}
          <Tabs.Content value="jobs" className="space-y-4">
            <Card className="p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-display flex items-center gap-2 text-base font-bold text-[var(--fg-primary)]">
                    <Lock className="h-4 w-4 text-[var(--accent-fg)]" />
                    Phase 2 Mutation Gate Status
                  </h3>
                  <p className="mt-0.5 text-xs text-[var(--fg-secondary)]">
                    {data.phase1ReadOnly ? (
                      <>
                        <code>ENABLE_MAILWIZZ_MUTATIONS=false</code> — All
                        unsubscribe, segment creation, and subscriber move
                        interfaces are disabled in Phase 1.
                      </>
                    ) : (
                      <>
                        <code>ENABLE_MAILWIZZ_MUTATIONS=true</code> — Full
                        MailWizz hygiene operations are active with mandatory
                        dry-run previews and encrypted recovery snapshots.
                      </>
                    )}
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={testPhase2Gate}>
                  Verify Mutation Gate Block
                </Button>
              </div>
            </Card>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card className="overflow-hidden">
                <div className="font-display border-b border-[var(--border-subtle)] bg-[var(--bg-well)] px-5 py-3 text-sm font-bold text-[var(--fg-primary)]">
                  Recent Background Worker Jobs
                </div>
                <div className="divide-y divide-[var(--border-subtle)]">
                  {data.recentJobs.length === 0 ? (
                    <div className="p-5 text-xs text-[var(--fg-secondary)]">
                      No background jobs queued yet.
                    </div>
                  ) : (
                    data.recentJobs.map((job) => (
                      <div
                        key={job.id}
                        className="flex items-center justify-between px-5 py-3.5 text-xs"
                      >
                        <div>
                          <div className="font-display font-bold text-[var(--fg-primary)]">
                            {job.type}
                          </div>
                          <div className="mt-0.5 text-[var(--fg-secondary)]">
                            {job.progressMessage ?? 'Pending'} (
                            {job.progressCurrent}/{job.progressTotal})
                          </div>
                          {job.lastError && (
                            <div className="mt-0.5 text-rose-500">
                              {job.lastError}
                            </div>
                          )}
                        </div>
                        <Badge
                          dot
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
                <div className="font-display border-b border-[var(--border-subtle)] bg-[var(--bg-well)] px-5 py-3 text-sm font-bold text-[var(--fg-primary)]">
                  Administrative Audit Log (PII-Redacted)
                </div>
                <div className="divide-y divide-[var(--border-subtle)]">
                  {auditLogs.length === 0 ? (
                    <div className="p-5 text-xs text-[var(--fg-secondary)]">
                      No audit entries yet.
                    </div>
                  ) : (
                    auditLogs.slice(0, 10).map((log) => (
                      <div
                        key={log.id}
                        className="flex items-center justify-between px-5 py-3 text-xs"
                      >
                        <div>
                          <div className="font-display font-bold text-[var(--fg-primary)]">
                            {log.action}{' '}
                            <span className="font-normal text-[var(--fg-secondary)]">
                              ({log.resourceType})
                            </span>
                          </div>
                          <div className="mt-0.5 text-[var(--fg-secondary)]">
                            {log.actorEmail} •{' '}
                            {new Date(log.createdAt).toLocaleString()}
                          </div>
                        </div>
                        <Badge
                          dot
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
