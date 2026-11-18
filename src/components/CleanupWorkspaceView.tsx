'use client';

import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Filter,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Shield,
  Trash2,
  XCircle,
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
  EngagementClassBadge,
} from './ui';

interface ListOption {
  id: string;
  customerConnectionId?: string;
  listUid: string;
  name: string;
  syncedSubscriberCount: number;
}

interface FilterRow {
  id: string;
  field: string;
  op: string;
  value: string;
}

interface MatchedSubscriber {
  id: string;
  subscriberUid: string;
  listName: string;
  email: string;
  status: string;
  engagementStatus: string;
  engagementReason: string | null;
  engagementConfidence: string;
  historyCoverage: string;
  deliveredCampaignsCount: number;
  opensCount: number;
  clicksCount: number;
  source: string | null;
  isSuppressed: boolean;
  isVip: boolean;
  hasPaidRelationship: boolean;
}

interface DryRunPreview {
  operationId: string;
  status: string;
  dryRunOnly: boolean;
  matchedCount: number;
  eligibleCount: number;
  excludedCount: number;
  dryRunReport: {
    actionType: string;
    expectedConfirmListName: string;
    requiresLargeBatchApproval: boolean;
    largeChangeThreshold: number;
    remoteMutationsEnabled: boolean;
    isRemoteAction: boolean;
    warnings: string[];
    exclusionBreakdown: Record<string, number>;
    batchSize: number;
    estimatedBatches: number;
    sampleEligible: Array<{
      subscriberUid: string;
      maskedEmail: string;
      engagementStatus: string;
      status: string;
      reason: string;
    }>;
  };
}

interface OperationSummary {
  id: string;
  customerConnectionId?: string;
  customerConnection?: { customerName: string } | null;
  actionType: string;
  status: string;
  dryRunOnly: boolean;
  matchedCount: number;
  eligibleCount: number;
  excludedCount: number;
  succeededCount: number;
  skippedCount: number;
  failedCount: number;
  reconciledCount: number;
  autoStopReason: string | null;
  createdAt: string;
  mailingList: { name: string } | null;
}

export function CleanupWorkspaceView({
  adminEmail,
  csrfToken,
  isDemoMode,
  phase1ReadOnly,
  connections = [],
  lists,
  initialOperations,
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
  lists: ListOption[];
  initialOperations: OperationSummary[];
}) {
  const defaultList = lists[0];
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>(
    defaultList?.customerConnectionId ?? connections[0]?.id ?? ''
  );
  const [selectedListId, setSelectedListId] = useState<string>(
    defaultList?.id ?? ''
  );
  const visibleLists = selectedConnectionId
    ? lists.filter((l) => l.customerConnectionId === selectedConnectionId)
    : lists;
  const [combinator, setCombinator] = useState<'AND' | 'OR'>('AND');
  const [rows, setRows] = useState<FilterRow[]>([
    {
      id: 'row-1',
      field: 'engagementStatus',
      op: 'in',
      value: 'INACTIVE,LONG_TERM_INACTIVE,NEVER_ENGAGED',
    },
    { id: 'row-2', field: 'status', op: 'eq', value: 'CONFIRMED' },
  ]);

  const [filtering, setFiltering] = useState(false);
  const [matchedCount, setMatchedCount] = useState<number | null>(null);
  const [breakdown, setBreakdown] = useState<Record<string, number>>({});
  const [subscribers, setSubscribers] = useState<MatchedSubscriber[]>([]);
  const [filterError, setFilterError] = useState<string | null>(null);

  const [actionType, setActionType] = useState<string>('SUPPRESS');
  const [targetListUid, setTargetListUid] = useState<string>('');
  const [targetSegmentName, setTargetSegmentName] = useState<string>(
    'Hygiene Clean Segment'
  );
  const [newListName, setNewListName] = useState<string>('');
  const [newListFromName, setNewListFromName] =
    useState<string>('Acme Marketing');
  const [newListFromEmail, setNewListFromEmail] = useState<string>(
    'newsletter@example.com'
  );
  const [newListReplyTo, setNewListReplyTo] = useState<string>(
    'support@example.com'
  );
  const [batchSize, setBatchSize] = useState<number>(25);

  const [previewLoading, setPreviewLoading] = useState(false);
  const [preview, setPreview] = useState<DryRunPreview | null>(null);
  const [confirmListName, setConfirmListName] = useState('');
  const [confirmCount, setConfirmCount] = useState('');
  const [largeBatchApproved, setLargeBatchApproved] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [operations, setOperations] =
    useState<OperationSummary[]>(initialOperations);

  function addFilterRow() {
    setRows((prev) => [
      ...prev,
      {
        id: `row-${prev.length + 1}-${Math.random().toString(36).slice(2, 6)}`,
        field: 'deliveredCampaignsCount',
        op: 'gte',
        value: '5',
      },
    ]);
  }

  function removeFilterRow(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  function buildFilterPayload() {
    const conditions = rows
      .filter((r) => r.value.trim().length > 0 || r.op === 'isNull')
      .map((r) => {
        if (
          r.field === 'engagementStatus' ||
          r.field === 'status' ||
          r.field === 'engagementConfidence'
        ) {
          const arr = r.value
            .split(',')
            .map((v) => v.trim().toUpperCase())
            .filter(Boolean);
          return {
            field: r.field,
            op: r.op === 'neq' ? 'neq' : 'in',
            value: arr,
          };
        }
        if (
          r.field === 'daysSinceLastEngagement' ||
          r.field === 'daysSinceSignup' ||
          r.field === 'deliveredCampaignsCount' ||
          r.field === 'opensCount' ||
          r.field === 'clicksCount'
        ) {
          return {
            field: r.field,
            op: r.op,
            ...(r.op === 'isNull' ? {} : { value: Number(r.value) || 0 }),
          };
        }
        if (
          r.field === 'isProtectedOrVip' ||
          r.field === 'isSuppressed' ||
          r.field === 'isArchived'
        ) {
          return {
            field: r.field,
            op: 'eq',
            value: r.value.trim().toLowerCase() === 'true',
          };
        }
        if (r.field === 'emailDomain') {
          return {
            field: 'emailDomain',
            op: r.op === 'contains' ? 'contains' : 'in',
            value: r.value
              .split(',')
              .map((v) => v.trim())
              .filter(Boolean),
          };
        }
        return {
          field: r.field,
          op: r.op,
          value: r.value.trim(),
        };
      });

    return { combinator, conditions };
  }

  async function runFilterQuery() {
    setFiltering(true);
    setFilterError(null);
    setPreview(null);
    try {
      const res = await fetch('/api/subscribers/filter', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({
          customerConnectionId: selectedConnectionId || undefined,
          filter: buildFilterPayload(),
          mailingListId: selectedListId || undefined,
          page: 1,
          pageSize: 25,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Filter query failed.');
      setMatchedCount(json.totalMatched);
      setBreakdown(json.byEngagementStatus ?? {});
      setSubscribers(json.subscribers ?? []);
    } catch (err) {
      setFilterError(err instanceof Error ? err.message : 'Query failed.');
    } finally {
      setFiltering(false);
    }
  }

  async function refreshOperations(connId = selectedConnectionId) {
    const url = connId
      ? `/api/cleanup/preview?customerConnectionId=${encodeURIComponent(connId)}`
      : '/api/cleanup/preview';
    const res = await fetch(url);
    if (res.ok) {
      const json = await res.json();
      setOperations(json.operations ?? []);
    }
  }

  async function runDryRunPreview() {
    setPreviewLoading(true);
    setActionErr(null);
    setActionMsg(null);
    try {
      const payload: Record<string, unknown> = {
        customerConnectionId: selectedConnectionId || undefined,
        actionType,
        filter: buildFilterPayload(),
        mailingListId: selectedListId || undefined,
        batchSize,
      };
      if (actionType === 'COPY_SUBSCRIBERS' && targetListUid) {
        payload.targetListUid = targetListUid;
      }
      if (actionType === 'CREATE_SEGMENT') {
        payload.targetSegmentName = targetSegmentName;
      }
      if (actionType === 'CREATE_LIST') {
        payload.newListConfig = {
          name: newListName || 'Engaged Clean List',
          description: 'Verified engaged segment created cleanly',
          fromName: newListFromName,
          fromEmail: newListFromEmail,
          replyTo: newListReplyTo,
        };
      }

      const res = await fetch('/api/cleanup/preview', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Dry run failed.');
      setPreview(json);
      setConfirmListName('');
      setConfirmCount('');
      setLargeBatchApproved(false);
      await refreshOperations();
    } catch (err) {
      setActionErr(
        err instanceof Error ? err.message : 'Dry-run preview failed.'
      );
    } finally {
      setPreviewLoading(false);
    }
  }

  async function confirmAndExecute() {
    if (!preview) return;
    setActionErr(null);
    setActionMsg(null);
    try {
      const res = await fetch('/api/cleanup/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({
          operationId: preview.operationId,
          confirmedListName: confirmListName,
          confirmedCount: Number(confirmCount),
          largeBatchApproved,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Confirmation failed.');
      setActionMsg(
        `Operation ${json.operationId} confirmed and queued as background job ${json.syncJobId}.`
      );
      await refreshOperations();
    } catch (err) {
      setActionErr(err instanceof Error ? err.message : 'Confirmation failed.');
    }
  }

  async function runOperationControl(
    opId: string,
    action: 'PAUSE' | 'RESUME' | 'CANCEL' | 'RESTORE_SUPPRESSION'
  ) {
    setActionErr(null);
    setActionMsg(null);
    try {
      const res = await fetch(`/api/cleanup/${opId}/action`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({
          action,
          adminApproved: action === 'RESTORE_SUPPRESSION',
          reason: 'Administrator recovery action from Cleanup Console',
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `${action} failed.`);
      setActionMsg(`Operation ${opId}: ${action} completed cleanly.`);
      await refreshOperations();
    } catch (err) {
      setActionErr(err instanceof Error ? err.message : `${action} failed.`);
    }
  }

  async function toggleProtection(
    subId: string,
    field: 'isVip' | 'hasPaidRelationship',
    nextVal: boolean
  ) {
    await fetch('/api/subscribers/filter', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify({ subscriberId: subId, [field]: nextVal }),
    });
    await runFilterQuery();
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
              <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-white">
                <Filter className="h-3 w-3 text-indigo-400" />
                Hygiene Automation Engine
              </span>
            </div>
            <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-slate-900">
              Smart Filter &amp; Safe Cleanup Engine
            </h1>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-600">
              Filter by engagement classification, delivery evidence, and VIP
              protections using AND/OR logic. All hygiene actions default to{' '}
              <strong>DRY RUN</strong> with AES-256-GCM encrypted pre-change
              snapshots before any execution.
            </p>
          </div>
          <Badge tone={phase1ReadOnly ? 'emerald' : 'amber'}>
            <Shield className="h-3.5 w-3.5" />
            {phase1ReadOnly
              ? 'Remote MailWizz Mutations Locked (Local Suppression & Dry Run Active)'
              : 'Remote MailWizz Mutations Enabled'}
          </Badge>
        </div>

        <AgentWorkflowStrip
          activeStage="review"
          phase1ReadOnly={phase1ReadOnly}
        />

        {/* Step 1: Smart Filter Builder */}
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle>1. Smart Subscriber Filter (AND / OR)</CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                {connections.length > 0 && (
                  <>
                    <label
                      className="text-xs font-medium text-slate-600"
                      htmlFor="cleanup-customer-scope"
                    >
                      Customer:
                    </label>
                    <select
                      id="cleanup-customer-scope"
                      data-testid="cleanup-customer-selector"
                      value={selectedConnectionId}
                      onChange={(e) => {
                        const nextConn = e.target.value;
                        setSelectedConnectionId(nextConn);
                        const firstForConn = nextConn
                          ? lists.find(
                              (l) => l.customerConnectionId === nextConn
                            )
                          : lists[0];
                        setSelectedListId(firstForConn?.id ?? '');
                        void refreshOperations(nextConn);
                      }}
                      className="rounded-lg border border-slate-300/90 bg-white px-2.5 py-1.5 text-xs font-medium"
                    >
                      <option value="">All Customers</option>
                      {connections.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.customerName}
                        </option>
                      ))}
                    </select>
                  </>
                )}
                <label
                  className="text-xs font-medium text-slate-600"
                  htmlFor="list-scope"
                >
                  List Scope:
                </label>
                <select
                  id="list-scope"
                  value={selectedListId}
                  onChange={(e) => setSelectedListId(e.target.value)}
                  className="rounded-lg border border-slate-300/90 bg-white px-2.5 py-1.5 text-xs font-medium"
                >
                  <option value="">
                    All Mailing Lists ({visibleLists.length})
                  </option>
                  {visibleLists.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name} ({l.syncedSubscriberCount})
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Filter logic combinator"
                  value={combinator}
                  onChange={(e) =>
                    setCombinator(e.target.value as 'AND' | 'OR')
                  }
                  className="rounded-lg border border-slate-300/90 bg-white px-2.5 py-1.5 text-xs font-semibold"
                >
                  <option value="AND">Match ALL rules (AND)</option>
                  <option value="OR">Match ANY rule (OR)</option>
                </select>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {rows.map((row) => (
              <div
                key={row.id}
                className="grid grid-cols-1 gap-2 rounded-lg border border-slate-200/80 bg-slate-50/60 p-2.5 sm:grid-cols-12"
              >
                <select
                  value={row.field}
                  onChange={(e) =>
                    setRows((prev) =>
                      prev.map((r) =>
                        r.id === row.id ? { ...r, field: e.target.value } : r
                      )
                    )
                  }
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium sm:col-span-4"
                >
                  <option value="engagementStatus">Engagement Status</option>
                  <option value="daysSinceLastEngagement">
                    Days Since Last Engagement
                  </option>
                  <option value="daysSinceSignup">Days Since Signup</option>
                  <option value="deliveredCampaignsCount">
                    Delivered Campaigns Count
                  </option>
                  <option value="opensCount">Unique Opens</option>
                  <option value="clicksCount">Unique Clicks</option>
                  <option value="emailDomain">Email Domain</option>
                  <option value="status">MailWizz Status</option>
                  <option value="source">Source / Signup Method</option>
                  <option value="engagementConfidence">
                    Engagement Confidence
                  </option>
                  <option value="isProtectedOrVip">
                    Protected / VIP Status
                  </option>
                  <option value="isSuppressed">Application Suppressed</option>
                  <option value="isArchived">Logically Archived</option>
                </select>

                <select
                  value={row.op}
                  onChange={(e) =>
                    setRows((prev) =>
                      prev.map((r) =>
                        r.id === row.id ? { ...r, op: e.target.value } : r
                      )
                    )
                  }
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium sm:col-span-3"
                >
                  <option value="in">is / in</option>
                  <option value="eq">equals</option>
                  <option value="neq">is not</option>
                  <option value="gte">&gt;= (at least)</option>
                  <option value="lte">&lt;= (at most)</option>
                  <option value="contains">contains</option>
                  <option value="isNull">none recorded</option>
                </select>

                <input
                  type="text"
                  value={row.value}
                  disabled={row.op === 'isNull'}
                  placeholder="Value (comma-separated for in)"
                  onChange={(e) =>
                    setRows((prev) =>
                      prev.map((r) =>
                        r.id === row.id ? { ...r, value: e.target.value } : r
                      )
                    )
                  }
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs sm:col-span-4"
                />

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeFilterRow(row.id)}
                  className="sm:col-span-1"
                  aria-label="Remove rule"
                >
                  <Trash2 className="h-4 w-4 text-slate-500" />
                </Button>
              </div>
            ))}

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addFilterRow}
              >
                <Plus className="h-4 w-4" />
                Add Filter Rule
              </Button>
              <Button
                type="button"
                onClick={runFilterQuery}
                disabled={filtering}
              >
                {filtering
                  ? 'Counting Matching Subscribers...'
                  : 'Preview Exact Match Count'}
              </Button>
            </div>

            {filterError && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-800">
                {filterError}
              </div>
            )}

            {matchedCount !== null && (
              <div className="rounded-xl border border-slate-200/90 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-slate-900">
                    Exact Match Count:{' '}
                    <span
                      className="font-mono text-base text-indigo-600"
                      data-testid="matched-count"
                    >
                      {matchedCount.toLocaleString()}
                    </span>{' '}
                    subscriber(s)
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(breakdown).map(([k, v]) => (
                      <Badge key={k} tone="slate">
                        {k}: {v}
                      </Badge>
                    ))}
                  </div>
                </div>

                {subscribers.length > 0 && (
                  <div className="mt-3 overflow-x-auto">
                    <table className="min-w-full divide-y divide-slate-200 text-xs">
                      <thead className="bg-slate-50/80 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                        <tr>
                          <th className="px-2.5 py-2">Email</th>
                          <th className="px-2.5 py-2">Class</th>
                          <th className="px-2.5 py-2">Confidence</th>
                          <th className="px-2.5 py-2">
                            Delivered / Open / Click
                          </th>
                          <th className="px-2.5 py-2">State</th>
                          <th className="px-2.5 py-2">Explanation</th>
                          <th className="px-2.5 py-2">Protection</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {subscribers.slice(0, 12).map((s) => (
                          <tr key={s.id} className="hover:bg-slate-50/70">
                            <td className="px-2.5 py-2 font-medium text-slate-800">
                              {s.email}
                            </td>
                            <td className="px-2.5 py-2">
                              <EngagementClassBadge
                                status={s.engagementStatus}
                              />
                            </td>
                            <td className="px-2.5 py-2 text-slate-600">
                              {s.engagementConfidence}
                            </td>
                            <td className="px-2.5 py-2 tabular-nums text-slate-700">
                              {s.deliveredCampaignsCount} / {s.opensCount} /{' '}
                              {s.clicksCount}
                            </td>
                            <td className="px-2.5 py-2">
                              {s.isSuppressed ? (
                                <Badge tone="amber">Suppressed</Badge>
                              ) : (
                                <Badge tone="slate">{s.status}</Badge>
                              )}
                            </td>
                            <td className="max-w-xs px-2.5 py-2 text-slate-600">
                              {s.engagementReason}
                            </td>
                            <td className="px-2.5 py-2">
                              <button
                                type="button"
                                onClick={() =>
                                  toggleProtection(s.id, 'isVip', !s.isVip)
                                }
                                className="rounded-md border border-slate-300 bg-white px-2 py-0.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                              >
                                {s.isVip ? 'Remove VIP' : 'Mark VIP'}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Step 2: Action & Dry-Run Safety Wizard */}
        <Card>
          <CardHeader>
            <CardTitle>2. Action Plan (Dry-Run Preview First)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label
                  htmlFor="cleanup-action"
                  className="block text-xs font-medium text-slate-700"
                >
                  Hygiene Operation
                </label>
                <select
                  id="cleanup-action"
                  value={actionType}
                  onChange={(e) => setActionType(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="SUPPRESS">
                    Suppress from Routine Sends (Recommended Default)
                  </option>
                  <option value="ARCHIVE">
                    Logical Archive in App (+ Suppress)
                  </option>
                  <option value="UNSUBSCRIBE">
                    Bulk Unsubscribe via MailWizz API (Explicit Confirmation)
                  </option>
                  <option value="CREATE_SEGMENT">
                    Create / Update MailWizz Segment
                  </option>
                  <option value="CREATE_LIST">
                    Create Clean MailWizz List (Preserve Sender &amp; Opt-In)
                  </option>
                  <option value="COPY_SUBSCRIBERS">
                    Copy Eligible Confirmed Contacts to List
                  </option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="batch-size"
                  className="block text-xs font-medium text-slate-700"
                >
                  Batch Size (5–50)
                </label>
                <input
                  id="batch-size"
                  type="number"
                  min={5}
                  max={50}
                  value={batchSize}
                  onChange={(e) => setBatchSize(Number(e.target.value) || 25)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                />
              </div>

              {actionType === 'CREATE_SEGMENT' && (
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    MailWizz Segment Name
                  </label>
                  <input
                    type="text"
                    value={targetSegmentName}
                    onChange={(e) => setTargetSegmentName(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  />
                </div>
              )}

              {actionType === 'COPY_SUBSCRIBERS' && (
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    Target List UID (Single Opt-In Required)
                  </label>
                  <input
                    type="text"
                    value={targetListUid}
                    onChange={(e) => setTargetListUid(e.target.value)}
                    placeholder="Target MailWizz list_uid"
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  />
                </div>
              )}
            </div>

            {actionType === 'CREATE_LIST' && (
              <div className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3 sm:grid-cols-4">
                <input
                  type="text"
                  placeholder="New list name"
                  value={newListName}
                  onChange={(e) => setNewListName(e.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
                />
                <input
                  type="text"
                  placeholder="From name"
                  value={newListFromName}
                  onChange={(e) => setNewListFromName(e.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
                />
                <input
                  type="email"
                  placeholder="From email"
                  value={newListFromEmail}
                  onChange={(e) => setNewListFromEmail(e.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
                />
                <input
                  type="email"
                  placeholder="Reply-to email"
                  value={newListReplyTo}
                  onChange={(e) => setNewListReplyTo(e.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
                />
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                onClick={runDryRunPreview}
                disabled={previewLoading}
              >
                {previewLoading
                  ? 'Running Safety Checks & Snapshot...'
                  : 'Generate Dry-Run Preview & Encrypted Snapshot'}
              </Button>
            </div>

            {actionErr && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-800">
                {actionErr}
              </div>
            )}
            {actionMsg && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
                {actionMsg}
              </div>
            )}

            {preview && (
              <div className="space-y-4 rounded-xl border border-slate-200/90 bg-slate-50/60 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/70 pb-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">
                      Dry-Run Report Ready ({preview.dryRunReport.actionType})
                    </h3>
                    <p className="text-xs text-slate-600">
                      AES-256-GCM pre-change snapshot encrypted. Batches:{' '}
                      {preview.dryRunReport.estimatedBatches} ×{' '}
                      {preview.dryRunReport.batchSize}
                    </p>
                  </div>
                  <a
                    href={`/api/cleanup/${preview.operationId}?format=csv`}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download Dry-Run CSV
                  </a>
                </div>

                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="rounded-lg border border-slate-200/80 bg-white p-3">
                    <div className="text-xs text-slate-500">Matched</div>
                    <div className="mt-0.5 text-xl font-semibold tabular-nums text-slate-900">
                      {preview.matchedCount}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200/80 bg-white p-3">
                    <div className="text-xs text-emerald-700">Eligible</div>
                    <div className="mt-0.5 text-xl font-semibold tabular-nums text-emerald-700">
                      {preview.eligibleCount}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200/80 bg-white p-3">
                    <div className="text-xs text-amber-700">
                      Safety Excluded
                    </div>
                    <div className="mt-0.5 text-xl font-semibold tabular-nums text-amber-700">
                      {preview.excludedCount}
                    </div>
                  </div>
                </div>

                {preview.dryRunReport.warnings.length > 0 && (
                  <div className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                    {preview.dryRunReport.warnings.map((w, idx) => (
                      <div key={idx} className="flex items-start gap-2">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>{w}</span>
                      </div>
                    ))}
                  </div>
                )}

                {Object.keys(preview.dryRunReport.exclusionBreakdown).length >
                  0 && (
                  <div className="rounded-lg border border-slate-200/80 bg-white p-3 text-xs">
                    <div className="font-semibold text-slate-700">
                      Safety Exclusion Breakdown:
                    </div>
                    <ul className="mt-1 space-y-0.5 text-slate-600">
                      {Object.entries(
                        preview.dryRunReport.exclusionBreakdown
                      ).map(([reason, cnt]) => (
                        <li key={reason}>
                          • {reason}: <strong>{cnt}</strong>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="space-y-3 rounded-lg border border-slate-200/90 bg-white p-4">
                  <div className="text-xs font-semibold text-slate-800">
                    Explicit Administrator Confirmation Required Before
                    Execution
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs text-slate-600">
                        Type exact list name:{' '}
                        <code className="rounded bg-slate-100 px-1 py-0.5 font-semibold">
                          {preview.dryRunReport.expectedConfirmListName}
                        </code>
                      </label>
                      <input
                        type="text"
                        value={confirmListName}
                        onChange={(e) => setConfirmListName(e.target.value)}
                        placeholder="Confirm list name"
                        className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-600">
                        Type exact eligible count:{' '}
                        <code className="rounded bg-slate-100 px-1 py-0.5 font-semibold">
                          {preview.eligibleCount}
                        </code>
                      </label>
                      <input
                        type="number"
                        value={confirmCount}
                        onChange={(e) => setConfirmCount(e.target.value)}
                        placeholder="Confirm eligible count"
                        className="mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
                      />
                    </div>
                  </div>

                  {preview.dryRunReport.requiresLargeBatchApproval && (
                    <label className="flex items-center gap-2 text-xs font-medium text-amber-900">
                      <input
                        type="checkbox"
                        checked={largeBatchApproved}
                        onChange={(e) =>
                          setLargeBatchApproved(e.target.checked)
                        }
                      />
                      Large-batch approval: I confirm modifying{' '}
                      {preview.eligibleCount} records (&ge;{' '}
                      {preview.dryRunReport.largeChangeThreshold} threshold).
                    </label>
                  )}

                  <Button type="button" onClick={confirmAndExecute}>
                    <CheckCircle2 className="h-4 w-4" />
                    Confirm &amp; Queue Resumable Batch Job
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Step 3: Batch Job Ledger & Recovery Controls */}
        <Card>
          <CardHeader>
            <CardTitle>
              3. Cleanup Operations, Checkpoints &amp; Recovery
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-xs">
                <thead className="bg-slate-50/80 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Action</th>
                    <th className="px-4 py-3">List</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">
                      Counts (Elig / Ok / Skip / Fail)
                    </th>
                    <th className="px-4 py-3">Controls</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {operations.map((op) => (
                    <tr key={op.id} className="hover:bg-slate-50/60">
                      <td className="px-4 py-3 font-medium text-slate-900">
                        {op.actionType}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {op.mailingList?.name ?? 'Multi-list'}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          dot
                          tone={
                            op.status === 'COMPLETED'
                              ? 'emerald'
                              : op.status === 'AUTO_STOPPED' ||
                                  op.status === 'FAILED'
                                ? 'rose'
                                : op.status === 'PAUSED'
                                  ? 'amber'
                                  : 'slate'
                          }
                        >
                          {op.status}
                        </Badge>
                        {op.autoStopReason && (
                          <div className="mt-1 text-rose-700">
                            {op.autoStopReason}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-slate-700">
                        {op.eligibleCount} / {op.succeededCount} /{' '}
                        {op.skippedCount} / {op.failedCount}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1.5">
                          <a
                            href={`/api/cleanup/${op.id}?format=csv`}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 font-medium text-slate-700 hover:bg-slate-50"
                          >
                            <Download className="h-3 w-3" />
                            CSV
                          </a>
                          {(op.status === 'RUNNING' ||
                            op.status === 'CONFIRMED') && (
                            <button
                              type="button"
                              onClick={() =>
                                runOperationControl(op.id, 'PAUSE')
                              }
                              className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 font-medium text-amber-900"
                            >
                              <Pause className="h-3 w-3" />
                              Pause
                            </button>
                          )}
                          {(op.status === 'PAUSED' ||
                            op.status === 'AUTO_STOPPED') && (
                            <button
                              type="button"
                              onClick={() =>
                                runOperationControl(op.id, 'RESUME')
                              }
                              className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 font-medium text-emerald-900"
                            >
                              <Play className="h-3 w-3" />
                              Resume
                            </button>
                          )}
                          {op.status !== 'COMPLETED' &&
                            op.status !== 'CANCELLED' && (
                              <button
                                type="button"
                                onClick={() =>
                                  runOperationControl(op.id, 'CANCEL')
                                }
                                className="inline-flex items-center gap-1 rounded-md border border-rose-300 bg-rose-50 px-2 py-1 font-medium text-rose-900"
                              >
                                <XCircle className="h-3 w-3" />
                                Cancel
                              </button>
                            )}
                          {(op.actionType === 'SUPPRESS' ||
                            op.actionType === 'ARCHIVE') &&
                            op.status === 'COMPLETED' && (
                              <button
                                type="button"
                                onClick={() =>
                                  runOperationControl(
                                    op.id,
                                    'RESTORE_SUPPRESSION'
                                  )
                                }
                                className="inline-flex items-center gap-1 rounded-md border border-indigo-300 bg-indigo-50 px-2 py-1 font-medium text-indigo-900"
                              >
                                <RotateCcw className="h-3 w-3" />
                                Restore Suppressions
                              </button>
                            )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {operations.length === 0 && (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-4 py-6 text-center text-slate-500"
                      >
                        No cleanup operations created yet. Run a dry-run preview
                        above.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
