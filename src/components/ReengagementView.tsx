'use client';

import React, { useState } from 'react';
import { CheckCircle2, MailCheck, PlayCircle, Sparkles } from 'lucide-react';
import { AppShell } from './AppShell';
import {
  AgentWorkflowStrip,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from './ui';

interface PlanSummary {
  id: string;
  customerConnectionId?: string;
  customerConnection?: { customerName: string } | null;
  name: string;
  mailingListId: string;
  mailingList: { name: string; listUid: string };
  eligibleCount: number;
  excludedCount: number;
  segmentUid: string | null;
  suggestedSubject: string;
  suggestedPreviewText: string | null;
  suggestedBodyMarkdown: string;
  mailwizzCampaignUid: string | null;
  manualCampaignApproved: boolean;
  responseWindowDays: number;
  status: string;
  recoveredCount: number;
  persistentlyInactiveCount: number;
  createdAt: string;
}

export function ReengagementView({
  adminEmail,
  csrfToken,
  isDemoMode,
  phase1ReadOnly,
  connections = [],
  lists,
  initialPlans,
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
  lists: Array<{
    id: string;
    customerConnectionId?: string;
    name: string;
    listUid: string;
    syncedSubscriberCount: number;
  }>;
  initialPlans: PlanSummary[];
}) {
  const [selectedConnectionId, setSelectedConnectionId] = useState(
    lists[0]?.customerConnectionId ?? connections[0]?.id ?? ''
  );
  const visibleLists = selectedConnectionId
    ? lists.filter((l) => l.customerConnectionId === selectedConnectionId)
    : lists;
  const [plans, setPlans] = useState<PlanSummary[]>(initialPlans);
  const [name, setName] = useState('Q4 Permission Pass Re-Engagement');
  const [listId, setListId] = useState(
    visibleLists[0]?.id ?? lists[0]?.id ?? ''
  );
  const [windowDays, setWindowDays] = useState(14);
  const [campaignUids, setCampaignUids] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function refreshPlans() {
    const res = await fetch('/api/reengagement');
    if (res.ok) {
      const json = await res.json();
      setPlans(json.plans ?? []);
    }
  }

  async function createPlan(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch('/api/reengagement', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({
          customerConnectionId: selectedConnectionId || undefined,
          name,
          mailingListId: listId,
          responseWindowDays: windowDays,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to create plan.');
      setMessage(
        `Created re-engagement plan "${json.plan.name}" (${json.plan.eligibleCount} eligible inactive subscribers; ${json.plan.excludedCount} safely excluded).`
      );
      await refreshPlans();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Creation failed.');
    } finally {
      setLoading(false);
    }
  }

  async function runPlanAction(
    planId: string,
    action: 'CREATE_SEGMENT' | 'APPROVE_CAMPAIGN' | 'EVALUATE'
  ) {
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/reengagement/${planId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({
          action,
          mailwizzCampaignUid: campaignUids[planId] ?? '',
          createSuppressionDryRun: true,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `${action} failed.`);
      setMessage(`Plan updated cleanly (${json.plan.status}).`);
      await refreshPlans();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed.');
    }
  }

  return (
    <AppShell
      adminEmail={adminEmail}
      csrfToken={csrfToken}
      isDemoMode={isDemoMode}
      phase1ReadOnly={phase1ReadOnly}
    >
      <div className="space-y-6">
        <div className="border-b border-slate-200/80 pb-5">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-white">
              <MailCheck className="h-3 w-3 text-indigo-400" />
              Permission-Pass Orchestration
            </span>
          </div>
          <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-slate-900">
            Re-Engagement Workflow (Manual Campaign Approval)
          </h1>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-600">
            Identify qualifying inactive contacts while excluding unsubscribed,
            complained, bounced, and VIP contacts. Draft permission-pass
            messaging, record manual MailWizz campaign approval, and evaluate
            renewed engagement after the response window. This application never
            auto-sends emails.
          </p>
        </div>

        <AgentWorkflowStrip
          activeStage="execute"
          phase1ReadOnly={phase1ReadOnly}
        />

        <Card>
          <CardHeader>
            <CardTitle>Create Re-Engagement Plan</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={createPlan}
              className="grid grid-cols-1 gap-4 sm:grid-cols-4"
            >
              {connections.length > 0 && (
                <div className="sm:col-span-4">
                  <label
                    className="block text-xs font-medium text-slate-700"
                    htmlFor="plan-connection"
                  >
                    Customer Connection
                  </label>
                  <select
                    id="plan-connection"
                    value={selectedConnectionId}
                    onChange={(e) => {
                      const nextConn = e.target.value;
                      setSelectedConnectionId(nextConn);
                      const firstList = nextConn
                        ? lists.find((l) => l.customerConnectionId === nextConn)
                        : lists[0];
                      setListId(firstList?.id ?? '');
                    }}
                    className="mt-1 w-full max-w-md rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">All Customers</option>
                    {connections.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.customerName}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="sm:col-span-2">
                <label
                  className="block text-xs font-medium text-slate-700"
                  htmlFor="plan-name"
                >
                  Plan Name
                </label>
                <input
                  id="plan-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  required
                />
              </div>
              <div>
                <label
                  className="block text-xs font-medium text-slate-700"
                  htmlFor="plan-list"
                >
                  Target Mailing List
                </label>
                <select
                  id="plan-list"
                  value={listId}
                  onChange={(e) => setListId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  {visibleLists.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  className="block text-xs font-medium text-slate-700"
                  htmlFor="window-days"
                >
                  Response Window (Days)
                </label>
                <input
                  id="window-days"
                  type="number"
                  min={3}
                  max={90}
                  value={windowDays}
                  onChange={(e) => setWindowDays(Number(e.target.value) || 14)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="sm:col-span-4">
                <Button type="submit" disabled={loading}>
                  <Sparkles className="h-4 w-4" />
                  {loading
                    ? 'Selecting Safe Inactive Cohort...'
                    : 'Create Re-Engagement Draft'}
                </Button>
              </div>
            </form>

            {error && (
              <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-800">
                {error}
              </div>
            )}
            {message && (
              <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
                {message}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          {plans.map((p) => (
            <Card key={p.id}>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <CardTitle>{p.name}</CardTitle>
                    <p className="mt-0.5 text-xs text-slate-500">
                      List: <strong className="text-slate-700">{p.mailingList.name}</strong> • Eligible Inactive:{' '}
                      <strong className="tabular-nums text-slate-700">{p.eligibleCount}</strong> • Excluded:{' '}
                      <strong className="tabular-nums text-slate-700">{p.excludedCount}</strong> • Window:{' '}
                      {p.responseWindowDays} days
                    </p>
                  </div>
                  <Badge
                    dot
                    tone={p.status === 'EVALUATED' ? 'emerald' : 'indigo'}
                  >
                    {p.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="rounded-lg border border-slate-200/80 bg-slate-50/60 p-3">
                  <div className="text-xs font-semibold text-slate-700">
                    Suggested Subject: {p.suggestedSubject}
                  </div>
                  <pre className="mt-2 whitespace-pre-wrap font-sans text-xs leading-relaxed text-slate-600">
                    {p.suggestedBodyMarkdown}
                  </pre>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => runPlanAction(p.id, 'CREATE_SEGMENT')}
                  >
                    <MailCheck className="h-3.5 w-3.5" />
                    Create MailWizz Segment
                  </Button>

                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="MailWizz Campaign UID"
                      value={campaignUids[p.id] ?? p.mailwizzCampaignUid ?? ''}
                      onChange={(e) =>
                        setCampaignUids((prev) => ({
                          ...prev,
                          [p.id]: e.target.value,
                        }))
                      }
                      className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => runPlanAction(p.id, 'APPROVE_CAMPAIGN')}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Record Manual Campaign Approval
                    </Button>
                  </div>

                  <Button
                    type="button"
                    size="sm"
                    onClick={() => runPlanAction(p.id, 'EVALUATE')}
                  >
                    <PlayCircle className="h-3.5 w-3.5" />
                    Evaluate Response Window &amp; Prepare Suppression
                  </Button>
                </div>

                {p.status === 'EVALUATED' && (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                    Evaluated: <strong>{p.recoveredCount}</strong> restored to
                    ACTIVE • <strong>{p.persistentlyInactiveCount}</strong>{' '}
                    persistently inactive ready for safe suppression.
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
