'use client';

import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CloudDownload,
  Globe,
  Info,
  Mail,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import { AppShell } from './AppShell';
import {
  AgentWorkflowStrip,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  StatusDot,
} from './ui';

export interface DeliverabilityPayload {
  generatedAt: string;
  isDemoMode: boolean;
  hasAlibabaCreds: boolean;
  alibabaRegion: string;
  alibabaAccountStatus: string | null;
  alibabaLastSyncedAt: string | null;
  hasGooglePostmasterToken: boolean;
  googlePostmasterDomain: string;
  kpis: {
    sourceLabel: string;
    campaignsCount: number;
    processedCount: number;
    smtpAcceptedCount: number;
    smtpAcceptanceRatePct: number;
    deliveryFailuresCount: number;
    deliveryFailureRatePct: number;
    hardBouncesCount: number;
    softBouncesCount: number;
    bounceRatePct: number;
    complaintsCount: number;
    complaintRatePct: number;
    uniqueOpensCount: number;
    openRatePct: number;
    uniqueClicksCount: number;
    clickThroughRatePct: number;
    unsubscribesCount: number;
    unsubscribeRatePct: number;
    acceptanceCaveat: string;
  };
  campaignHistory: Array<{
    id: string;
    campaignUid: string;
    name: string;
    listName: string;
    sendAt: string | null;
    processedCount: number;
    smtpAcceptedCount: number;
    deliveryFailuresCount: number;
    hardBouncesCount: number;
    softBouncesCount: number;
    complaintsCount: number;
    uniqueOpensCount: number;
    openRatePct: number;
    uniqueClicksCount: number;
    ctrPct: number;
    unsubscribesCount: number;
    unsubRatePct: number;
    sourceLabel: string;
  }>;
  listPerformance: Array<{
    listId: string;
    listName: string;
    campaigns: number;
    processed: number;
    accepted: number;
    failures: number;
    hardBounces: number;
    softBounces: number;
    complaints: number;
    uniqueOpens: number;
    uniqueClicks: number;
    unsubscribes: number;
    openRatePct: number;
    ctrPct: number;
    unsubRatePct: number;
    engagementBreakdown: Record<string, number>;
  }>;
  campaignTrends: Array<{
    label: string;
    date: string;
    volume: number;
    openRatePct: number;
    clickRatePct: number;
    bounceRatePct: number;
    complaintRatePct: number;
    source: string;
  }>;
  engagementByRecipientDomain: Array<{
    domain: string;
    total: number;
    active: number;
    cooling: number;
    inactive: number;
    hardBounced: number;
    complained: number;
    totalClicks: number;
    activeRatePct: number;
    inactiveRatePct: number;
    bounceRatePct: number;
  }>;
  beforeAfterCleaning: {
    baselineConfirmedRecipients: number;
    alreadySuppressedCount: number;
    recommendedSuppressionCount: number;
    projectedCleanAudience: number;
    projectedVolumeReductionPct: number;
    sourceLabel: string;
  };
  alibabaMetrics: Array<{
    id: string;
    date: string;
    domainName: string;
    source: 'ALIBABA_API' | 'ALIBABA_CSV_IMPORT' | 'SYNTHETIC_DEMO';
    requestsCount: number;
    deliveredCount: number;
    failedCount: number;
    invalidAddressCount: number;
    complaintCount: number | null;
    accountStatus: string | null;
    notes: string | null;
  }>;
  dnsChecks: Array<{
    id: string;
    domain: string;
    fromDomain: string | null;
    trackingDomain: string | null;
    dkimSelector: string | null;
    spfStatus: 'PASS' | 'WARN' | 'FAIL' | 'UNKNOWN';
    spfRecord: string | null;
    spfDetail: string;
    dkimStatus: 'PASS' | 'WARN' | 'FAIL' | 'UNKNOWN';
    dkimRecord: string | null;
    dkimDetail: string;
    dmarcStatus: 'PASS' | 'WARN' | 'FAIL' | 'UNKNOWN';
    dmarcPolicy: string | null;
    dmarcAlignmentOk: boolean | null;
    dmarcRecord: string | null;
    dmarcDetail: string;
    mxStatus: 'PASS' | 'WARN' | 'FAIL' | 'UNKNOWN';
    mxRecordsJson: unknown;
    trackingStatus: 'PASS' | 'WARN' | 'FAIL' | 'UNKNOWN';
    trackingDetail: string;
    recommendationsJson: unknown;
    checkedByEmail: string;
    checkedAt: string;
  }>;
  inboxTests: Array<{
    id: string;
    testDomain: string;
    sendingProvider: string;
    campaignUid: string | null;
    recipientProvider: 'GMAIL' | 'OUTLOOK' | 'YAHOO' | 'OTHER';
    customProviderName: string | null;
    testedAt: string;
    placement: 'PRIMARY' | 'PROMOTIONS' | 'OTHER' | 'SPAM' | 'MISSING';
    spfPass: boolean | null;
    dkimPass: boolean | null;
    dmarcPass: boolean | null;
    postmasterReputation: string | null;
    notes: string | null;
    recordedByEmail: string;
    isDemoData: boolean;
  }>;
  postmasterStats: Array<{
    id: string;
    domain: string;
    statDate: string;
    domainReputation: string | null;
    userReportedSpamRatio: number | null;
    dkimSuccessRatio: number | null;
    dmarcSuccessRatio: number | null;
    spfSuccessRatio: number | null;
    inboundEncryptionRatio: number | null;
    source: string;
    notes: string | null;
    isDemoData: boolean;
  }>;
}

function dnsTone(status: 'PASS' | 'WARN' | 'FAIL' | 'UNKNOWN') {
  if (status === 'PASS') return 'emerald';
  if (status === 'WARN') return 'amber';
  if (status === 'FAIL') return 'rose';
  return 'slate';
}

function placementTone(placement: string) {
  if (placement === 'PRIMARY') return 'emerald';
  if (placement === 'PROMOTIONS' || placement === 'OTHER') return 'amber';
  return 'rose';
}

export function DeliverabilityView({
  adminEmail,
  csrfToken,
  isDemoMode,
  phase1ReadOnly,
  alibabaKeyLast4,
  initialData,
}: {
  adminEmail: string;
  csrfToken: string;
  isDemoMode: boolean;
  phase1ReadOnly: boolean;
  alibabaKeyLast4: string | null;
  initialData: DeliverabilityPayload;
}) {
  const [data, setData] = useState<DeliverabilityPayload>(initialData);
  const [selectedDays, setSelectedDays] = useState<string>('365');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [activeTab, setActiveTab] = useState<
    'ALL' | 'TRENDS' | 'DNS' | 'ALIBABA' | 'SEED'
  >('ALL');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);

  // Domain Auth form state
  const [dnsDomain, setDnsDomain] = useState('');
  const [dnsFromDomain, setDnsFromDomain] = useState('');
  const [dnsTrackingDomain, setDnsTrackingDomain] = useState('');
  const [dnsSelector, setDnsSelector] = useState('');

  // Alibaba form state
  const [aliAccessKeyId, setAliAccessKeyId] = useState('');
  const [aliAccessKeySecret, setAliAccessKeySecret] = useState('');
  const [aliRegion, setAliRegion] = useState(
    initialData.alibabaRegion || 'ap-southeast-1'
  );
  const [aliCsv, setAliCsv] = useState('');

  // Seed placement form state
  const [seedDomain, setSeedDomain] = useState('');
  const [seedProvider, setSeedProvider] = useState<
    'GMAIL' | 'OUTLOOK' | 'YAHOO' | 'OTHER'
  >('GMAIL');
  const [seedCustomProvider, setSeedCustomProvider] = useState('');
  const [seedCampaignUid, setSeedCampaignUid] = useState('');
  const [seedPlacement, setSeedPlacement] = useState<
    'PRIMARY' | 'PROMOTIONS' | 'OTHER' | 'SPAM' | 'MISSING'
  >('PRIMARY');
  const [seedTestedAt, setSeedTestedAt] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [seedSpfPass, setSeedSpfPass] = useState(true);
  const [seedDkimPass, setSeedDkimPass] = useState(true);
  const [seedDmarcPass, setSeedDmarcPass] = useState(true);
  const [seedReputation, setSeedReputation] = useState('');
  const [seedNotes, setSeedNotes] = useState('');

  // Postmaster form state
  const [pmDomain, setPmDomain] = useState(
    initialData.googlePostmasterDomain || ''
  );
  const [pmToken, setPmToken] = useState('');
  const [pmStatDate, setPmStatDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [pmRep, setPmRep] = useState<
    'HIGH' | 'MEDIUM' | 'LOW' | 'BAD' | 'UNKNOWN'
  >('HIGH');
  const [pmSpamRatio, setPmSpamRatio] = useState('0.001');
  const [pmDkimRatio, setPmDkimRatio] = useState('0.99');
  const [pmDmarcRatio, setPmDmarcRatio] = useState('0.99');
  const [pmSpfRatio, setPmSpfRatio] = useState('0.99');
  const [pmNotes, setPmNotes] = useState('');

  async function reloadDeliverability(
    daysOverride?: string,
    startOverride?: string,
    endOverride?: string
  ) {
    setBusy(true);
    try {
      const qs = new URLSearchParams();
      const d = daysOverride ?? selectedDays;
      qs.set('days', d);
      const st = startOverride ?? customStart;
      const en = endOverride ?? customEnd;
      if (st) qs.set('startDate', st);
      if (en) qs.set('endDate', en);

      const res = await fetch(`/api/deliverability?${qs.toString()}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      const next = (await res.json()) as DeliverabilityPayload;
      setData(next);
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to refresh metrics',
      });
    } finally {
      setBusy(false);
    }
  }

  async function runDnsCheck(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/deliverability/dns', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({
          domain: dnsDomain,
          fromDomain: dnsFromDomain,
          trackingDomain: dnsTrackingDomain,
          dkimSelector: dnsSelector,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'DNS check failed');
      setFeedback({
        type: 'ok',
        text: `Read-only DNS authentication check saved for ${json.check.domain}.`,
      });
      await reloadDeliverability();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'DNS check error',
      });
    } finally {
      setBusy(false);
    }
  }

  async function submitAlibabaAction(
    payload: Record<string, unknown>,
    msg: string
  ) {
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/deliverability/alibaba', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok)
        throw new Error(json.error || 'Alibaba DirectMail request failed');
      setFeedback({ type: 'ok', text: msg });
      setAliAccessKeyId('');
      setAliAccessKeySecret('');
      await reloadDeliverability();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Alibaba action failed',
      });
    } finally {
      setBusy(false);
    }
  }

  async function submitSeedAction(
    payload: Record<string, unknown>,
    msg: string
  ) {
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/deliverability/seed-tests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok)
        throw new Error(json.error || 'Seed/Postmaster request failed');
      setFeedback({ type: 'ok', text: msg });
      await reloadDeliverability();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Seed/Postmaster error',
      });
    } finally {
      setBusy(false);
    }
  }

  const alibabaTotals = data.alibabaMetrics.reduce(
    (acc, m) => {
      acc.requests += m.requestsCount;
      acc.delivered += m.deliveredCount;
      acc.failed += m.failedCount;
      acc.invalid += m.invalidAddressCount;
      acc.complaints += m.complaintCount ?? 0;
      return acc;
    },
    { requests: 0, delivered: 0, failed: 0, invalid: 0, complaints: 0 }
  );

  const showSection = (sec: 'TRENDS' | 'DNS' | 'ALIBABA' | 'SEED') =>
    activeTab === 'ALL' || activeTab === sec;

  // Chart calculations for SVG charts (MailWizz campaign trends)
  const trends = data.campaignTrends;
  const maxVol = Math.max(1, ...trends.map((t) => t.volume));

  return (
    <AppShell
      adminEmail={adminEmail}
      csrfToken={csrfToken}
      isDemoMode={isDemoMode}
      phase1ReadOnly={phase1ReadOnly}
    >
      <div className="space-y-6">
        {/* Header & Date Controls */}
        <div className="flex flex-col justify-between gap-4 border-b border-slate-200/80 pb-5 md:flex-row md:items-center">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-display inline-flex items-center gap-1.5 rounded-md border border-[var(--accent-border)] bg-[var(--accent-bg)] px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider text-[var(--accent-fg)]">
                <Globe className="h-3.5 w-3.5" />
                Deliverability &amp; DNS Intelligence
              </span>
            </div>
            <h1 className="font-display mt-2 text-2xl font-extrabold tracking-tight text-slate-900">
              Email Deliverability Diagnostics
            </h1>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-600">
              Source-separated diagnostics for MailWizz 3.0.5, Alibaba Cloud
              DirectMail SMTP/API, public DNS authentication, and controlled
              seed inbox placement tests.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {(['30', '60', '90', '180', '365', 'ALL'] as const).map((d) => (
              <Button
                key={d}
                variant={
                  selectedDays === d && !customStart ? 'primary' : 'outline'
                }
                size="sm"
                disabled={busy}
                onClick={() => {
                  setSelectedDays(d);
                  setCustomStart('');
                  setCustomEnd('');
                  void reloadDeliverability(d, '', '');
                }}
              >
                {d === 'ALL' ? 'All Time' : `${d}d`}
              </Button>
            ))}
            <input
              type="date"
              aria-label="Custom start date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs"
            />
            <input
              type="date"
              aria-label="Custom end date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs"
            />
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void reloadDeliverability()}
            >
              <RefreshCw
                className={`mr-1 h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`}
              />
              Apply
            </Button>
          </div>
        </div>

        <AgentWorkflowStrip
          activeStage="verify"
          phase1ReadOnly={phase1ReadOnly}
        />

        {/* Truthfulness Pipeline Disclaimer */}
        <Card className="bg-slate-50/70 p-4 text-xs text-slate-700">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div className="space-y-1">
              <p className="font-semibold text-slate-900">
                Critical Measurement Distinction: SMTP Acceptance vs. Delivery
                vs. Inbox Placement
              </p>
              <p className="leading-relaxed text-slate-600">
                1){' '}
                <strong>
                  MailWizz Processed / Alibaba SMTP Acceptance:
                </strong>{' '}
                Confirms Alibaba DirectMail or the receiving MTA accepted the
                SMTP transaction — it <strong>never guarantees</strong>{' '}
                recipient inbox placement. 2){' '}
                <strong>Receiving Server Delivery:</strong> Measured via
                hard/soft bounces and invalid-address rejections. 3){' '}
                <strong>Inbox Placement (Primary vs. Spam):</strong> Observable{' '}
                <em>only</em> in controlled test seed mailboxes you inspect or
                aggregate Google Postmaster domain signals — arbitrary
                subscriber folders cannot be read.
              </p>
            </div>
          </div>
        </Card>

        {feedback && (
          <div
            role="status"
            className={`rounded-lg border px-4 py-2.5 text-xs font-medium ${
              feedback.type === 'ok'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                : 'border-rose-200 bg-rose-50 text-rose-900'
            }`}
          >
            {feedback.text}
          </div>
        )}

        {/* Section Focus Selector */}
        <div className="inline-flex flex-wrap gap-1 rounded-xl border border-slate-200/90 bg-white p-1 shadow-2xs">
          {(
            [
              ['ALL', 'All Sections'],
              ['TRENDS', 'KPIs & Trend Charts'],
              ['DNS', 'Domain Auth (SPF/DKIM/DMARC)'],
              ['ALIBABA', 'Alibaba DirectMail'],
              ['SEED', 'Gmail / Seed Inbox & Postmaster'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === id
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* SECTION 1 & 5: KPIs + TREND CHARTS + CAMPAIGN/LIST HISTORY */}
        {showSection('TRENDS') && (
          <div className="space-y-6">
            {/* Primary KPI Grid */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardContent className="pt-5">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                      <StatusDot tone="sky" />
                      Emails Processed ({data.kpis.campaignsCount} campaigns)
                    </span>
                    <Badge tone="sky">{data.kpis.sourceLabel}</Badge>
                  </div>
                  <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-900">
                    {data.kpis.processedCount.toLocaleString()}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    SMTP Accepted:{' '}
                    {data.kpis.smtpAcceptedCount.toLocaleString()} (
                    {data.kpis.smtpAcceptanceRatePct}%)
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-5">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                      <StatusDot tone="amber" />
                      Delivery Failures &amp; Bounces
                    </span>
                    <Badge tone="amber">MailWizz Bounces</Badge>
                  </div>
                  <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-900">
                    {data.kpis.bounceRatePct}%
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Hard: {data.kpis.hardBouncesCount.toLocaleString()} · Soft:{' '}
                    {data.kpis.softBouncesCount.toLocaleString()} · Errors:{' '}
                    {data.kpis.deliveryFailuresCount.toLocaleString()}
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-5">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                      <StatusDot tone="emerald" />
                      Tracked Opens &amp; Clicks (CTR)
                    </span>
                    <Badge tone="emerald">Engagement</Badge>
                  </div>
                  <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-900">
                    {data.kpis.openRatePct}% / {data.kpis.clickThroughRatePct}%
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Unique Opens: {data.kpis.uniqueOpensCount.toLocaleString()}{' '}
                    · Clicks: {data.kpis.uniqueClicksCount.toLocaleString()}
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-5">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                      <StatusDot tone="rose" />
                      Complaints &amp; Unsubscribes
                    </span>
                    <Badge tone="rose">Reputation Signals</Badge>
                  </div>
                  <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-900">
                    {data.kpis.complaintRatePct}% /{' '}
                    {data.kpis.unsubscribeRatePct}%
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Complaints: {data.kpis.complaintsCount.toLocaleString()} ·
                    Unsubs: {data.kpis.unsubscribesCount.toLocaleString()}
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Dual SVG Trend Charts */}
            <div className="grid gap-6 lg:grid-cols-2">
              {/* Chart A: Volume vs Open Rate & Click Rate */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle>
                      Sending Volume vs. Open Rate &amp; Click Rate
                    </CardTitle>
                    <Badge tone={isDemoMode ? 'amber' : 'sky'}>
                      {isDemoMode ? 'Demo (MailWizz)' : 'MailWizz API'}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  {trends.length === 0 ? (
                    <p className="text-xs text-slate-500">
                      No campaign statistics found in the selected date window.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      <svg
                        viewBox="0 0 600 200"
                        className="h-52 w-full rounded-lg border border-slate-100 bg-slate-50/50 p-2"
                        role="img"
                        aria-label="Chart comparing campaign sending volume bars against open rate and click rate lines"
                      >
                        {trends.map((pt, i) => {
                          const xStep = 560 / Math.max(1, trends.length);
                          const barW = Math.max(
                            8,
                            Math.min(28, xStep * 0.55)
                          );
                          const x = 25 + i * xStep;
                          const barH = (pt.volume / maxVol) * 140;
                          return (
                            <g key={`${pt.date}-${i}`}>
                              <rect
                                x={x}
                                y={165 - barH}
                                width={barW}
                                height={barH}
                                fill="#cbd5e1"
                                rx={3}
                              >
                                <title>{`${pt.label} (${pt.date}): ${pt.volume} processed, Open ${pt.openRatePct}%, CTR ${pt.clickRatePct}%`}</title>
                              </rect>
                              <text
                                x={x + barW / 2}
                                y={185}
                                fontSize="9"
                                textAnchor="middle"
                                fill="#475569"
                              >
                                {pt.date.slice(5)}
                              </text>
                            </g>
                          );
                        })}
                        {trends.length > 1 && (
                          <>
                            <polyline
                              fill="none"
                              stroke="#059669"
                              strokeWidth="2.5"
                              points={trends
                                .map((pt, i) => {
                                  const xStep =
                                    560 / Math.max(1, trends.length);
                                  const x = 25 + i * xStep + 10;
                                  const y =
                                    165 -
                                    Math.min(100, pt.openRatePct) * 1.4;
                                  return `${x},${y}`;
                                })
                                .join(' ')}
                            />
                            <polyline
                              fill="none"
                              stroke="#4f46e5"
                              strokeWidth="2.5"
                              points={trends
                                .map((pt, i) => {
                                  const xStep =
                                    560 / Math.max(1, trends.length);
                                  const x = 25 + i * xStep + 10;
                                  const y =
                                    165 -
                                    Math.min(100, pt.clickRatePct * 4) * 1.4;
                                  return `${x},${y}`;
                                })
                                .join(' ')}
                            />
                          </>
                        )}
                      </svg>
                      <div className="flex flex-wrap gap-4 text-xs text-slate-600">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-2.5 w-2.5 rounded-sm bg-slate-300" />
                          Processed Volume (bars)
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-2.5 w-2.5 rounded-full bg-emerald-600" />
                          Open Rate %
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-2.5 w-2.5 rounded-full bg-indigo-600" />
                          Click Rate % (scaled 4x)
                        </span>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Chart B: Bounce & Complaint Rates Over Time */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle>
                      Bounce Rate &amp; Complaint Rate Over Time
                    </CardTitle>
                    <Badge tone="rose">MailWizz Campaigns</Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  {trends.length === 0 ? (
                    <p className="text-xs text-slate-500">
                      No campaign bounce/complaint trend data in the selected
                      window.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      <svg
                        viewBox="0 0 600 200"
                        className="h-52 w-full rounded-lg border border-slate-100 bg-slate-50/50 p-2"
                        role="img"
                        aria-label="Chart displaying campaign bounce rate and complaint rate over time"
                      >
                        {trends.length > 1 && (
                          <>
                            <polyline
                              fill="none"
                              stroke="#d97706"
                              strokeWidth="2.5"
                              points={trends
                                .map((pt, i) => {
                                  const xStep =
                                    560 / Math.max(1, trends.length);
                                  const x = 25 + i * xStep + 10;
                                  const y =
                                    165 -
                                    Math.min(25, pt.bounceRatePct) * 5.6;
                                  return `${x},${y}`;
                                })
                                .join(' ')}
                            />
                            <polyline
                              fill="none"
                              stroke="#e11d48"
                              strokeWidth="2.5"
                              points={trends
                                .map((pt, i) => {
                                  const xStep =
                                    560 / Math.max(1, trends.length);
                                  const x = 25 + i * xStep + 10;
                                  const y =
                                    165 -
                                    Math.min(5, pt.complaintRatePct) * 28;
                                  return `${x},${y}`;
                                })
                                .join(' ')}
                            />
                          </>
                        )}
                        {trends.map((pt, i) => {
                          const xStep = 560 / Math.max(1, trends.length);
                          const x = 25 + i * xStep + 10;
                          const yb =
                            165 - Math.min(25, pt.bounceRatePct) * 5.6;
                          const yc =
                            165 - Math.min(5, pt.complaintRatePct) * 28;
                          return (
                            <g key={`bc-${i}`}>
                              <circle cx={x} cy={yb} r={3.5} fill="#d97706">
                                <title>{`${pt.label}: Bounce ${pt.bounceRatePct}%`}</title>
                              </circle>
                              <circle cx={x} cy={yc} r={3.5} fill="#e11d48">
                                <title>{`${pt.label}: Complaint ${pt.complaintRatePct}%`}</title>
                              </circle>
                              <text
                                x={x}
                                y={185}
                                fontSize="9"
                                textAnchor="middle"
                                fill="#475569"
                              >
                                {pt.date.slice(5)}
                              </text>
                            </g>
                          );
                        })}
                      </svg>
                      <div className="flex flex-wrap gap-4 text-xs text-slate-600">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-2.5 w-2.5 rounded-full bg-amber-600" />
                          Bounce Rate % (0–25% scale)
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-2.5 w-2.5 rounded-full bg-rose-600" />
                          Complaint Rate % (0–5% scale)
                        </span>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Engagement by Domain + Before/After List Cleaning */}
            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle>
                      Engagement by Recipient Email Domain (Top 10)
                    </CardTitle>
                    <Badge tone="slate">Subscriber DB</Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-slate-200 text-slate-500">
                        <tr>
                          <th className="py-2 pr-3">Domain</th>
                          <th className="py-2 pr-3">Total</th>
                          <th className="py-2 pr-3">Active %</th>
                          <th className="py-2 pr-3">Inactive %</th>
                          <th className="py-2">Bounce %</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {data.engagementByRecipientDomain.map((d) => (
                          <tr key={d.domain}>
                            <td className="py-2 pr-3 font-medium text-slate-900">
                              {d.domain}
                            </td>
                            <td className="py-2 pr-3 tabular-nums">
                              {d.total.toLocaleString()}
                            </td>
                            <td className="py-2 pr-3 text-emerald-700">
                              <div className="flex items-center gap-1.5">
                                <span className="tabular-nums">
                                  {d.activeRatePct}%
                                </span>
                                <span className="inline-block h-1.5 w-12 overflow-hidden rounded bg-slate-100">
                                  <span
                                    className="block h-full bg-emerald-500"
                                    style={{
                                      width: `${Math.min(100, d.activeRatePct)}%`,
                                    }}
                                  />
                                </span>
                              </div>
                            </td>
                            <td className="py-2 pr-3 tabular-nums text-amber-700">
                              {d.inactiveRatePct}%
                            </td>
                            <td className="py-2 tabular-nums text-rose-700">
                              {d.bounceRatePct}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle>
                      Performance Before vs. After List Cleaning
                    </CardTitle>
                    <Badge tone="emerald">
                      {data.beforeAfterCleaning.sourceLabel}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-lg border border-slate-200/80 bg-slate-50/70 p-3">
                      <p className="text-xs text-slate-500">
                        Confirmed Baseline Audience
                      </p>
                      <p className="mt-1 text-xl font-semibold tabular-nums text-slate-900">
                        {data.beforeAfterCleaning.baselineConfirmedRecipients.toLocaleString()}
                      </p>
                    </div>
                    <div className="rounded-lg border border-emerald-200/80 bg-emerald-50/60 p-3">
                      <p className="text-xs text-emerald-700">
                        Projected Clean Audience
                      </p>
                      <p className="mt-1 text-xl font-semibold tabular-nums text-emerald-900">
                        {data.beforeAfterCleaning.projectedCleanAudience.toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <div className="space-y-2 text-xs text-slate-600">
                    <div className="flex justify-between">
                      <span>Already Suppressed Locally:</span>
                      <span className="font-semibold tabular-nums text-slate-900">
                        {data.beforeAfterCleaning.alreadySuppressedCount.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>
                        Recommended Suppression (Inactive / Long-Term / Never
                        Engaged):
                      </span>
                      <span className="font-semibold tabular-nums text-amber-700">
                        {data.beforeAfterCleaning.recommendedSuppressionCount.toLocaleString()}
                      </span>
                    </div>
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
                      <div
                        className="h-full bg-emerald-600"
                        style={{
                          width: `${Math.max(
                            0,
                            100 -
                              data.beforeAfterCleaning
                                .projectedVolumeReductionPct
                          )}%`,
                        }}
                      />
                    </div>
                    <p className="text-slate-500">
                      Estimated DirectMail SMTP volume saved after suppressing
                      inactive segments:{' '}
                      <strong>
                        {data.beforeAfterCleaning.projectedVolumeReductionPct}%
                      </strong>{' '}
                      (projected from confirmed subscriber classifications —
                      does not represent post-send open guarantees).
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Historical Performance by Mailing List & by Campaign */}
            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Historical Performance by Mailing List</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-slate-200 text-slate-500">
                        <tr>
                          <th className="py-2 pr-3">List</th>
                          <th className="py-2 pr-2">Campaigns</th>
                          <th className="py-2 pr-2">Processed</th>
                          <th className="py-2 pr-2">Open %</th>
                          <th className="py-2 pr-2">CTR %</th>
                          <th className="py-2">Unsub %</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {data.listPerformance.map((l) => (
                          <tr key={l.listId}>
                            <td className="py-2 pr-3 font-medium text-slate-900">
                              {l.listName}
                            </td>
                            <td className="py-2 pr-2 tabular-nums">
                              {l.campaigns}
                            </td>
                            <td className="py-2 pr-2 tabular-nums">
                              {l.processed.toLocaleString()}
                            </td>
                            <td className="py-2 pr-2 text-emerald-700">
                              <div className="flex items-center gap-1.5">
                                <span className="tabular-nums">
                                  {l.openRatePct}%
                                </span>
                                <span className="inline-block h-1.5 w-12 overflow-hidden rounded bg-slate-100">
                                  <span
                                    className="block h-full bg-emerald-500"
                                    style={{
                                      width: `${Math.min(100, l.openRatePct)}%`,
                                    }}
                                  />
                                </span>
                              </div>
                            </td>
                            <td className="py-2 pr-2 tabular-nums text-indigo-700">
                              {l.ctrPct}%
                            </td>
                            <td className="py-2 tabular-nums text-slate-600">
                              {l.unsubRatePct}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Historical Performance by Campaign</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="max-h-72 overflow-x-auto overflow-y-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-slate-200 text-slate-500">
                        <tr>
                          <th className="py-2 pr-3">Campaign</th>
                          <th className="py-2 pr-2">Source</th>
                          <th className="py-2 pr-2">SMTP Acc.</th>
                          <th className="py-2 pr-2">Hard/Soft B.</th>
                          <th className="py-2 pr-2">Open %</th>
                          <th className="py-2">CTR %</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {data.campaignHistory.map((c) => (
                          <tr key={c.id}>
                            <td className="py-2 pr-3">
                              <div className="font-medium text-slate-900">
                                {c.name}
                              </div>
                              <div className="text-[11px] text-slate-500">
                                {c.listName} ·{' '}
                                {c.sendAt ? c.sendAt.slice(0, 10) : 'No date'}
                              </div>
                            </td>
                            <td className="py-2 pr-2">
                              <Badge tone="slate">{c.sourceLabel}</Badge>
                            </td>
                            <td className="py-2 pr-2 tabular-nums">
                              {c.smtpAcceptedCount.toLocaleString()}
                            </td>
                            <td className="py-2 pr-2 tabular-nums">
                              {c.hardBouncesCount}/{c.softBouncesCount}
                            </td>
                            <td className="py-2 pr-2 tabular-nums text-emerald-700">
                              {c.openRatePct}%
                            </td>
                            <td className="py-2 tabular-nums text-indigo-700">
                              {c.ctrPct}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* SECTION 2: DOMAIN AUTHENTICATION DIAGNOSTICS */}
        {showSection('DNS') && (
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2">
                  <Globe className="h-4 w-4 text-slate-700" />
                  Domain Authentication Diagnostics (Read-Only Public DNS)
                </CardTitle>
                <Badge tone="emerald">
                  Never Auto-Edits DNS · Never Guesses DKIM Selectors
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <form onSubmit={runDnsCheck} className="grid gap-3 md:grid-cols-5">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">
                    Sending / Return-Path Domain *
                  </label>
                  <input
                    required
                    value={dnsDomain}
                    onChange={(e) => setDnsDomain(e.target.value)}
                    placeholder="mail.yourdomain.com"
                    className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">
                    Visible From Domain (DMARC Alignment)
                  </label>
                  <input
                    value={dnsFromDomain}
                    onChange={(e) => setDnsFromDomain(e.target.value)}
                    placeholder="yourdomain.com"
                    className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">
                    Tracking CNAME Domain
                  </label>
                  <input
                    value={dnsTrackingDomain}
                    onChange={(e) => setDnsTrackingDomain(e.target.value)}
                    placeholder="track.yourdomain.com"
                    className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">
                    Known DKIM Selector (Optional)
                  </label>
                  <input
                    value={dnsSelector}
                    onChange={(e) => setDnsSelector(e.target.value)}
                    placeholder="default / aliyun"
                    className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                  />
                </div>
                <div className="flex items-end">
                  <Button type="submit" disabled={busy} className="w-full">
                    <ShieldCheck className="mr-1.5 h-4 w-4" />
                    Check Public DNS
                  </Button>
                </div>
              </form>

              <p className="text-xs text-slate-500">
                <Info className="mr-1 inline h-3.5 w-3.5" />
                If no DKIM selector is supplied, DKIM status intentionally
                reports <strong>UNKNOWN</strong> instead of guessing arbitrary
                selectors. DNS lookups are strictly read-only.
              </p>

              {data.dnsChecks.length > 0 && (
                <div className="space-y-3">
                  {data.dnsChecks.slice(0, 5).map((chk) => {
                    const recs = Array.isArray(chk.recommendationsJson)
                      ? (chk.recommendationsJson as string[])
                      : [];
                    return (
                      <div
                        key={chk.id}
                        className="rounded-lg border border-slate-200/90 bg-slate-50/60 p-4 text-xs"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="font-semibold text-slate-900">
                            {chk.domain}{' '}
                            {chk.fromDomain && chk.fromDomain !== chk.domain
                              ? `(From: ${chk.fromDomain})`
                              : ''}{' '}
                            {chk.dkimSelector
                              ? `· selector: ${chk.dkimSelector}`
                              : ''}
                          </div>
                          <span className="text-slate-500">
                            Checked{' '}
                            {chk.checkedAt.slice(0, 16).replace('T', ' ')} UTC
                            by {chk.checkedByEmail}
                          </span>
                        </div>

                        <div className="mt-3 grid gap-2 sm:grid-cols-5">
                          <div>
                            <Badge tone={dnsTone(chk.spfStatus)} dot>
                              SPF: {chk.spfStatus}
                            </Badge>
                            <p className="mt-1 text-slate-600">
                              {chk.spfDetail}
                            </p>
                          </div>
                          <div>
                            <Badge tone={dnsTone(chk.dkimStatus)} dot>
                              DKIM: {chk.dkimStatus}
                            </Badge>
                            <p className="mt-1 text-slate-600">
                              {chk.dkimDetail}
                            </p>
                          </div>
                          <div>
                            <Badge tone={dnsTone(chk.dmarcStatus)} dot>
                              DMARC: {chk.dmarcStatus}
                            </Badge>
                            <p className="mt-1 text-slate-600">
                              {chk.dmarcDetail}
                            </p>
                          </div>
                          <div>
                            <Badge tone={dnsTone(chk.mxStatus)} dot>
                              MX: {chk.mxStatus}
                            </Badge>
                            <p className="mt-1 text-slate-600">
                              {Array.isArray(chk.mxRecordsJson)
                                ? `${chk.mxRecordsJson.length} MX host(s)`
                                : 'Checked'}
                            </p>
                          </div>
                          <div>
                            <Badge tone={dnsTone(chk.trackingStatus)} dot>
                              Tracking: {chk.trackingStatus}
                            </Badge>
                            <p className="mt-1 text-slate-600">
                              {chk.trackingDetail}
                            </p>
                          </div>
                        </div>

                        {recs.length > 0 && (
                          <ul className="mt-3 list-disc space-y-1 pl-4 text-slate-700">
                            {recs.map((r, idx) => (
                              <li key={idx}>{r}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* SECTION 3: ALIBABA CLOUD DIRECTMAIL */}
        {showSection('ALIBABA') && (
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2">
                  <CloudDownload className="h-4 w-4 text-slate-700" />
                  Alibaba Cloud DirectMail (Read-Only OpenAPI &amp; CSV Import)
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Badge tone={data.hasAlibabaCreds ? 'emerald' : 'slate'} dot>
                    {data.hasAlibabaCreds
                      ? `RAM Key Configured${alibabaKeyLast4 ? ` (${alibabaKeyLast4})` : ''}`
                      : 'API Keys Not Configured'}
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="rounded-lg border border-slate-200/90 bg-slate-50/70 p-3 text-xs text-slate-700">
                Only read-only DirectMail <code>Dm/2015-11-23</code> reporting
                actions are permitted (<code>DescAccountSummary</code>,{' '}
                <code>QueryDomainByParam</code>,{' '}
                <code>SenderStatisticsByTagNameAndBatchID</code>,{' '}
                <code>SenderStatisticsDetailByParam</code>,{' '}
                <code>QueryInvalidAddressByParam</code>). SMTP credentials,
                delivery-server records, and outbound test emails can{' '}
                <strong>never</strong> be modified or triggered here.
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                {/* RAM Read-Only API Credentials + Sync */}
                <div className="space-y-3 rounded-lg border border-slate-200/90 p-4">
                  <h3 className="text-sm font-semibold text-slate-900">
                    1. Read-Only OpenAPI Configuration
                  </h3>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <input
                      value={aliAccessKeyId}
                      onChange={(e) => setAliAccessKeyId(e.target.value)}
                      placeholder="RAM AccessKey ID (read-only)"
                      aria-label="Alibaba AccessKey ID"
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                    />
                    <input
                      type="password"
                      value={aliAccessKeySecret}
                      onChange={(e) => setAliAccessKeySecret(e.target.value)}
                      placeholder="RAM AccessKey Secret"
                      aria-label="Alibaba AccessKey Secret"
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                    />
                    <select
                      value={aliRegion}
                      onChange={(e) => setAliRegion(e.target.value)}
                      aria-label="Alibaba DirectMail Region"
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs"
                    >
                      <option value="ap-southeast-1">
                        ap-southeast-1 (Singapore)
                      </option>
                      <option value="ap-southeast-2">
                        ap-southeast-2 (Sydney)
                      </option>
                      <option value="cn-hangzhou">cn-hangzhou</option>
                      <option value="us-east-1">us-east-1</option>
                      <option value="eu-central-1">eu-central-1</option>
                    </select>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void submitAlibabaAction(
                          {
                            action: 'SAVE_CREDS',
                            accessKeyId: aliAccessKeyId || undefined,
                            accessKeySecret: aliAccessKeySecret || undefined,
                            region: aliRegion,
                          },
                          'Encrypted Alibaba DirectMail RAM credentials saved.'
                        )
                      }
                    >
                      Save RAM Credentials
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || !data.hasAlibabaCreds}
                      onClick={() =>
                        void submitAlibabaAction(
                          { action: 'SYNC_API', daysBack: 30 },
                          'Synced read-only Alibaba DirectMail reporting statistics.'
                        )
                      }
                    >
                      Sync Read-Only API (30d)
                    </Button>
                    {data.hasAlibabaCreds && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          void submitAlibabaAction(
                            { action: 'CLEAR_CREDS' },
                            'Cleared Alibaba DirectMail credentials.'
                          )
                        }
                      >
                        Clear Keys
                      </Button>
                    )}
                  </div>
                  {data.alibabaAccountStatus && (
                    <p className="text-xs text-slate-600">
                      Account Status:{' '}
                      <strong>{data.alibabaAccountStatus}</strong>{' '}
                      {data.alibabaLastSyncedAt
                        ? `(Synced ${data.alibabaLastSyncedAt.slice(0, 16).replace('T', ' ')} UTC)`
                        : ''}
                    </p>
                  )}
                </div>

                {/* Manual CSV Import */}
                <div className="space-y-3 rounded-lg border border-slate-200/90 p-4">
                  <h3 className="text-sm font-semibold text-slate-900">
                    2. Manual DirectMail CSV Report Import
                  </h3>
                  <p className="text-xs text-slate-500">
                    Use when complaint FBL exports are unavailable via OpenAPI
                    or API keys are omitted. Header columns:{' '}
                    <code>
                      date,domain,requests,delivered,failed,invalid_address,complaints
                    </code>
                    .
                  </p>
                  <textarea
                    rows={3}
                    value={aliCsv}
                    onChange={(e) => setAliCsv(e.target.value)}
                    placeholder={`date,domain,requests,delivered,failed,invalid_address,complaints\n2026-11-10,mail.yourdomain.com,1800,1765,35,12,1`}
                    aria-label="Alibaba DirectMail CSV Content"
                    className="w-full rounded-lg border border-slate-300 p-2 font-mono text-xs"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || aliCsv.trim().length < 5}
                    onClick={() =>
                      void submitAlibabaAction(
                        { action: 'IMPORT_CSV', csvContent: aliCsv },
                        'Imported Alibaba DirectMail CSV metrics.'
                      ).then(() => setAliCsv(''))
                    }
                  >
                    <Upload className="mr-1.5 h-3.5 w-3.5" />
                    Import DirectMail CSV
                  </Button>
                </div>
              </div>

              {/* DirectMail Summary & Table */}
              <div className="space-y-2">
                <div className="flex flex-wrap gap-4 text-xs tabular-nums text-slate-700">
                  <span>
                    DirectMail Requests:{' '}
                    <strong>{alibabaTotals.requests.toLocaleString()}</strong>
                  </span>
                  <span>
                    SMTP Accepted/Delivered:{' '}
                    <strong>{alibabaTotals.delivered.toLocaleString()}</strong>
                  </span>
                  <span>
                    Failed:{' '}
                    <strong>{alibabaTotals.failed.toLocaleString()}</strong>
                  </span>
                  <span>
                    Invalid Addresses:{' '}
                    <strong>{alibabaTotals.invalid.toLocaleString()}</strong>
                  </span>
                  <span>
                    Complaints (CSV/Demo only):{' '}
                    <strong>{alibabaTotals.complaints.toLocaleString()}</strong>
                  </span>
                </div>
                <div className="max-h-56 overflow-x-auto overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 text-slate-500">
                      <tr>
                        <th className="py-2 pr-3">Date</th>
                        <th className="py-2 pr-3">Domain</th>
                        <th className="py-2 pr-3">Source</th>
                        <th className="py-2 pr-2">Requests</th>
                        <th className="py-2 pr-2">Accepted</th>
                        <th className="py-2 pr-2">Failed</th>
                        <th className="py-2 pr-2">Invalid Addr</th>
                        <th className="py-2">Complaints</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.alibabaMetrics.map((m) => (
                        <tr key={m.id}>
                          <td className="py-1.5 pr-3">{m.date}</td>
                          <td className="py-1.5 pr-3 font-medium">
                            {m.domainName}
                          </td>
                          <td className="py-1.5 pr-3">
                            <Badge
                              tone={
                                m.source === 'SYNTHETIC_DEMO'
                                  ? 'amber'
                                  : m.source === 'ALIBABA_API'
                                    ? 'emerald'
                                    : 'sky'
                              }
                            >
                              {m.source}
                            </Badge>
                          </td>
                          <td className="py-1.5 pr-2 tabular-nums">
                            {m.requestsCount.toLocaleString()}
                          </td>
                          <td className="py-1.5 pr-2 tabular-nums">
                            {m.deliveredCount.toLocaleString()}
                          </td>
                          <td className="py-1.5 pr-2 tabular-nums text-amber-700">
                            {m.failedCount.toLocaleString()}
                          </td>
                          <td className="py-1.5 pr-2 tabular-nums text-rose-700">
                            {m.invalidAddressCount.toLocaleString()}
                          </td>
                          <td className="py-1.5 tabular-nums">
                            {m.complaintCount === null
                              ? 'N/A (API)'
                              : m.complaintCount}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* SECTION 4: GMAIL & OTHER MAILBOX PROVIDERS + GOOGLE POSTMASTER */}
        {showSection('SEED') && (
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Seed Inbox Placement */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-slate-700" />
                    Controlled Seed Inbox Placement Log
                  </CardTitle>
                  <Badge tone="slate">Tested Seed Mailboxes Only</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-xs text-slate-600">
                  <ShieldAlert className="mr-1 inline h-3.5 w-3.5 text-amber-600" />
                  Observed inbox placement applies strictly to your own
                  controlled Gmail, Outlook, Yahoo, or other test seed inboxes —
                  it never inspects arbitrary subscribers&apos; inboxes or
                  bypasses spam filters.
                </p>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void submitSeedAction(
                      {
                        action: 'RECORD_PLACEMENT_TEST',
                        testDomain: seedDomain,
                        sendingProvider: 'Alibaba Cloud DirectMail (SMTP)',
                        campaignUid: seedCampaignUid,
                        recipientProvider: seedProvider,
                        customProviderName:
                          seedProvider === 'OTHER'
                            ? seedCustomProvider
                            : undefined,
                        testedAt: seedTestedAt,
                        placement: seedPlacement,
                        spfPass: seedSpfPass,
                        dkimPass: seedDkimPass,
                        dmarcPass: seedDmarcPass,
                        postmasterReputation: seedReputation,
                        notes: seedNotes,
                      },
                      `Recorded seed inbox placement (${seedProvider}: ${seedPlacement}).`
                    );
                  }}
                  className="grid gap-2 sm:grid-cols-2"
                >
                  <input
                    required
                    value={seedDomain}
                    onChange={(e) => setSeedDomain(e.target.value)}
                    placeholder="Test sending domain *"
                    aria-label="Test sending domain"
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                  />
                  <input
                    value={seedCampaignUid}
                    onChange={(e) => setSeedCampaignUid(e.target.value)}
                    placeholder="Campaign UID (optional)"
                    aria-label="Seed Campaign UID"
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                  />
                  <select
                    value={seedProvider}
                    onChange={(e) =>
                      setSeedProvider(
                        e.target.value as
                          | 'GMAIL'
                          | 'OUTLOOK'
                          | 'YAHOO'
                          | 'OTHER'
                      )
                    }
                    aria-label="Recipient Mailbox Provider"
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs"
                  >
                    <option value="GMAIL">Gmail</option>
                    <option value="OUTLOOK">Outlook / Hotmail</option>
                    <option value="YAHOO">Yahoo Mail</option>
                    <option value="OTHER">Other Provider</option>
                  </select>
                  <select
                    value={seedPlacement}
                    onChange={(e) =>
                      setSeedPlacement(
                        e.target.value as
                          | 'PRIMARY'
                          | 'PROMOTIONS'
                          | 'OTHER'
                          | 'SPAM'
                          | 'MISSING'
                      )
                    }
                    aria-label="Observed Placement Folder"
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs"
                  >
                    <option value="PRIMARY">Primary / Inbox</option>
                    <option value="PROMOTIONS">Promotions</option>
                    <option value="OTHER">Other / Updates</option>
                    <option value="SPAM">Spam / Junk</option>
                    <option value="MISSING">Missing / Not Received</option>
                  </select>
                  {seedProvider === 'OTHER' && (
                    <input
                      value={seedCustomProvider}
                      onChange={(e) => setSeedCustomProvider(e.target.value)}
                      placeholder="Custom provider name"
                      aria-label="Custom Provider Name"
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs sm:col-span-2"
                    />
                  )}
                  <input
                    type="date"
                    value={seedTestedAt}
                    onChange={(e) => setSeedTestedAt(e.target.value)}
                    aria-label="Seed Test Date"
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                  />
                  <input
                    value={seedReputation}
                    onChange={(e) => setSeedReputation(e.target.value)}
                    placeholder="Observed auth/rep summary (opt.)"
                    aria-label="Observed Reputation"
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                  />
                  <div className="flex items-center gap-4 text-xs text-slate-700 sm:col-span-2">
                    <label className="inline-flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={seedSpfPass}
                        onChange={(e) => setSeedSpfPass(e.target.checked)}
                      />
                      SPF Pass
                    </label>
                    <label className="inline-flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={seedDkimPass}
                        onChange={(e) => setSeedDkimPass(e.target.checked)}
                      />
                      DKIM Pass
                    </label>
                    <label className="inline-flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={seedDmarcPass}
                        onChange={(e) => setSeedDmarcPass(e.target.checked)}
                      />
                      DMARC Pass
                    </label>
                  </div>
                  <input
                    value={seedNotes}
                    onChange={(e) => setSeedNotes(e.target.value)}
                    placeholder="Diagnostic notes from seed headers..."
                    aria-label="Seed Test Notes"
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs sm:col-span-2"
                  />
                  <Button
                    type="submit"
                    size="sm"
                    disabled={busy}
                    className="sm:col-span-2"
                  >
                    <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                    Record Seed Test Result
                  </Button>
                </form>

                <div className="max-h-56 overflow-x-auto overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 text-slate-500">
                      <tr>
                        <th className="py-1.5 pr-2">Date</th>
                        <th className="py-1.5 pr-2">Provider</th>
                        <th className="py-1.5 pr-2">Placement</th>
                        <th className="py-1.5 pr-2">Auth (S/K/M)</th>
                        <th className="py-1.5">Notes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.inboxTests.map((t) => (
                        <tr key={t.id}>
                          <td className="py-1.5 pr-2">
                            {t.testedAt.slice(0, 10)}
                          </td>
                          <td className="py-1.5 pr-2 font-medium">
                            {t.recipientProvider}
                            {t.customProviderName
                              ? ` (${t.customProviderName})`
                              : ''}
                            {t.isDemoData && (
                              <Badge tone="amber" className="ml-1">
                                DEMO
                              </Badge>
                            )}
                          </td>
                          <td className="py-1.5 pr-2">
                            <Badge tone={placementTone(t.placement)} dot>
                              {t.placement}
                            </Badge>
                          </td>
                          <td className="py-1.5 pr-2 font-mono text-[11px]">
                            {t.spfPass ? 'P' : 'F'}/{t.dkimPass ? 'P' : 'F'}/
                            {t.dmarcPass ? 'P' : 'F'}
                          </td>
                          <td className="py-1.5 text-slate-600">
                            {t.notes || t.testDomain}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* Google Postmaster Tools */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle>
                    Google Postmaster Tools (API v1 &amp; Guided Entry)
                  </CardTitle>
                  <Badge
                    tone={data.hasGooglePostmasterToken ? 'emerald' : 'slate'}
                    dot
                  >
                    {data.hasGooglePostmasterToken
                      ? 'OAuth Token Saved'
                      : 'Manual / Token Ready'}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2 rounded-lg border border-slate-200/90 p-3">
                  <h3 className="text-xs font-semibold text-slate-900">
                    Authorized API Sync (<code>postmaster.readonly</code>)
                  </h3>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input
                      value={pmDomain}
                      onChange={(e) => setPmDomain(e.target.value)}
                      placeholder="Verified domain (example.com)"
                      aria-label="Google Postmaster Domain"
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                    />
                    <input
                      type="password"
                      value={pmToken}
                      onChange={(e) => setPmToken(e.target.value)}
                      placeholder="OAuth Bearer token (optional update)"
                      aria-label="Google Postmaster OAuth Token"
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void submitSeedAction(
                          {
                            action: 'SAVE_POSTMASTER_CONFIG',
                            domain: pmDomain || undefined,
                            oauthAccessToken: pmToken || undefined,
                          },
                          'Saved encrypted Google Postmaster configuration.'
                        ).then(() => setPmToken(''))
                      }
                    >
                      Save Postmaster Config
                    </Button>
                    <Button
                      size="sm"
                      disabled={busy || !data.hasGooglePostmasterToken}
                      onClick={() =>
                        void submitSeedAction(
                          {
                            action: 'SYNC_POSTMASTER_API',
                            domain: pmDomain || undefined,
                            daysBack: 14,
                          },
                          'Synced Google Postmaster TrafficStats API.'
                        )
                      }
                    >
                      Sync Postmaster API
                    </Button>
                  </div>
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void submitSeedAction(
                      {
                        action: 'RECORD_MANUAL_POSTMASTER',
                        domain: pmDomain,
                        statDate: pmStatDate,
                        domainReputation: pmRep,
                        userReportedSpamRatio: Number(pmSpamRatio),
                        dkimSuccessRatio: Number(pmDkimRatio),
                        dmarcSuccessRatio: Number(pmDmarcRatio),
                        spfSuccessRatio: Number(pmSpfRatio),
                        notes: pmNotes,
                      },
                      'Saved manual Google Postmaster observation.'
                    );
                  }}
                  className="grid gap-2 rounded-lg border border-slate-200/90 p-3 sm:grid-cols-3"
                >
                  <h3 className="text-xs font-semibold text-slate-900 sm:col-span-3">
                    Guided Manual Postmaster Entry
                  </h3>
                  <input
                    required
                    value={pmDomain}
                    onChange={(e) => setPmDomain(e.target.value)}
                    placeholder="Domain *"
                    className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
                  />
                  <input
                    type="date"
                    required
                    value={pmStatDate}
                    onChange={(e) => setPmStatDate(e.target.value)}
                    className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
                  />
                  <select
                    value={pmRep}
                    onChange={(e) =>
                      setPmRep(
                        e.target.value as
                          | 'HIGH'
                          | 'MEDIUM'
                          | 'LOW'
                          | 'BAD'
                          | 'UNKNOWN'
                      )
                    }
                    aria-label="Postmaster Domain Reputation"
                    className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                  >
                    <option value="HIGH">Reputation: HIGH</option>
                    <option value="MEDIUM">Reputation: MEDIUM</option>
                    <option value="LOW">Reputation: LOW</option>
                    <option value="BAD">Reputation: BAD</option>
                    <option value="UNKNOWN">Reputation: UNKNOWN</option>
                  </select>
                  <input
                    value={pmSpamRatio}
                    onChange={(e) => setPmSpamRatio(e.target.value)}
                    placeholder="Spam ratio (0..1)"
                    title="User-reported spam ratio (0 to 1)"
                    className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
                  />
                  <input
                    value={pmDkimRatio}
                    onChange={(e) => setPmDkimRatio(e.target.value)}
                    placeholder="DKIM pass (0..1)"
                    title="DKIM pass ratio (0 to 1)"
                    className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
                  />
                  <input
                    value={pmDmarcRatio}
                    onChange={(e) => setPmDmarcRatio(e.target.value)}
                    placeholder="DMARC pass (0..1)"
                    title="DMARC pass ratio (0 to 1)"
                    className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
                  />
                  <input
                    value={pmSpfRatio}
                    onChange={(e) => setPmSpfRatio(e.target.value)}
                    placeholder="SPF pass (0..1)"
                    title="SPF pass ratio (0 to 1)"
                    className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
                  />
                  <input
                    value={pmNotes}
                    onChange={(e) => setPmNotes(e.target.value)}
                    placeholder="Notes..."
                    className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
                  />
                  <Button
                    type="submit"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                  >
                    Save Manual Entry
                  </Button>
                </form>

                <div className="max-h-48 overflow-x-auto overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 text-slate-500">
                      <tr>
                        <th className="py-1.5 pr-2">Date</th>
                        <th className="py-1.5 pr-2">Domain</th>
                        <th className="py-1.5 pr-2">Rep</th>
                        <th className="py-1.5 pr-2">Spam %</th>
                        <th className="py-1.5">Source</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.postmasterStats.map((s) => (
                        <tr key={s.id}>
                          <td className="py-1.5 pr-2">{s.statDate}</td>
                          <td className="py-1.5 pr-2 font-medium">
                            {s.domain}
                          </td>
                          <td className="py-1.5 pr-2">
                            <Badge
                              dot
                              tone={
                                s.domainReputation === 'HIGH'
                                  ? 'emerald'
                                  : s.domainReputation === 'MEDIUM'
                                    ? 'amber'
                                    : 'rose'
                              }
                            >
                              {s.domainReputation ?? 'UNKNOWN'}
                            </Badge>
                          </td>
                          <td className="py-1.5 pr-2 tabular-nums">
                            {s.userReportedSpamRatio !== null
                              ? `${(s.userReportedSpamRatio * 100).toFixed(2)}%`
                              : 'N/A'}
                          </td>
                          <td className="py-1.5">
                            <Badge tone={s.isDemoData ? 'amber' : 'sky'}>
                              {s.source}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </AppShell>
  );
}
