'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Search,
} from 'lucide-react';
import { AppShell } from './AppShell';
import {
  Badge,
  Button,
  Card,
  HygieneStatusBadge,
  StatusDot,
  type BadgeTone,
} from './ui';

interface ListDetailResponse {
  list: {
    id: string;
    listUid: string;
    name: string;
    displayName: string | null;
    description: string | null;
    syncedSubscriberCount: number;
    apiReportedCount: number | null;
    confirmedCount: number;
    unconfirmedCount: number;
    unsubscribedCount: number;
    blacklistedCount: number;
    hardBouncedCount: number;
    complaintCount: number;
    reconciliationStatus: string;
    reconciliationNote: string | null;
    isDemoData: boolean;
    segments: Array<{
      id: string;
      segmentUid: string;
      name: string;
      operatorMatch: string | null;
      apiSubscribersCount: number | null;
      conditionsJson: unknown;
      campaignConditionsJson: unknown;
    }>;
  };
  hygieneCounts: Record<string, number>;
  pagination: {
    page: number;
    pageSize: number;
    totalMatched: number;
    totalPages: number;
  };
  subscribers: Array<{
    id: string;
    subscriberUid: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    status: string;
    source: string | null;
    hygieneStatus: string;
    hygieneReason: string | null;
    historyCoverage: string;
    deliveredCampaignsCount: number;
    opensCount: number;
    clicksCount: number;
    hardBouncesCount: number;
    lastOpenAt: string | null;
    lastStrongEngagementAt: string | null;
  }>;
}

export function ListDetailView({
  adminEmail,
  csrfToken,
  listId,
  phase1ReadOnly,
}: {
  adminEmail: string;
  csrfToken: string;
  listId: string;
  phase1ReadOnly: boolean;
}) {
  const [data, setData] = useState<ListDetailResponse | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [hygieneFilter, setHygieneFilter] = useState('ALL');
  const [sortBy, setSortBy] = useState('hygieneStatus');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams({
        page: String(page),
        pageSize: '25',
        sortBy,
        sortDir,
        status: statusFilter,
        hygiene: hygieneFilter,
      });
      if (query.trim()) sp.set('q', query.trim());
      const res = await fetch(
        `/api/lists/${encodeURIComponent(listId)}?${sp.toString()}`
      );
      if (res.ok) {
        setData((await res.json()) as ListDetailResponse);
      }
    } finally {
      setLoading(false);
    }
  }, [listId, page, sortBy, sortDir, statusFilter, hygieneFilter, query]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadList();
    }, 150);
    return () => clearTimeout(timer);
  }, [loadList]);

  function toggleSort(field: string) {
    setPage(1);
    if (sortBy === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortDir('asc');
    }
  }

  return (
    <AppShell
      adminEmail={adminEmail}
      csrfToken={csrfToken}
      isDemoMode={data?.list.isDemoData}
      phase1ReadOnly={phase1ReadOnly}
    >
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 pb-5">
          <div>
            <Link
              href="/"
              className="mb-1 inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to Overview
            </Link>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
                {data?.list.name ?? 'Loading list...'}
              </h1>
              {data?.list.isDemoData && <Badge tone="amber">Demo Data</Badge>}
            </div>
            {data && (
              <p className="mt-0.5 text-xs text-slate-500">
                UID: <code className="font-mono">{data.list.listUid}</code> •{' '}
                {data.list.reconciliationNote}
              </p>
            )}
          </div>

          {data && (
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={`/api/exports/subscribers?listId=${encodeURIComponent(data.list.id)}&format=csv&encrypted=true${
                  hygieneFilter !== 'ALL'
                    ? `&hygieneStatus=${hygieneFilter}`
                    : ''
                }`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300/90 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-2xs hover:bg-slate-50"
              >
                <Download className="h-3.5 w-3.5" />
                Encrypted Export
              </a>
              <a
                href={`/api/exports/subscribers?listId=${encodeURIComponent(data.list.id)}&format=csv&encrypted=false${
                  hygieneFilter !== 'ALL'
                    ? `&hygieneStatus=${hygieneFilter}`
                    : ''
                }`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300/90 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-2xs hover:bg-slate-50"
              >
                <Download className="h-3.5 w-3.5" />
                CSV Export
              </a>
            </div>
          )}
        </div>

        {/* List Hygiene Breakdown Pills */}
        {data && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {(
              [
                {
                  label: 'Engaged (Click+)',
                  key: 'ENGAGED_STRONG',
                  tone: 'emerald' as BadgeTone,
                },
                {
                  label: 'Open-Only',
                  key: 'ENGAGED_OPEN_ONLY',
                  tone: 'teal' as BadgeTone,
                },
                {
                  label: 'Potentially Inactive',
                  key: 'INACTIVE_CANDIDATE',
                  tone: 'amber' as BadgeTone,
                },
                {
                  label: 'Insufficient History',
                  key: 'INSUFFICIENT_HISTORY',
                  tone: 'sky' as BadgeTone,
                },
                {
                  label: 'UNKNOWN History',
                  key: 'UNKNOWN',
                  tone: 'slate' as BadgeTone,
                },
                {
                  label: 'Hard Bounced',
                  key: 'HARD_BOUNCED',
                  tone: 'rose' as BadgeTone,
                },
              ] as const
            ).map((item) => (
              <Card key={item.key} className="p-3.5">
                <div className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                  <StatusDot tone={item.tone} />
                  <span className="truncate">{item.label}</span>
                </div>
                <div className="mt-1.5 text-xl font-semibold tabular-nums text-slate-900">
                  {(data.hygieneCounts[item.key] ?? 0).toLocaleString()}
                </div>
              </Card>
            ))}
          </div>
        )}

        {/* Native MailWizz Segments */}
        {data && data.list.segments.length > 0 && (
          <Card className="p-4">
            <h2 className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-slate-700">
              Discovered MailWizz Native Segments ({data.list.segments.length})
            </h2>
            <div className="flex flex-wrap gap-2">
              {data.list.segments.map((seg) => (
                <div
                  key={seg.id}
                  className="rounded-lg border border-slate-200/80 bg-slate-50/60 px-3 py-2 text-xs"
                >
                  <div className="font-medium text-slate-900">{seg.name}</div>
                  <div className="text-slate-500">
                    UID: <code className="font-mono">{seg.segmentUid}</code> •
                    Est. subscribers: {seg.apiSubscribersCount ?? 0}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Search, Filter & Sortable Subscribers Table */}
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/60 p-4">
            <div className="relative min-w-[220px] max-w-md flex-1">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="search"
                aria-label="Search subscribers"
                value={query}
                onChange={(e) => {
                  setPage(1);
                  setQuery(e.target.value);
                }}
                placeholder="Search email, name, or subscriber UID..."
                className="w-full rounded-lg border border-slate-300/90 bg-white py-1.5 pl-9 pr-3 text-xs text-slate-900 shadow-2xs focus:border-indigo-600 focus:outline-none"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Filter by MailWizz status"
                value={statusFilter}
                onChange={(e) => {
                  setPage(1);
                  setStatusFilter(e.target.value);
                }}
                className="rounded-lg border border-slate-300/90 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-2xs"
              >
                <option value="ALL">All Statuses</option>
                <option value="CONFIRMED">Confirmed</option>
                <option value="UNCONFIRMED">Unconfirmed</option>
                <option value="UNSUBSCRIBED">Unsubscribed</option>
                <option value="BLACKLISTED">Blacklisted</option>
              </select>

              <select
                aria-label="Filter by hygiene classification"
                value={hygieneFilter}
                onChange={(e) => {
                  setPage(1);
                  setHygieneFilter(e.target.value);
                }}
                className="rounded-lg border border-slate-300/90 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-2xs"
              >
                <option value="ALL">All Hygiene Classes</option>
                <option value="ENGAGED_STRONG">Engaged (Click/Strong)</option>
                <option value="ENGAGED_OPEN_ONLY">Engaged (Open-Only)</option>
                <option value="INACTIVE_CANDIDATE">Potentially Inactive</option>
                <option value="INSUFFICIENT_HISTORY">
                  Insufficient History
                </option>
                <option value="UNKNOWN">UNKNOWN History</option>
                <option value="HARD_BOUNCED">Hard Bounced</option>
                <option value="COMPLAINED">Complained</option>
                <option value="UNSUBSCRIBED">Unsubscribed</option>
                <option value="UNCONFIRMED">Unconfirmed</option>
                <option value="EXCLUDED">Excluded</option>
              </select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-white text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => toggleSort('email')}
                      className="inline-flex items-center gap-1 hover:text-slate-900"
                    >
                      Subscriber <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </th>
                  <th className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => toggleSort('status')}
                      className="inline-flex items-center gap-1 hover:text-slate-900"
                    >
                      MailWizz Status <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </th>
                  <th className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => toggleSort('hygieneStatus')}
                      className="inline-flex items-center gap-1 hover:text-slate-900"
                    >
                      Hygiene Classification{' '}
                      <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </th>
                  <th className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => toggleSort('deliveredCampaignsCount')}
                      className="inline-flex items-center gap-1 hover:text-slate-900"
                    >
                      Delivered <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </th>
                  <th className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => toggleSort('opensCount')}
                      className="inline-flex items-center gap-1 hover:text-slate-900"
                    >
                      Opens <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </th>
                  <th className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => toggleSort('clicksCount')}
                      className="inline-flex items-center gap-1 hover:text-slate-900"
                    >
                      Clicks <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </th>
                  <th className="px-4 py-3">Reason / Coverage</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/80">
                {loading && !data ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-8 text-center text-xs text-slate-500"
                    >
                      Loading subscribers...
                    </td>
                  </tr>
                ) : !data || data.subscribers.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-8 text-center text-xs text-slate-500"
                    >
                      No subscribers match the current filters.
                    </td>
                  </tr>
                ) : (
                  data.subscribers.map((sub) => (
                    <tr
                      key={sub.id}
                      className="transition-colors hover:bg-slate-50/70"
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">
                          {sub.email}
                        </div>
                        <div className="text-xs text-slate-500">
                          {[sub.firstName, sub.lastName]
                            .filter(Boolean)
                            .join(' ') || 'No name'}{' '}
                          • <code className="font-mono">{sub.subscriberUid}</code>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs font-medium text-slate-700">
                        {sub.status}
                      </td>
                      <td className="px-4 py-3">
                        <HygieneStatusBadge status={sub.hygieneStatus} />
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {sub.deliveredCampaignsCount}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {sub.opensCount}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {sub.clicksCount}
                      </td>
                      <td className="max-w-xs px-4 py-3 text-xs text-slate-600">
                        <div>{sub.hygieneReason}</div>
                        <div className="text-[11px] text-slate-400">
                          Coverage: {sub.historyCoverage}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {data && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/60 px-4 py-3 text-xs text-slate-600">
              <div className="tabular-nums">
                Showing page {data.pagination.page} of{' '}
                {data.pagination.totalPages} (
                {data.pagination.totalMatched.toLocaleString()} matching
                subscribers)
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= data.pagination.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
