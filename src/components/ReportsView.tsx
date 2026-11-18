'use client';

import React, { useState } from 'react';
import { BarChart3, Download } from 'lucide-react';
import { AppShell } from './AppShell';
import {
  AgentWorkflowStrip,
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  StatusDot,
} from './ui';
import type { generateAllReportsSummary } from '@/services/reports/generator';

type ReportsSummary = Awaited<ReturnType<typeof generateAllReportsSummary>>;

export function ReportsView({
  adminEmail,
  csrfToken,
  isDemoMode,
  phase1ReadOnly,
  connections = [],
  lists,
  initialSummary,
}: {
  adminEmail: string;
  csrfToken: string;
  isDemoMode: boolean;
  phase1ReadOnly: boolean;
  connections?: Array<{
    id: string;
    customerName: string;
    customerSlug: string;
  }>;
  lists: Array<{ id: string; name: string; customerConnectionId?: string }>;
  initialSummary: ReportsSummary;
}) {
  const [selectedConnectionId, setSelectedConnectionId] = useState('');
  const [selectedListId, setSelectedListId] = useState('');
  const [maskPii, setMaskPii] = useState(true);
  const [summary, setSummary] = useState<ReportsSummary>(initialSummary);
  const [loading, setLoading] = useState(false);

  const visibleLists = selectedConnectionId
    ? lists.filter((l) => l.customerConnectionId === selectedConnectionId)
    : lists;

  async function reloadSummary(
    nextListId: string,
    nextConnectionId = selectedConnectionId
  ) {
    setSelectedListId(nextListId);
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      if (nextConnectionId) sp.set('customerConnectionId', nextConnectionId);
      if (nextListId) sp.set('mailingListId', nextListId);
      const url = sp.toString()
        ? `/api/reports/hygiene?${sp.toString()}`
        : '/api/reports/hygiene';
      const res = await fetch(url);
      if (res.ok) setSummary(await res.json());
    } finally {
      setLoading(false);
    }
  }

  function csvHref(reportType: string) {
    const params = new URLSearchParams({
      reportType,
      format: 'csv',
      mask: String(maskPii),
    });
    const effectiveConnId =
      selectedConnectionId ||
      (connections.length > 1 ? (connections[0]?.id ?? '') : '');
    if (effectiveConnId)
      params.set('customerConnectionId', effectiveConnId);
    if (selectedListId) params.set('mailingListId', selectedListId);
    return `/api/reports/hygiene?${params.toString()}`;
  }

  return (
    <AppShell
      adminEmail={adminEmail}
      csrfToken={csrfToken}
      isDemoMode={isDemoMode}
      phase1ReadOnly={phase1ReadOnly}
    >
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200/80 pb-5">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
                <BarChart3 className="h-3 w-3" />
                AUDIENCE_INTELLIGENCE_EXPORTS
              </span>
            </div>
            <h1 className="mt-1.5 text-xl font-semibold tracking-tight text-slate-900">
              Hygiene &amp; Deliverability Reports
            </h1>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-600">
              On-screen analytics and CSV exports for active, inactive,
              never-engaged, suppression recommendations, re-engagement, cleanup
              reconciliation, before/after audience comparison, and data
              confidence.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 rounded-lg border border-slate-200/90 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-2xs">
              <input
                type="checkbox"
                checked={maskPii}
                onChange={(e) => setMaskPii(e.target.checked)}
              />
              Mask emails in CSV exports
            </label>
            {connections.length > 0 && (
              <select
                aria-label="Filter reports by customer connection"
                data-testid="reports-customer-selector"
                value={selectedConnectionId}
                onChange={(e) => {
                  const next = e.target.value;
                  setSelectedConnectionId(next);
                  void reloadSummary('', next);
                }}
                className="rounded-lg border border-slate-300/90 bg-white px-3 py-1.5 text-xs font-medium shadow-2xs"
              >
                <option value="">All Customer Accounts</option>
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.customerName}
                  </option>
                ))}
              </select>
            )}
            <select
              aria-label="Filter reports by mailing list"
              value={selectedListId}
              onChange={(e) =>
                reloadSummary(e.target.value, selectedConnectionId)
              }
              className="rounded-lg border border-slate-300/90 bg-white px-3 py-1.5 text-xs font-medium shadow-2xs"
            >
              <option value="">
                All Mailing Lists ({visibleLists.length})
              </option>
              {visibleLists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <AgentWorkflowStrip
          activeStage="recommend"
          phase1ReadOnly={phase1ReadOnly}
        />

        {loading && (
          <div className="text-xs font-medium text-slate-500">
            Refreshing report aggregates...
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* 1. Active Audience */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <StatusDot tone="emerald" />
                  <CardTitle>1. Active &amp; Cooling Audience</CardTitle>
                </div>
                <a
                  href={csvHref('ACTIVE_AUDIENCE')}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-indigo-600 shadow-2xs hover:bg-slate-50"
                >
                  <Download className="h-3.5 w-3.5" /> CSV
                </a>
              </div>
            </CardHeader>
            <CardContent className="space-y-1 text-sm tabular-nums">
              <div>
                Active: <strong>{summary.activeAudience.activeCount}</strong> •
                Cooling: <strong>{summary.activeAudience.coolingCount}</strong>
              </div>
              <div className="text-xs text-slate-500">
                Open-only (MPP caveat):{' '}
                {summary.activeAudience.openOnlyMppCaveatCount} •
                Click-without-open:{' '}
                {summary.activeAudience.clickWithoutOpenCount}
              </div>
            </CardContent>
          </Card>

          {/* 2. Inactive Audience */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <StatusDot tone="amber" />
                  <CardTitle>2. Inactive Audience</CardTitle>
                </div>
                <a
                  href={csvHref('INACTIVE_AUDIENCE')}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-indigo-600 shadow-2xs hover:bg-slate-50"
                >
                  <Download className="h-3.5 w-3.5" /> CSV
                </a>
              </div>
            </CardHeader>
            <CardContent className="text-sm tabular-nums">
              Inactive: <strong>{summary.inactiveAudience.inactiveCount}</strong>{' '}
              • Long-Term Inactive (180+ days):{' '}
              <strong>{summary.inactiveAudience.longTermInactiveCount}</strong>
            </CardContent>
          </Card>

          {/* 3. Never Engaged */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <StatusDot tone="rose" />
                  <CardTitle>3. Never-Engaged Contacts</CardTitle>
                </div>
                <a
                  href={csvHref('NEVER_ENGAGED')}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-indigo-600 shadow-2xs hover:bg-slate-50"
                >
                  <Download className="h-3.5 w-3.5" /> CSV
                </a>
              </div>
            </CardHeader>
            <CardContent className="text-sm tabular-nums">
              Never Engaged (sufficient deliveries, zero opens/clicks/replies):{' '}
              <strong>{summary.neverEngaged.neverEngagedCount}</strong>
            </CardContent>
          </Card>

          {/* 4. Suppression Recommendations */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <StatusDot tone="indigo" />
                  <CardTitle>4. Suppression Recommendations</CardTitle>
                </div>
                <a
                  href={csvHref('SUPPRESSION_RECOMMENDATIONS')}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-indigo-600 shadow-2xs hover:bg-slate-50"
                >
                  <Download className="h-3.5 w-3.5" /> CSV
                </a>
              </div>
            </CardHeader>
            <CardContent className="space-y-1 text-sm tabular-nums">
              <div>
                Recommended Safe Suppression:{' '}
                <strong>
                  {summary.suppressionRecommendations.recommendedCount}
                </strong>
              </div>
              <div className="text-xs text-slate-500">
                Currently Suppressed:{' '}
                {summary.suppressionRecommendations.currentlySuppressedCount} •
                Protected VIP/Paid:{' '}
                {summary.suppressionRecommendations.protectedVipOrPaidCount}
              </div>
            </CardContent>
          </Card>

          {/* 5. Before & After Comparison */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <StatusDot tone="teal" />
                <CardTitle>5. Before &amp; After Audience Comparison</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-1 text-sm tabular-nums">
              <div>
                Baseline Confirmed:{' '}
                <strong>
                  {summary.beforeAfterComparison.baselineConfirmedRecipients}
                </strong>{' '}
                → After Recommended Clean Sends:{' '}
                <strong>
                  {
                    summary.beforeAfterComparison
                      .currentRecommendedCleanRecipients
                  }
                </strong>
              </div>
              <div className="text-xs text-slate-500">
                Estimated DirectMail send reduction:{' '}
                <Badge tone="emerald">
                  {
                    summary.beforeAfterComparison
                      .estimatedRoutineSendReductionPct
                  }
                  %
                </Badge>
              </div>
            </CardContent>
          </Card>

          {/* 6. Data Quality & Confidence */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <StatusDot tone="sky" />
                  <CardTitle>6. Data Quality &amp; Confidence</CardTitle>
                </div>
                <a
                  href={csvHref('DATA_QUALITY')}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-indigo-600 shadow-2xs hover:bg-slate-50"
                >
                  <Download className="h-3.5 w-3.5" /> CSV
                </a>
              </div>
            </CardHeader>
            <CardContent className="space-y-1 text-sm tabular-nums">
              <div>
                Insufficient Data:{' '}
                <strong>{summary.dataQuality.insufficientDataCount}</strong> •
                Excluded: <strong>{summary.dataQuality.excludedCount}</strong>
              </div>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {Object.entries(summary.dataQuality.confidenceCounts).map(
                  ([k, v]) => (
                    <Badge key={k} tone="slate">
                      Confidence {k}: {v}
                    </Badge>
                  )
                )}
              </div>
            </CardContent>
          </Card>

          {/* 7. Re-engagement Report */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <StatusDot tone="indigo" />
                  <CardTitle>7. Re-Engagement Campaigns</CardTitle>
                </div>
                <a
                  href={csvHref('REENGAGEMENT')}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-indigo-600 shadow-2xs hover:bg-slate-50"
                >
                  <Download className="h-3.5 w-3.5" /> CSV
                </a>
              </div>
            </CardHeader>
            <CardContent className="text-sm tabular-nums">
              Plans: <strong>{summary.reengagement.totalPlans}</strong> •
              Recovered to Active:{' '}
              <strong>{summary.reengagement.totalRecovered}</strong> •
              Persistently Inactive:{' '}
              <strong>{summary.reengagement.totalPersistentlyInactive}</strong>
            </CardContent>
          </Card>

          {/* 8. Cleanup Execution Report */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <StatusDot tone="slate" />
                  <CardTitle>8. Cleanup Execution Log</CardTitle>
                </div>
                <a
                  href={csvHref('CLEANUP_EXECUTION')}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-indigo-600 shadow-2xs hover:bg-slate-50"
                >
                  <Download className="h-3.5 w-3.5" /> CSV
                </a>
              </div>
            </CardHeader>
            <CardContent className="text-sm tabular-nums">
              Total Operations:{' '}
              <strong>{summary.cleanupExecution.totalOperations}</strong>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
