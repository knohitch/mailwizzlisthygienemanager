'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  CheckCircle2,
  Database,
  KeyRound,
  Save,
  Settings,
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
} from './ui';

interface SettingsState {
  mailwizzApiUrl: string;
  hasMailwizzApiKey: boolean;
  mailwizzApiKeyMasked: string | null;
  mailwizzAuthMode: string;
  mailwizzDetectedVersion: string | null;
  hasReportingDbUrl: boolean;
  reportingDbPrefix: string;
  hasWebhookSecret: boolean;
  lookbackDays: number;
  minDeliveredCampaigns: number;
  countOpensAsEngaged: boolean;
  countClicksAsEngaged: boolean;
  countRepliesAsEngaged: boolean;
  countConversionsAsEngaged: boolean;
  excludedDomains: string[];
  excludedSources: string[];
  excludeRecentSubscribersDays: number;
  maxApiRequestsPerSecond: number;
  batchSize: number;
  syncScheduleCron: string;
  syncScheduleEnabled: boolean;
  timezone: string;
  reportingPeriodDays: number;
  dataRetentionDays: number;
  isDemoMode: boolean;
  lastValidatedAt: string | null;
  lastValidationStatus: string | null;
  lastValidationMessage: string | null;
  phase1ReadOnly: boolean;
}

const LOOKBACK_PRESETS = [30, 60, 90, 180, 365];

export function SettingsView({
  adminEmail,
  csrfToken,
  initialSettings,
}: {
  adminEmail: string;
  csrfToken: string;
  initialSettings: SettingsState;
}) {
  const [form, setForm] = useState<SettingsState>(initialSettings);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [reportingDbInput, setReportingDbInput] = useState('');
  const [webhookSecretInput, setWebhookSecretInput] = useState('');
  const [excludedDomainsText, setExcludedDomainsText] = useState(
    initialSettings.excludedDomains.join(', ')
  );
  const [excludedSourcesText, setExcludedSourcesText] = useState(
    initialSettings.excludedSources.join(', ')
  );
  const [lookbackPreset, setLookbackPreset] = useState<string>(
    LOOKBACK_PRESETS.includes(initialSettings.lookbackDays)
      ? String(initialSettings.lookbackDays)
      : 'custom'
  );
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);

  // Priority B Report Import state
  const [importFormat, setImportFormat] = useState<'csv' | 'json'>('csv');
  const [importCampaignUid, setImportCampaignUid] = useState('');
  const [importContent, setImportContent] = useState('');
  const [importing, setImporting] = useState(false);

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setStatusMsg(null);
    try {
      const payload = {
        mailwizzApiUrl: form.mailwizzApiUrl,
        mailwizzAuthMode: form.mailwizzAuthMode || 'auto',
        ...(apiKeyInput.trim() ? { mailwizzApiKey: apiKeyInput.trim() } : {}),
        ...(reportingDbInput.trim()
          ? { reportingDbUrl: reportingDbInput.trim() }
          : {}),
        reportingDbPrefix: form.reportingDbPrefix,
        ...(webhookSecretInput.trim()
          ? { webhookSecret: webhookSecretInput.trim() }
          : {}),
        lookbackDays: Number(form.lookbackDays),
        minDeliveredCampaigns: Number(form.minDeliveredCampaigns),
        countOpensAsEngaged: form.countOpensAsEngaged,
        countClicksAsEngaged: form.countClicksAsEngaged,
        countRepliesAsEngaged: form.countRepliesAsEngaged,
        countConversionsAsEngaged: form.countConversionsAsEngaged,
        excludedDomains: excludedDomainsText
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        excludedSources: excludedSourcesText
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        excludeRecentSubscribersDays: Number(form.excludeRecentSubscribersDays),
        maxApiRequestsPerSecond: Number(form.maxApiRequestsPerSecond),
        batchSize: Number(form.batchSize),
        syncScheduleCron: form.syncScheduleCron,
        syncScheduleEnabled: form.syncScheduleEnabled,
        timezone: form.timezone,
        reportingPeriodDays: Number(form.reportingPeriodDays),
        dataRetentionDays: Number(form.dataRetentionDays),
      };

      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as {
        error?: string;
        recomputedSubscribers?: number;
      };
      if (!res.ok) {
        setStatusMsg({
          type: 'err',
          text: json.error ?? 'Failed saving settings.',
        });
        return;
      }

      setApiKeyInput('');
      setReportingDbInput('');
      setWebhookSecretInput('');

      const freshRes = await fetch('/api/settings');
      if (freshRes.ok) {
        setForm((await freshRes.json()) as SettingsState);
      }

      setStatusMsg({
        type: 'ok',
        text: `Settings saved and encrypted. Recomputed hygiene classification for ${json.recomputedSubscribers ?? 0} subscribers.`,
      });
    } finally {
      setSaving(false);
    }
  }

  async function validateConnection() {
    setValidating(true);
    setStatusMsg(null);
    try {
      const res = await fetch('/api/settings/validate', {
        method: 'POST',
        headers: { 'X-CSRF-Token': csrfToken },
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        api?: { message: string };
      };
      if (!res.ok || !json.ok) {
        setStatusMsg({
          type: 'err',
          text: json.error ?? 'MailWizz connection validation failed.',
        });
        return;
      }
      setStatusMsg({
        type: 'ok',
        text: json.api?.message ?? 'MailWizz connection validated.',
      });
    } finally {
      setValidating(false);
    }
  }

  async function submitReportImport(e: React.FormEvent) {
    e.preventDefault();
    setImporting(true);
    setStatusMsg(null);
    try {
      const res = await fetch('/api/reports/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({
          format: importFormat,
          content: importContent,
          defaultCampaignUid: importCampaignUid.trim() || undefined,
        }),
      });
      const json = (await res.json()) as {
        error?: string;
        summary?: {
          totalRows: number;
          importedCount: number;
          skippedUnmatchedCount: number;
          duplicateCount: number;
        };
      };
      if (!res.ok) {
        setStatusMsg({
          type: 'err',
          text: json.error ?? 'Report import failed.',
        });
        return;
      }
      setImportContent('');
      setStatusMsg({
        type: 'ok',
        text: `Verified export imported: ${json.summary?.importedCount ?? 0} added, ${json.summary?.duplicateCount ?? 0} duplicates skipped, ${json.summary?.skippedUnmatchedCount ?? 0} unmatched.`,
      });
    } finally {
      setImporting(false);
    }
  }

  return (
    <AppShell
      adminEmail={adminEmail}
      csrfToken={csrfToken}
      isDemoMode={form.isDemoMode}
      phase1ReadOnly={form.phase1ReadOnly}
    >
      <div className="space-y-6">
        <div className="border-b border-slate-200/80 pb-5">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
              <Settings className="h-3 w-3" />
              SYSTEM_POLICY_DATA_SOURCES
            </span>
          </div>
          <h1 className="mt-1.5 text-xl font-semibold tracking-tight text-slate-900">
            Configuration, Credentials &amp; Engagement Sources
          </h1>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-600">
            All integration secrets are encrypted with AES-256-GCM at rest and
            never exposed to browser bundles. Global hygiene thresholds defined
            here govern engagement classification across synced MailWizz
            audiences.
          </p>
        </div>

        <AgentWorkflowStrip
          activeStage="observe"
          phase1ReadOnly={form.phase1ReadOnly}
        />

        <Card className="bg-slate-50/70 p-4 text-xs text-slate-700">
          <strong className="text-slate-900">
            Multi-Customer Mode Enabled:
          </strong>{' '}
          Add, validate, rotate, pause, or isolate multiple MailWizz customer
          API accounts in{' '}
          <Link
            href="/connections"
            className="font-semibold text-indigo-600 underline hover:text-indigo-500"
          >
            Customer Connections
          </Link>
          . Global hygiene rules configured below serve as system defaults.
        </Card>

        {statusMsg && (
          <div
            role="status"
            className={`rounded-lg border px-4 py-2.5 text-xs font-medium ${
              statusMsg.type === 'ok'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                : 'border-rose-200 bg-rose-50 text-rose-900'
            }`}
          >
            {statusMsg.text}
          </div>
        )}

        <form onSubmit={saveSettings} className="space-y-6">
          {/* MailWizz Multi-Version API Connection */}
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2">
                  <KeyRound className="h-4 w-4 text-indigo-600" />
                  MailWizz API Connection (1.x / 2.x / 3.x+ Compatible)
                </CardTitle>
                <div className="flex flex-wrap items-center gap-2">
                  {form.mailwizzDetectedVersion && (
                    <Badge tone="sky">
                      Detected v{form.mailwizzDetectedVersion}
                    </Badge>
                  )}
                  {form.hasMailwizzApiKey && (
                    <Badge tone="emerald" dot>
                      Key stored ({form.mailwizzApiKeyMasked ?? 'encrypted'})
                    </Badge>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={validateConnection}
                    disabled={validating}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {validating ? 'Validating...' : 'Validate Connection'}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div>
                  <label
                    htmlFor="mw-url"
                    className="mb-1 block text-xs font-medium text-slate-700"
                  >
                    MailWizz API Base URL (HTTPS required in production)
                  </label>
                  <input
                    id="mw-url"
                    type="url"
                    placeholder="https://mailwizz.yourdomain.com/api/index.php"
                    value={form.mailwizzApiUrl}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, mailwizzApiUrl: e.target.value }))
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label
                    htmlFor="mw-key"
                    className="mb-1 block text-xs font-medium text-slate-700"
                  >
                    API Key / <code>public:private</code>{' '}
                    {form.hasMailwizzApiKey ? '(leave blank to keep)' : ''}
                  </label>
                  <input
                    id="mw-key"
                    type="password"
                    autoComplete="new-password"
                    placeholder={
                      form.hasMailwizzApiKey
                        ? '••••••••••••••••'
                        : 'Customer API Key or public:private'
                    }
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label
                    htmlFor="mw-auth-mode"
                    className="mb-1 block text-xs font-medium text-slate-700"
                  >
                    Auth Protocol Mode
                  </label>
                  <select
                    id="mw-auth-mode"
                    value={form.mailwizzAuthMode || 'auto'}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        mailwizzAuthMode: e.target.value,
                      }))
                    }
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="auto">Auto-Detect (Recommended)</option>
                    <option value="x-api-key">
                      MailWizz 2.x / 3.x+ (X-Api-Key)
                    </option>
                    <option value="legacy-hmac">
                      MailWizz 1.x (HMAC public:private)
                    </option>
                    <option value="bearer">
                      Bearer Token (Future / Gateway)
                    </option>
                  </select>
                </div>
              </div>

              {form.lastValidationMessage && (
                <div className="text-xs text-slate-600">
                  Last validation ({form.lastValidationStatus}):{' '}
                  {form.lastValidationMessage}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Engagement Analysis Rules */}
          <Card>
            <CardHeader>
              <CardTitle>Engagement Analysis &amp; Exclusion Rules</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div>
                  <label
                    htmlFor="lookback-select"
                    className="mb-1 block text-xs font-medium text-slate-700"
                  >
                    Engagement Lookback Window (Days)
                  </label>
                  <div className="flex gap-2">
                    <select
                      id="lookback-select"
                      value={lookbackPreset}
                      onChange={(e) => {
                        const val = e.target.value;
                        setLookbackPreset(val);
                        if (val !== 'custom') {
                          setForm((f) => ({ ...f, lookbackDays: Number(val) }));
                        }
                      }}
                      className="rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm"
                    >
                      <option value="30">30 days</option>
                      <option value="60">60 days</option>
                      <option value="90">90 days</option>
                      <option value="180">180 days</option>
                      <option value="365">365 days</option>
                      <option value="custom">Custom</option>
                    </select>
                    {lookbackPreset === 'custom' && (
                      <input
                        type="number"
                        aria-label="Custom lookback days"
                        min={1}
                        max={3650}
                        value={form.lookbackDays}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            lookbackDays: Number(e.target.value) || 90,
                          }))
                        }
                        className="w-24 rounded-lg border border-slate-300 px-2.5 py-2 text-sm"
                      />
                    )}
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="min-campaigns"
                    className="mb-1 block text-xs font-medium text-slate-700"
                  >
                    Minimum Delivered Campaigns (Default: 5)
                  </label>
                  <input
                    id="min-campaigns"
                    type="number"
                    min={1}
                    max={200}
                    value={form.minDeliveredCampaigns}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        minDeliveredCampaigns: Number(e.target.value) || 5,
                      }))
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label
                    htmlFor="grace-days"
                    className="mb-1 block text-xs font-medium text-slate-700"
                  >
                    Exclude Recent Subscribers (Days)
                  </label>
                  <input
                    id="grace-days"
                    type="number"
                    min={0}
                    max={365}
                    value={form.excludeRecentSubscribersDays}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        excludeRecentSubscribersDays:
                          Number(e.target.value) || 0,
                      }))
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  {
                    key: 'countClicksAsEngaged' as const,
                    label: 'Count Clicks (Strong)',
                  },
                  {
                    key: 'countRepliesAsEngaged' as const,
                    label: 'Count Replies (Strong)',
                  },
                  {
                    key: 'countConversionsAsEngaged' as const,
                    label: 'Count Conversions (Strong)',
                  },
                  {
                    key: 'countOpensAsEngaged' as const,
                    label: 'Count Opens (Tracked Separately)',
                  },
                ].map((toggle) => (
                  <label
                    key={toggle.key}
                    className="flex items-center gap-2 rounded-lg border border-slate-200/90 bg-slate-50/70 px-3 py-2 text-xs font-medium text-slate-800"
                  >
                    <input
                      type="checkbox"
                      checked={form[toggle.key]}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          [toggle.key]: e.target.checked,
                        }))
                      }
                      className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                    />
                    {toggle.label}
                  </label>
                ))}
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label
                    htmlFor="excluded-domains"
                    className="mb-1 block text-xs font-medium text-slate-700"
                  >
                    Excluded VIP Domains (comma-separated)
                  </label>
                  <input
                    id="excluded-domains"
                    type="text"
                    placeholder="vipclient.com, partner.org"
                    value={excludedDomainsText}
                    onChange={(e) => setExcludedDomainsText(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label
                    htmlFor="excluded-sources"
                    className="mb-1 block text-xs font-medium text-slate-700"
                  >
                    Excluded Subscriber Sources (comma-separated)
                  </label>
                  <input
                    id="excluded-sources"
                    type="text"
                    placeholder="vip_crm, manual_override"
                    value={excludedSourcesText}
                    onChange={(e) => setExcludedSourcesText(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Rate Limiting, Schedule, Timezone & Retention */}
          <Card>
            <CardHeader>
              <CardTitle>
                Sync Throughput, Schedule, Timezone &amp; Retention
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <label
                    htmlFor="max-rps"
                    className="mb-1 block text-xs font-medium text-slate-700"
                  >
                    Max API Requests / Sec
                  </label>
                  <input
                    id="max-rps"
                    type="number"
                    min={1}
                    max={50}
                    value={form.maxApiRequestsPerSecond}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        maxApiRequestsPerSecond: Number(e.target.value) || 5,
                      }))
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label
                    htmlFor="batch-size"
                    className="mb-1 block text-xs font-medium text-slate-700"
                  >
                    Batch Size (Per Page)
                  </label>
                  <input
                    id="batch-size"
                    type="number"
                    min={10}
                    max={500}
                    value={form.batchSize}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        batchSize: Number(e.target.value) || 50,
                      }))
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label
                    htmlFor="timezone"
                    className="mb-1 block text-xs font-medium text-slate-700"
                  >
                    Timezone
                  </label>
                  <input
                    id="timezone"
                    type="text"
                    value={form.timezone}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, timezone: e.target.value }))
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label
                    htmlFor="retention-days"
                    className="mb-1 block text-xs font-medium text-slate-700"
                  >
                    Data Retention (Days)
                  </label>
                  <input
                    id="retention-days"
                    type="number"
                    min={30}
                    max={3650}
                    value={form.dataRetentionDays}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        dataRetentionDays: Number(e.target.value) || 365,
                      }))
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div>
                  <label
                    htmlFor="reporting-period"
                    className="mb-1 block text-xs font-medium text-slate-700"
                  >
                    Default Dashboard Reporting Period (Days)
                  </label>
                  <input
                    id="reporting-period"
                    type="number"
                    min={1}
                    max={3650}
                    value={form.reportingPeriodDays}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        reportingPeriodDays: Number(e.target.value) || 90,
                      }))
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label
                    htmlFor="sync-cron"
                    className="mb-1 block text-xs font-medium text-slate-700"
                  >
                    Sync Schedule Cadence
                  </label>
                  <select
                    id="sync-cron"
                    value={form.syncScheduleCron}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        syncScheduleCron: e.target.value,
                      }))
                    }
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="0 * * * *">Hourly (0 * * * *)</option>
                    <option value="0 */6 * * *">
                      Every 6 Hours (0 */6 * * *)
                    </option>
                    <option value="0 */12 * * *">
                      Every 12 Hours (0 */12 * * *)
                    </option>
                    <option value="0 2 * * *">
                      Daily at 02:00 (0 2 * * *)
                    </option>
                  </select>
                </div>
                <div className="flex items-end">
                  <label className="flex w-full items-center gap-2 rounded-lg border border-slate-200/90 bg-slate-50/70 px-3 py-2 text-xs font-medium text-slate-800">
                    <input
                      type="checkbox"
                      checked={form.syncScheduleEnabled}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          syncScheduleEnabled: e.target.checked,
                        }))
                      }
                      className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                    />
                    Enable Automatic Scheduled Background Sync
                  </label>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Optional Priority C & D */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-4 w-4 text-slate-700" />
                Optional Historical &amp; Live Engagement Connectors (Priority C
                &amp; D)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div>
                  <label
                    htmlFor="reporting-db"
                    className="mb-1 block text-xs font-medium text-slate-700"
                  >
                    Priority C: Read-Only MySQL Reporting URI{' '}
                    {form.hasReportingDbUrl ? '(Stored encrypted)' : ''}
                  </label>
                  <input
                    id="reporting-db"
                    type="password"
                    autoComplete="new-password"
                    placeholder="mysql://readonly_user:pass@host:3306/mailwizz"
                    value={reportingDbInput}
                    onChange={(e) => setReportingDbInput(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label
                    htmlFor="reporting-prefix"
                    className="mb-1 block text-xs font-medium text-slate-700"
                  >
                    MailWizz DB Table Prefix
                  </label>
                  <input
                    id="reporting-prefix"
                    type="text"
                    value={form.reportingDbPrefix}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        reportingDbPrefix: e.target.value,
                      }))
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label
                    htmlFor="webhook-secret"
                    className="mb-1 block text-xs font-medium text-slate-700"
                  >
                    Priority D: Webhook Shared Secret{' '}
                    {form.hasWebhookSecret ? '(Stored encrypted)' : ''}
                  </label>
                  <input
                    id="webhook-secret"
                    type="password"
                    autoComplete="new-password"
                    placeholder="X-Hygiene-Webhook-Secret value"
                    value={webhookSecretInput}
                    onChange={(e) => setWebhookSecretInput(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <p className="text-xs text-slate-500">
                Priority D Webhook Endpoint:{' '}
                <code>POST /api/webhooks/mailwizz</code> with header{' '}
                <code>X-Hygiene-Webhook-Secret</code>. Webhook events are tagged{' '}
                <code>isHistorical=false</code> (future events only).
              </p>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button type="submit" disabled={saving}>
              <Save className="h-4 w-4" />
              {saving ? 'Saving & Recomputing...' : 'Save Configuration'}
            </Button>
          </div>
        </form>

        {/* Priority B Verified Report Importer */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-4 w-4 text-indigo-600" />
              Priority B: Import Verified MailWizz Campaign Report (CSV / JSON)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-slate-600">
              Import campaign delivery, open, click, or complaint logs exported
              from MailWizz customer reports. Columns: <code>email</code> (or{' '}
              <code>subscriber_uid</code>), <code>campaign_uid</code>,{' '}
              <code>event_type</code> (DELIVERED, OPEN, CLICK, REPLY,
              CONVERSION, HARD_BOUNCE, SOFT_BOUNCE, COMPLAINT),{' '}
              <code>occurred_at</code>.
            </p>

            <form onSubmit={submitReportImport} className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <select
                  aria-label="Import format"
                  value={importFormat}
                  onChange={(e) =>
                    setImportFormat(e.target.value as 'csv' | 'json')
                  }
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="csv">CSV Format</option>
                  <option value="json">JSON Array Format</option>
                </select>
                <input
                  type="text"
                  placeholder="Optional default campaign_uid"
                  value={importCampaignUid}
                  onChange={(e) => setImportCampaignUid(e.target.value)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              <textarea
                rows={5}
                required
                placeholder={
                  'email,campaign_uid,event_type,occurred_at\ndemo.user.1.1@outlook.com,demo-camp-06,CLICK,2026-11-10T10:00:00Z'
                }
                value={importContent}
                onChange={(e) => setImportContent(e.target.value)}
                className="w-full rounded-lg border border-slate-300 p-3 font-mono text-xs"
              />

              <Button type="submit" variant="outline" disabled={importing}>
                <Upload className="h-4 w-4" />
                {importing
                  ? 'Importing & Reclassifying...'
                  : 'Import Verified Report'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
