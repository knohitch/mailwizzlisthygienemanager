'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Database,
  Lock,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Unlock,
  XCircle,
} from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, type BadgeTone } from '@/components/ui';
import type {
  CapabilityCheckEntry,
  CompatibilityCapabilityStatus,
  CompatibilityReport,
  CompatibilityVerdict,
} from '@/services/mailwizz/contracts';

interface CompatibilityDashboardPayload {
  report: CompatibilityReport;
  approvedAt: string | null;
  approvedByEmail: string | null;
  configNotes: string | null;
  phase1ReadOnly: boolean;
  isDemoMode: boolean;
}

const VERDICT_META: Record<
  CompatibilityVerdict,
  { tone: BadgeTone; bg: string; title: string; icon: React.ReactNode }
> = {
  'FULLY VERIFIED': {
    tone: 'emerald',
    bg: 'border-emerald-200 bg-emerald-50 text-emerald-950',
    title: 'MailWizz Integration Fully Verified',
    icon: <ShieldCheck className="h-6 w-6 text-emerald-700" />,
  },
  'PARTIALLY COMPATIBLE': {
    tone: 'amber',
    bg: 'border-amber-200 bg-amber-50 text-amber-950',
    title: 'Partially Compatible — Read-Only Operations Guarded',
    icon: <AlertTriangle className="h-6 w-6 text-amber-700" />,
  },
  UNVERIFIED: {
    tone: 'sky',
    bg: 'border-sky-200 bg-sky-50 text-sky-950',
    title: 'Unverified Compatibility — Run Read-Only Check Before Remote Mutations',
    icon: <ShieldAlert className="h-6 w-6 text-sky-700" />,
  },
  INCOMPATIBLE: {
    tone: 'rose',
    bg: 'border-rose-200 bg-rose-50 text-rose-950',
    title: 'Incompatible / Fail-Closed — Remote Mutations Locked',
    icon: <XCircle className="h-6 w-6 text-rose-700" />,
  },
};

function capabilityStatusBadge(status: CompatibilityCapabilityStatus) {
  switch (status) {
    case 'VERIFIED':
      return <Badge tone="emerald">VERIFIED</Badge>;
    case 'AVAILABLE_BUT_UNTESTED':
      return <Badge tone="sky">AVAILABLE BUT UNTESTED</Badge>;
    case 'UNSUPPORTED':
      return <Badge tone="rose">UNSUPPORTED</Badge>;
    case 'BLOCKED':
      return <Badge tone="amber">BLOCKED</Badge>;
    case 'UNKNOWN':
    default:
      return <Badge tone="slate">UNKNOWN</Badge>;
  }
}

function connectionStatusBadge(status: CompatibilityReport['connectionStatus']) {
  switch (status) {
    case 'CONNECTED':
      return <Badge tone="emerald">CONNECTED</Badge>;
    case 'AUTH_FAILED':
      return <Badge tone="rose">AUTH FAILED</Badge>;
    case 'UNREACHABLE':
      return <Badge tone="rose">UNREACHABLE</Badge>;
    case 'NOT_CONFIGURED':
    default:
      return <Badge tone="slate">NOT CONFIGURED</Badge>;
  }
}

function adapterModeBadge(mode: CompatibilityReport['adapterMode']) {
  switch (mode) {
    case 'VERIFIED_NATIVE':
      return <Badge tone="emerald">VERIFIED NATIVE</Badge>;
    case 'PROVISIONAL_COMPAT_READONLY':
      return <Badge tone="amber">PROVISIONAL READ-ONLY</Badge>;
    case 'RESTRICTED_SAFE_MODE':
    default:
      return <Badge tone="rose">RESTRICTED SAFE MODE</Badge>;
  }
}

export function CompatibilityView({
  adminEmail,
  csrfToken,
  initialData,
}: {
  adminEmail: string;
  csrfToken: string;
  initialData: CompatibilityDashboardPayload;
}) {
  const [data, setData] = useState<CompatibilityDashboardPayload>(initialData);
  const [configuredInput, setConfiguredInput] = useState(
    initialData.report.versionInfo.configuredVersion ?? ''
  );
  const [notesInput, setNotesInput] = useState(initialData.configNotes ?? '');
  const [busyAction, setBusyAction] = useState<'CHECK' | 'SAVE' | 'APPROVE' | null>(null);
  const [statusMessage, setStatusMessage] = useState<{
    type: 'ok' | 'error';
    text: string;
  } | null>(null);

  const report = data.report;
  const verdictMeta = VERDICT_META[report.overallStatus];

  const counts = useMemo(() => {
    const map: Record<CompatibilityCapabilityStatus, number> = {
      VERIFIED: 0,
      AVAILABLE_BUT_UNTESTED: 0,
      UNSUPPORTED: 0,
      UNKNOWN: 0,
      BLOCKED: 0,
    };
    for (const c of report.capabilities) {
      map[c.status] = (map[c.status] ?? 0) + 1;
    }
    return map;
  }, [report.capabilities]);

  const criticalSyncPassed = useMemo(
    () =>
      report.connectionStatus === 'CONNECTED' &&
      report.capabilities.filter((c) => c.criticalForSync).every((c) => c.status === 'VERIFIED'),
    [report]
  );

  const approvableVersion =
    report.versionInfo.detectedVersion ||
    report.versionInfo.configuredVersion ||
    report.versionInfo.effectiveVersion;

  async function postAction(payload: Record<string, unknown>, actionKind: 'CHECK' | 'SAVE' | 'APPROVE') {
    setBusyAction(actionKind);
    setStatusMessage(null);
    try {
      const res = await fetch('/api/compatibility', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        data?: CompatibilityDashboardPayload;
      };
      if (!res.ok || !json.data) {
        setStatusMessage({
          type: 'error',
          text: json.error || 'Compatibility request failed.',
        });
        return;
      }
      setData(json.data);
      setConfiguredInput(json.data.report.versionInfo.configuredVersion ?? '');
      setNotesInput(json.data.configNotes ?? '');
      setStatusMessage({
        type: 'ok',
        text:
          actionKind === 'CHECK'
            ? `Read-only compatibility verification completed (${json.data.report.overallStatus}).`
            : actionKind === 'SAVE'
              ? 'Administrator-configured MailWizz version saved (marked UNVERIFIED until confirmed by API/read-only verification).'
              : `Approved MailWizz version ${json.data.report.versionInfo.approvedVersion ?? ''} after verified read-only contracts.`,
      });
    } catch (err) {
      setStatusMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Network error calling /api/compatibility.',
      });
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <AppShell
      adminEmail={adminEmail}
      csrfToken={csrfToken}
      isDemoMode={data.isDemoMode}
      phase1ReadOnly={data.phase1ReadOnly}
    >
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              MailWizz Future-Version Compatibility &amp; Adapter Verification
            </h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-600">
              Detects MailWizz version drift passively from official read-only responses, validates
              data contracts without mutating remote subscribers, and enforces fail-closed mutation
              guards whenever an unverified minor or future major version appears.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={busyAction !== null}
              onClick={() => postAction({ action: 'RUN_CHECK' }, 'CHECK')}
              data-testid="run-compatibility-check"
            >
              <RefreshCw
                className={`h-4 w-4 ${busyAction === 'CHECK' ? 'animate-spin' : ''}`}
              />
              {busyAction === 'CHECK' ? 'Running Read-Only Check...' : 'Run Compatibility Check'}
            </Button>
            <Link
              href="/settings"
              className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Connection Settings
            </Link>
          </div>
        </div>

        {statusMessage && (
          <div
            role="status"
            className={`rounded-xl border px-4 py-3 text-sm ${
              statusMessage.type === 'ok'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                : 'border-rose-200 bg-rose-50 text-rose-900'
            }`}
          >
            {statusMessage.text}
          </div>
        )}

        {/* Overall Verdict Banner */}
        <div
          className={`flex flex-wrap items-center justify-between gap-4 rounded-xl border px-5 py-4 ${verdictMeta.bg}`}
          data-testid="compatibility-verdict-banner"
        >
          <div className="flex items-start gap-3">
            <div className="mt-0.5 shrink-0">{verdictMeta.icon}</div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-base font-bold">{verdictMeta.title}</span>
                <Badge tone={verdictMeta.tone}>{report.overallStatus}</Badge>
              </div>
              <p className="mt-1 text-xs opacity-90">
                Read-only contract validation never sends campaigns, copies subscribers, edits segments,
                or unsubscribes contacts. Historical engagement data stored locally remains intact across
                MailWizz upgrades.
              </p>
            </div>
          </div>
          <div className="text-right text-xs">
            <div className="font-medium">Last Verification</div>
            <div className="mt-0.5 font-mono" data-testid="last-verified-at">
              {report.lastVerifiedAt
                ? new Date(report.lastVerifiedAt).toLocaleString()
                : 'Never verified via read-only probe'}
            </div>
          </div>
        </div>

        {/* Version, Connection & Adapter Metadata Grid */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader>
              <CardTitle>Version Detection</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs text-slate-700">
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500">API-Detected Version</span>
                {report.versionInfo.detectedVersion ? (
                  <Badge tone="emerald">{report.versionInfo.detectedVersion} (Verified Signal)</Badge>
                ) : (
                  <Badge tone="slate">Not Exposed by API</Badge>
                )}
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500">Configured Version</span>
                {report.versionInfo.configuredVersion ? (
                  <Badge
                    tone={
                      report.versionInfo.verifiedByApiSignal &&
                      report.versionInfo.detectedVersion === report.versionInfo.configuredVersion
                        ? 'teal'
                        : 'amber'
                    }
                    className="max-w-[180px] truncate"
                  >
                    {report.versionInfo.configuredVersion}
                    {report.versionInfo.verifiedByApiSignal &&
                    report.versionInfo.detectedVersion === report.versionInfo.configuredVersion
                      ? ''
                      : ' (UNVERIFIED)'}
                  </Badge>
                ) : (
                  <Badge tone="slate">None Set</Badge>
                )}
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500">Approved Version</span>
                {report.versionInfo.approvedVersion ? (
                  <Badge tone="emerald">{report.versionInfo.approvedVersion}</Badge>
                ) : (
                  <Badge tone="slate">Baseline 3.0.5 Only</Badge>
                )}
              </div>
              <div className="pt-1 text-[11px] text-slate-500">
                Classification: <span className="font-mono">{report.versionInfo.parsed.classification}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Adapter &amp; Connection</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs text-slate-700">
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500">API Connection</span>
                {connectionStatusBadge(report.connectionStatus)}
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500">Adapter Mode</span>
                {adapterModeBadge(report.adapterMode)}
              </div>
              <div>
                <div className="text-slate-500">Adapter Currently in Use</div>
                <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[11px] font-semibold text-slate-900">
                  <Cpu className="h-3.5 w-3.5 text-indigo-600" />
                  {report.adapterInUse}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Remote Mutation Gate</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs text-slate-700">
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500">Remote Writes</span>
                {report.mutationSafetyAllowed ? (
                  <Badge tone="emerald">
                    <Unlock className="h-3 w-3" />
                    Permitted (Validated)
                  </Badge>
                ) : (
                  <Badge tone="rose">
                    <Lock className="h-3 w-3" />
                    Blocked / Fail-Closed
                  </Badge>
                )}
              </div>
              <p className="text-[11px] leading-relaxed text-slate-600">
                {report.mutationLockReason ??
                  'Remote MailWizz mutations are permitted for this validated version when enabled.'}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Historical Engagement Isolation</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs text-slate-700">
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500">Engagement Adapter</span>
                {report.historicalEngagementAvailable ? (
                  <Badge tone="emerald">
                    <Database className="h-3 w-3" />
                    Available (Read-Only)
                  </Badge>
                ) : (
                  <Badge tone="amber">Degraded / Fallback Only</Badge>
                )}
              </div>
              <p className="text-[11px] leading-relaxed text-slate-600">
                {report.historicalEngagementSummary}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Admin-Supplied Version & Approval Controls */}
        <Card>
          <CardHeader>
            <CardTitle>Administrator Version Governance (Explicitly Marked Unverified Until Confirmed)</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-6 lg:grid-cols-2">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void postAction(
                  {
                    action: 'SET_CONFIGURED_VERSION',
                    configuredVersion: configuredInput.trim() || null,
                    notes: notesInput.trim() || undefined,
                  },
                  'SAVE'
                );
              }}
              className="space-y-3"
            >
              <div>
                <label
                  htmlFor="configured-version-input"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Administrator-Supplied MailWizz Version (Marked UNVERIFIED — Admin-Supplied)
                </label>
                <p className="mt-0.5 text-xs text-slate-500">
                  Use this when MailWizz does not expose a version header/field in API responses (for example,
                  <code className="mx-1 rounded bg-slate-100 px-1 py-0.5">3.0.5</code>,
                  <code className="mx-1 rounded bg-slate-100 px-1 py-0.5">3.1.2</code>, or
                  <code className="mx-1 rounded bg-slate-100 px-1 py-0.5">4.0.0</code>). Never invents an API endpoint.
                </p>
                <input
                  id="configured-version-input"
                  type="text"
                  value={configuredInput}
                  onChange={(e) => setConfiguredInput(e.target.value)}
                  placeholder="e.g. 3.0.5 or 3.1.2"
                  className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <label
                  htmlFor="compat-notes-input"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Upgrade / Compatibility Notes (Optional)
                </label>
                <input
                  id="compat-notes-input"
                  type="text"
                  value={notesInput}
                  onChange={(e) => setNotesInput(e.target.value)}
                  placeholder="Staging upgrade ticket, MailWizz changelog reference, or test notes"
                  className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" variant="primary" size="sm" disabled={busyAction !== null}>
                  {busyAction === 'SAVE' ? 'Saving...' : 'Save Configured Version (UNVERIFIED)'}
                </Button>
                {configuredInput && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busyAction !== null}
                    onClick={() => {
                      setConfiguredInput('');
                      void postAction(
                        {
                          action: 'SET_CONFIGURED_VERSION',
                          configuredVersion: null,
                          notes: notesInput.trim() || undefined,
                        },
                        'SAVE'
                      );
                    }}
                  >
                    Clear Admin Version
                  </Button>
                )}
              </div>
            </form>

            <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-700">
              <div className="space-y-2">
                <div className="font-semibold text-slate-900">Guarded Version Approval</div>
                <p className="text-slate-600">
                  When MailWizz upgrades to a new <code className="rounded bg-white px-1">3.1+</code> minor version,
                  the resolver enters <strong>PROVISIONAL READ-ONLY</strong> mode until you run a connected read-only
                  Compatibility Check that passes all 4 critical sync contracts (List Discovery, Subscriber Retrieval,
                  Pagination, and Status Retrieval) and explicitly approve that version here.
                </p>
                {data.approvedAt && (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-900">
                    Approved <strong>{report.versionInfo.approvedVersion}</strong> by{' '}
                    <strong>{data.approvedByEmail ?? 'admin'}</strong> on{' '}
                    {new Date(data.approvedAt).toLocaleString()}.
                  </div>
                )}
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3">
                <span className="text-slate-600">
                  Target version:{' '}
                  <strong className="font-mono">
                    {approvableVersion ?? 'Unknown — verify or set configured version'}
                  </strong>
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={
                    busyAction !== null ||
                    !approvableVersion ||
                    !criticalSyncPassed ||
                    report.overallStatus === 'INCOMPATIBLE' ||
                    report.overallStatus === 'UNVERIFIED'
                  }
                  onClick={() =>
                    approvableVersion &&
                    postAction(
                      { action: 'APPROVE_VERSION', version: approvableVersion },
                      'APPROVE'
                    )
                  }
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Approve Verified Version
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Warnings & Required Manual Actions */}
        {(report.warnings.length > 0 ||
          report.requiredManualActions.length > 0 ||
          report.additiveFieldsObserved.length > 0) && (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Breaking-Update Warnings &amp; Contract Notices</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                {report.warnings.length === 0 ? (
                  <p className="text-slate-500">No contract drift or version warnings detected.</p>
                ) : (
                  <ul className="space-y-2" data-testid="compatibility-warnings">
                    {report.warnings.map((w, idx) => (
                      <li
                        key={idx}
                        className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-950"
                      >
                        {w}
                      </li>
                    ))}
                  </ul>
                )}
                {report.additiveFieldsObserved.length > 0 && (
                  <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sky-900">
                    <strong>Additive / unknown response fields ignored cleanly:</strong>{' '}
                    <span className="font-mono">
                      {report.additiveFieldsObserved.slice(0, 12).join(', ')}
                      {report.additiveFieldsObserved.length > 12
                        ? ` (+${report.additiveFieldsObserved.length - 12} more)`
                        : ''}
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Required Manual Actions</CardTitle>
              </CardHeader>
              <CardContent className="text-xs">
                {report.requiredManualActions.length === 0 ? (
                  <p className="text-slate-500">No manual remediation steps required right now.</p>
                ) : (
                  <ol className="list-inside list-decimal space-y-2 text-slate-700">
                    {report.requiredManualActions.map((act, idx) => (
                      <li key={idx} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                        {act}
                      </li>
                    ))}
                  </ol>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Capability Summary Counts */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {(
            [
              ['VERIFIED', 'Verified', 'text-emerald-700 bg-emerald-50 border-emerald-200'],
              ['AVAILABLE_BUT_UNTESTED', 'Available (Untested)', 'text-sky-700 bg-sky-50 border-sky-200'],
              ['BLOCKED', 'Blocked / Guarded', 'text-amber-700 bg-amber-50 border-amber-200'],
              ['UNSUPPORTED', 'Unsupported', 'text-rose-700 bg-rose-50 border-rose-200'],
              ['UNKNOWN', 'Unknown', 'text-slate-700 bg-slate-50 border-slate-200'],
            ] as const
          ).map(([statusKey, label, cls]) => (
            <div key={statusKey} className={`rounded-xl border px-4 py-3 ${cls}`}>
              <div className="text-[11px] font-semibold uppercase tracking-wide">{label}</div>
              <div className="mt-1 text-2xl font-bold">{counts[statusKey]}</div>
            </div>
          ))}
        </div>

        {/* Full 15-Capability Compatibility Matrix */}
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>Capabilities Matrix (15 Contracted Endpoints &amp; Workflows)</CardTitle>
              <span className="text-xs text-slate-500">
                Explicit states: VERIFIED • AVAILABLE_BUT_UNTESTED • UNSUPPORTED • UNKNOWN • BLOCKED
              </span>
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
              <thead className="bg-slate-50 text-[11px] font-semibold uppercase text-slate-600">
                <tr>
                  <th className="px-4 py-3">Capability</th>
                  <th className="px-4 py-3">Endpoint / Surface</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Read-Only Probed</th>
                  <th className="px-4 py-3">Notes &amp; Contract Diagnostics</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {report.capabilities.map((cap: CapabilityCheckEntry) => (
                  <tr key={cap.key} data-testid={`capability-row-${cap.key}`}>
                    <td className="px-4 py-3 align-top">
                      <div className="font-semibold text-slate-900">{cap.label}</div>
                      <div className="mt-0.5 flex flex-wrap gap-1 text-[10px] text-slate-500">
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono">{cap.key}</span>
                        {cap.criticalForSync && (
                          <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-indigo-700">
                            Sync Critical
                          </span>
                        )}
                        {cap.criticalForMutations && (
                          <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-800">
                            Mutation Guarded
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top font-mono text-[11px] text-slate-600">
                      {cap.endpointOrFeature}
                    </td>
                    <td className="px-4 py-3 align-top whitespace-nowrap">
                      {capabilityStatusBadge(cap.status)}
                    </td>
                    <td className="px-4 py-3 align-top whitespace-nowrap text-slate-600">
                      {cap.testedReadOnly ? 'Yes (Read-Only)' : 'No'}
                    </td>
                    <td className="px-4 py-3 align-top text-slate-700">
                      <p>{cap.reason}</p>
                      {cap.contractErrors.length > 0 && (
                        <ul className="mt-1 space-y-0.5 text-[11px] text-rose-700">
                          {cap.contractErrors.map((err, i) => (
                            <li key={i}>• {err}</li>
                          ))}
                        </ul>
                      )}
                      {cap.additiveFieldsObserved.length > 0 && (
                        <p className="mt-1 font-mono text-[11px] text-sky-700">
                          Additive fields: {cap.additiveFieldsObserved.join(', ')}
                        </p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
