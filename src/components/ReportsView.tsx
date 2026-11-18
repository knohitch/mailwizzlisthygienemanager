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
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--border-subtle)] pb-5">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-display inline-flex items-center gap-1.5 rounded-md border border-[var(--accent-border)] bg-[var(--accent-bg)] px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider text-[var(--accent-fg)]">
                <BarChart3 className="h-3.5 w-3.5" />
                Audience Intelligence &amp; Exports
              </span>
            </div>
            <h1 className="font-display mt-2 text-2xl font-extrabold tracking-tight text-[var(--fg-primary)]">
              Hygiene &amp; Deliverability Reports
            </h1>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-[var(--fg-secondary)]">
              On-screen analytics and CSV exports for active, inactive,
              never-engaged, suppression recommendations, re-engagement, cleanup
              reconciliation, before/after audience comparison, and data
              confidence.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-2 text-xs font-semibold text-[var(--fg-primary)]">
              <input
                type="checkbox"
                checked={maskPii}
                onChange={(e) => setMaskPii(e.target.checked)}
                className="h-4 w-4 rounded"
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
                className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] px-3.5 py-2 text-xs font-semibold text-[var(--fg-primary)]"
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
              className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] px-3.5 py-2 text-xs font-semibold text-[var(--fg-primary)]"
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
          <div className="text-sm font-semibold text-[var(--fg-secondary)]">
            Refreshing report aggregates...
          </div>
        )}

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {/* 1. Active Audience */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <StatusDot tone="emerald" />
                  <CardTitle>1. Active &amp; Cooling Audience</CardTitle>
                </div>
                <a
                  href={csvHref('ACTIVE_AUDIENCE')}
                  className="font-display inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-1.5 text-xs font-bold text-[var(--fg-primary)] transition-colors hover:bg-[var(--bg-elevated)]"
                >
                  <Download className="h-3.5 w-3.5 text-[var(--accent-fg)]" />{' '}
                  CSV
                </a>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-well)] p-3">
                  <div className="text-xs font-medium text-[var(--fg-secondary)]">
                    Active Subscribers
                  </div>
                  <div className="font-display mt-1 text-2xl font-extrabold tabular-nums text-[var(--fg-primary)]">
                    {summary.activeAudience.activeCount.toLocaleString()}
                  </div>
                </div>
                <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-well)] p-3">
                  <div className="text-xs font-medium text-[var(--fg-secondary)]">
                    Cooling Subscribers
                  </div>
                  <div className="font-display mt-1 text-2xl font-extrabold tabular-nums text-[var(--fg-primary)]">
                    {summary.activeAudience.coolingCount.toLocaleString()}
                  </div>
                </div>
              </div>
              <div className="text-xs text-[var(--fg-secondary)]">
                Active: <strong>{summary.activeAudience.activeCount}</strong> •
                Cooling: <strong>{summary.activeAudience.coolingCount}</strong>{' '}
                • Open-only (MPP caveat):{' '}
                <strong>{summary.activeAudience.openOnlyMppCaveatCount}</strong>{' '}
                • Click-without-open:{' '}
                <strong>{summary.activeAudience.clickWithoutOpenCount}</strong>
              </div>
            </CardContent>
          </Card>

          {/* 2. Inactive Audience */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <StatusDot tone="amber" />
                  <CardTitle>2. Inactive Audience</CardTitle>
                </div>
                <a
                  href={csvHref('INACTIVE_AUDIENCE')}
                  className="font-display inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-1.5 text-xs font-bold text-[var(--fg-primary)] transition-colors hover:bg-[var(--bg-elevated)]"
                >
                  <Download className="h-3.5 w-3.5 text-[var(--accent-fg)]" />{' '}
                  CSV
                </a>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-well)] p-3">
                  <div className="text-xs font-medium text-[var(--fg-secondary)]">
                    Inactive Candidates
                  </div>
                  <div className="font-display mt-1 text-2xl font-extrabold tabular-nums text-[var(--fg-primary)]">
                    {summary.inactiveAudience.inactiveCount.toLocaleString()}
                  </div>
                </div>
                <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-well)] p-3">
                  <div className="text-xs font-medium text-[var(--fg-secondary)]">
                    Long-Term Inactive (180d+)
                  </div>
                  <div className="font-display mt-1 text-2xl font-extrabold tabular-nums text-[var(--fg-primary)]">
                    {summary.inactiveAudience.longTermInactiveCount.toLocaleString()}
                  </div>
                </div>
              </div>
              <div className="text-xs text-[var(--fg-secondary)]">
                Inactive:{' '}
                <strong>{summary.inactiveAudience.inactiveCount}</strong> •
                Long-Term Inactive (180+ days):{' '}
                <strong>
                  {summary.inactiveAudience.longTermInactiveCount}
                </strong>
              </div>
            </CardContent>
          </Card>

          {/* 3. Never Engaged */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <StatusDot tone="rose" />
                  <CardTitle>3. Never-Engaged Contacts</CardTitle>
                </div>
                <a
                  href={csvHref('NEVER_ENGAGED')}
                  className="font-display inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-1.5 text-xs font-bold text-[var(--fg-primary)] transition-colors hover:bg-[var(--bg-elevated)]"
                >
                  <Download className="h-3.5 w-3.5 text-[var(--accent-fg)]" />{' '}
                  CSV
                </a>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-well)] p-3">
                <div className="text-xs font-medium text-[var(--fg-secondary)]">
                  Zero Opens, Clicks, or Replies Across Qualifying Campaigns
                </div>
                <div className="font-display mt-1 text-2xl font-extrabold tabular-nums text-[var(--fg-primary)]">
                  {summary.neverEngaged.neverEngagedCount.toLocaleString()}
                </div>
              </div>
              <div className="text-xs text-[var(--fg-secondary)]">
                Never Engaged (sufficient deliveries, zero
                opens/clicks/replies):{' '}
                <strong>{summary.neverEngaged.neverEngagedCount}</strong>
              </div>
            </CardContent>
          </Card>

          {/* 4. Suppression Recommendations */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <StatusDot tone="indigo" />
                  <CardTitle>4. Suppression Recommendations</CardTitle>
                </div>
                <a
                  href={csvHref('SUPPRESSION_RECOMMENDATIONS')}
                  className="font-display inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-1.5 text-xs font-bold text-[var(--fg-primary)] transition-colors hover:bg-[var(--bg-elevated)]"
                >
                  <Download className="h-3.5 w-3.5 text-[var(--accent-fg)]" />{' '}
                  CSV
                </a>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-3 gap-2.5">
                <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-well)] p-3">
                  <div className="text-xs font-medium text-[var(--fg-secondary)]">
                    Recommended
                  </div>
                  <div className="font-display mt-1 text-2xl font-extrabold tabular-nums text-[var(--fg-primary)]">
                    {summary.suppressionRecommendations.recommendedCount.toLocaleString()}
                  </div>
                </div>
                <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-well)] p-3">
                  <div className="text-xs font-medium text-[var(--fg-secondary)]">
                    Suppressed
                  </div>
                  <div className="font-display mt-1 text-2xl font-extrabold tabular-nums text-[var(--fg-primary)]">
                    {summary.suppressionRecommendations.currentlySuppressedCount.toLocaleString()}
                  </div>
                </div>
                <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-well)] p-3">
                  <div className="text-xs font-medium text-[var(--fg-secondary)]">
                    Protected VIP
                  </div>
                  <div className="font-display mt-1 text-2xl font-extrabold tabular-nums text-[var(--fg-primary)]">
                    {summary.suppressionRecommendations.protectedVipOrPaidCount.toLocaleString()}
                  </div>
                </div>
              </div>
              <div className="text-xs text-[var(--fg-secondary)]">
                Recommended Safe Suppression:{' '}
                <strong>
                  {summary.suppressionRecommendations.recommendedCount}
                </strong>{' '}
                • Currently Suppressed:{' '}
                {summary.suppressionRecommendations.currentlySuppressedCount} •
                Protected VIP/Paid:{' '}
                {summary.suppressionRecommendations.protectedVipOrPaidCount}
              </div>
            </CardContent>
          </Card>

          {/* 5. Before & After Comparison */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <StatusDot tone="teal" />
                  <CardTitle>5. Before &amp; After Audience Comparison</CardTitle>
                </div>
                <Badge tone="emerald">
                  {
                    summary.beforeAfterComparison
                      .estimatedRoutineSendReductionPct
                  }
                  % Reduction
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-well)] p-3">
                  <div className="text-xs font-medium text-[var(--fg-secondary)]">
                    Baseline Confirmed
                  </div>
                  <div className="font-display mt-1 text-2xl font-extrabold tabular-nums text-[var(--fg-primary)]">
                    {summary.beforeAfterComparison.baselineConfirmedRecipients.toLocaleString()}
                  </div>
                </div>
                <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-well)] p-3">
                  <div className="text-xs font-medium text-[var(--fg-secondary)]">
                    Clean Send Audience
                  </div>
                  <div className="font-display mt-1 text-2xl font-extrabold tabular-nums text-[var(--accent-fg)]">
                    {summary.beforeAfterComparison.currentRecommendedCleanRecipients.toLocaleString()}
                  </div>
                </div>
              </div>
              <div className="text-xs text-[var(--fg-secondary)]">
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
                </strong>{' '}
                (Estimated DirectMail send reduction:{' '}
                {
                  summary.beforeAfterComparison
                    .estimatedRoutineSendReductionPct
                }
                %)
              </div>
            </CardContent>
          </Card>

          {/* 6. Data Quality & Confidence */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <StatusDot tone="sky" />
                  <CardTitle>6. Data Quality &amp; Confidence</CardTitle>
                </div>
                <a
                  href={csvHref('DATA_QUALITY')}
                  className="font-display inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-1.5 text-xs font-bold text-[var(--fg-primary)] transition-colors hover:bg-[var(--bg-elevated)]"
                >
                  <Download className="h-3.5 w-3.5 text-[var(--accent-fg)]" />{' '}
                  CSV
                </a>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-well)] p-3">
                  <div className="text-xs font-medium text-[var(--fg-secondary)]">
                    Insufficient Data
                  </div>
                  <div className="font-display mt-1 text-2xl font-extrabold tabular-nums text-[var(--fg-primary)]">
                    {summary.dataQuality.insufficientDataCount.toLocaleString()}
                  </div>
                </div>
                <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-well)] p-3">
                  <div className="text-xs font-medium text-[var(--fg-secondary)]">
                    Excluded Contacts
                  </div>
                  <div className="font-display mt-1 text-2xl font-extrabold tabular-nums text-[var(--fg-primary)]">
                    {summary.dataQuality.excludedCount.toLocaleString()}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--fg-secondary)]">
                <div>
                  Insufficient Data:{' '}
                  <strong>{summary.dataQuality.insufficientDataCount}</strong> •
                  Excluded: <strong>{summary.dataQuality.excludedCount}</strong>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(summary.dataQuality.confidenceCounts).map(
                    ([k, v]) => (
                      <Badge key={k} tone="slate">
                        Confidence {k}: {v}
                      </Badge>
                    )
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 7. Re-engagement Report */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <StatusDot tone="indigo" />
                  <CardTitle>7. Re-Engagement Campaigns</CardTitle>
                </div>
                <a
                  href={csvHref('REENGAGEMENT')}
                  className="font-display inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-1.5 text-xs font-bold text-[var(--fg-primary)] transition-colors hover:bg-[var(--bg-elevated)]"
                >
                  <Download className="h-3.5 w-3.5 text-[var(--accent-fg)]" />{' '}
                  CSV
                </a>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-3 gap-2.5">
                <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-well)] p-3">
                  <div className="text-xs font-medium text-[var(--fg-secondary)]">
                    Total Plans
                  </div>
                  <div className="font-display mt-1 text-2xl font-extrabold tabular-nums text-[var(--fg-primary)]">
                    {summary.reengagement.totalPlans.toLocaleString()}
                  </div>
                </div>
                <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-well)] p-3">
                  <div className="text-xs font-medium text-[var(--fg-secondary)]">
                    Recovered
                  </div>
                  <div className="font-display mt-1 text-2xl font-extrabold tabular-nums text-[var(--accent-fg)]">
                    {summary.reengagement.totalRecovered.toLocaleString()}
                  </div>
                </div>
                <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-well)] p-3">
                  <div className="text-xs font-medium text-[var(--fg-secondary)]">
                    Still Inactive
                  </div>
                  <div className="font-display mt-1 text-2xl font-extrabold tabular-nums text-[var(--fg-primary)]">
                    {summary.reengagement.totalPersistentlyInactive.toLocaleString()}
                  </div>
                </div>
              </div>
              <div className="text-xs text-[var(--fg-secondary)]">
                Plans: <strong>{summary.reengagement.totalPlans}</strong> •
                Recovered to Active:{' '}
                <strong>{summary.reengagement.totalRecovered}</strong> •
                Persistently Inactive:{' '}
                <strong>
                  {summary.reengagement.totalPersistentlyInactive}
                </strong>
              </div>
            </CardContent>
          </Card>

          {/* 8. Cleanup Execution Report */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <StatusDot tone="slate" />
                  <CardTitle>8. Cleanup Execution Log</CardTitle>
                </div>
                <a
                  href={csvHref('CLEANUP_EXECUTION')}
                  className="font-display inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-1.5 text-xs font-bold text-[var(--fg-primary)] transition-colors hover:bg-[var(--bg-elevated)]"
                >
                  <Download className="h-3.5 w-3.5 text-[var(--accent-fg)]" />{' '}
                  CSV
                </a>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-well)] p-3">
                <div className="text-xs font-medium text-[var(--fg-secondary)]">
                  Total Guarded Hygiene Operations &amp; Dry-Run Snapshots
                </div>
                <div className="font-display mt-1 text-2xl font-extrabold tabular-nums text-[var(--fg-primary)]">
                  {summary.cleanupExecution.totalOperations.toLocaleString()}
                </div>
              </div>
              <div className="text-xs text-[var(--fg-secondary)]">
                Total Operations:{' '}
                <strong>{summary.cleanupExecution.totalOperations}</strong>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
