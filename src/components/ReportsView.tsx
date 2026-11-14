'use client';

import React, { useState } from 'react';
import { Download } from 'lucide-react';
import { AppShell } from './AppShell';
import { Badge, Card, CardContent, CardHeader, CardTitle } from './ui';
import type { generateAllReportsSummary } from '@/services/reports/generator';

type ReportsSummary = Awaited<ReturnType<typeof generateAllReportsSummary>>;

export function ReportsView({
  adminEmail,
  csrfToken,
  isDemoMode,
  phase1ReadOnly,
  lists,
  initialSummary,
}: {
  adminEmail: string;
  csrfToken: string;
  isDemoMode: boolean;
  phase1ReadOnly: boolean;
  lists: Array<{ id: string; name: string }>;
  initialSummary: ReportsSummary;
}) {
  const [selectedListId, setSelectedListId] = useState('');
  const [maskPii, setMaskPii] = useState(true);
  const [summary, setSummary] = useState<ReportsSummary>(initialSummary);
  const [loading, setLoading] = useState(false);

  async function reloadSummary(nextListId: string) {
    setSelectedListId(nextListId);
    setLoading(true);
    try {
      const url = nextListId
        ? `/api/reports/hygiene?mailingListId=${encodeURIComponent(nextListId)}`
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
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              Hygiene &amp; Deliverability Reports
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              On-screen analytics and CSV exports for active, inactive, never-engaged, suppression, re-engagement, cleanup reconciliation, before/after comparison, and data confidence.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
              <input
                type="checkbox"
                checked={maskPii}
                onChange={(e) => setMaskPii(e.target.checked)}
              />
              Mask emails in CSV exports
            </label>
            <select
              aria-label="Filter reports by mailing list"
              value={selectedListId}
              onChange={(e) => reloadSummary(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
            >
              <option value="">All Mailing Lists</option>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {loading && (
          <div className="text-xs text-slate-500">Refreshing report aggregates...</div>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* 1. Active Audience */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>1. Active &amp; Cooling Audience</CardTitle>
                <a
                  href={csvHref('ACTIVE_AUDIENCE')}
                  className="inline-flex items-center gap-1 text-xs font-medium text-indigo-700 hover:underline"
                >
                  <Download className="h-3.5 w-3.5" /> CSV
                </a>
              </div>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <div>
                Active: <strong>{summary.activeAudience.activeCount}</strong> • Cooling:{' '}
                <strong>{summary.activeAudience.coolingCount}</strong>
              </div>
              <div className="text-xs text-slate-600">
                Open-only (MPP caveat): {summary.activeAudience.openOnlyMppCaveatCount} •
                Click-without-open: {summary.activeAudience.clickWithoutOpenCount}
              </div>
            </CardContent>
          </Card>

          {/* 2. Inactive Audience */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>2. Inactive Audience</CardTitle>
                <a
                  href={csvHref('INACTIVE_AUDIENCE')}
                  className="inline-flex items-center gap-1 text-xs font-medium text-indigo-700 hover:underline"
                >
                  <Download className="h-3.5 w-3.5" /> CSV
                </a>
              </div>
            </CardHeader>
            <CardContent className="text-sm">
              Inactive: <strong>{summary.inactiveAudience.inactiveCount}</strong> • Long-Term
              Inactive (180+ days):{' '}
              <strong>{summary.inactiveAudience.longTermInactiveCount}</strong>
            </CardContent>
          </Card>

          {/* 3. Never Engaged */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>3. Never-Engaged Contacts</CardTitle>
                <a
                  href={csvHref('NEVER_ENGAGED')}
                  className="inline-flex items-center gap-1 text-xs font-medium text-indigo-700 hover:underline"
                >
                  <Download className="h-3.5 w-3.5" /> CSV
                </a>
              </div>
            </CardHeader>
            <CardContent className="text-sm">
              Never Engaged (sufficient deliveries, zero opens/clicks/replies):{' '}
              <strong>{summary.neverEngaged.neverEngagedCount}</strong>
            </CardContent>
          </Card>

          {/* 4. Suppression Recommendations */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>4. Suppression Recommendations</CardTitle>
                <a
                  href={csvHref('SUPPRESSION_RECOMMENDATIONS')}
                  className="inline-flex items-center gap-1 text-xs font-medium text-indigo-700 hover:underline"
                >
                  <Download className="h-3.5 w-3.5" /> CSV
                </a>
              </div>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <div>
                Recommended Safe Suppression:{' '}
                <strong>{summary.suppressionRecommendations.recommendedCount}</strong>
              </div>
              <div className="text-xs text-slate-600">
                Currently Suppressed: {summary.suppressionRecommendations.currentlySuppressedCount} •
                Protected VIP/Paid: {summary.suppressionRecommendations.protectedVipOrPaidCount}
              </div>
            </CardContent>
          </Card>

          {/* 5. Before & After Comparison */}
          <Card>
            <CardHeader>
              <CardTitle>5. Before &amp; After Audience Comparison</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <div>
                Baseline Confirmed:{' '}
                <strong>{summary.beforeAfterComparison.baselineConfirmedRecipients}</strong> →
                After Recommended Clean Sends:{' '}
                <strong>
                  {summary.beforeAfterComparison.currentRecommendedCleanRecipients}
                </strong>
              </div>
              <div className="text-xs text-slate-600">
                Estimated DirectMail send reduction:{' '}
                <Badge tone="emerald">
                  {summary.beforeAfterComparison.estimatedRoutineSendReductionPct}%
                </Badge>
              </div>
            </CardContent>
          </Card>

          {/* 6. Data Quality & Confidence */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>6. Data Quality &amp; Confidence</CardTitle>
                <a
                  href={csvHref('DATA_QUALITY')}
                  className="inline-flex items-center gap-1 text-xs font-medium text-indigo-700 hover:underline"
                >
                  <Download className="h-3.5 w-3.5" /> CSV
                </a>
              </div>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <div>
                Insufficient Data: <strong>{summary.dataQuality.insufficientDataCount}</strong>{' '}
                • Excluded: <strong>{summary.dataQuality.excludedCount}</strong>
              </div>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {Object.entries(summary.dataQuality.confidenceCounts).map(([k, v]) => (
                  <Badge key={k} tone="slate">
                    Confidence {k}: {v}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* 7. Re-engagement Report */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>7. Re-Engagement Campaigns</CardTitle>
                <a
                  href={csvHref('REENGAGEMENT')}
                  className="inline-flex items-center gap-1 text-xs font-medium text-indigo-700 hover:underline"
                >
                  <Download className="h-3.5 w-3.5" /> CSV
                </a>
              </div>
            </CardHeader>
            <CardContent className="text-sm">
              Plans: <strong>{summary.reengagement.totalPlans}</strong> • Recovered to Active:{' '}
              <strong>{summary.reengagement.totalRecovered}</strong> • Persistently Inactive:{' '}
              <strong>{summary.reengagement.totalPersistentlyInactive}</strong>
            </CardContent>
          </Card>

          {/* 8. Cleanup Execution Report */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>8. Cleanup Execution Log</CardTitle>
                <a
                  href={csvHref('CLEANUP_EXECUTION')}
                  className="inline-flex items-center gap-1 text-xs font-medium text-indigo-700 hover:underline"
                >
                  <Download className="h-3.5 w-3.5" /> CSV
                </a>
              </div>
            </CardHeader>
            <CardContent className="text-sm">
              Total Operations: <strong>{summary.cleanupExecution.totalOperations}</strong>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
