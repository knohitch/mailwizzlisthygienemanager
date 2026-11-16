'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  KeyRound,
  Pause,
  Play,
  PlugZap,
  Plus,
  Power,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { AppShell } from './AppShell';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, type BadgeTone } from './ui';
import type { SafeCustomerConnectionDto } from '@/services/mailwizz/connections';

interface InstallationOption {
  id: string;
  name: string;
  baseUrl: string;
  hostname: string;
  detectedVersion: string | null;
  maxRequestsPerSecond: number;
  maxConcurrentJobs: number;
  connectionCount: number;
}

interface ConnectionsListResponse {
  items: SafeCustomerConnectionDto[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  installations: InstallationOption[];
}

interface SampleResponse {
  readOnly: boolean;
  connection: {
    id: string;
    customerName: string;
    customerSlug: string;
    baseUrl: string;
    apiKeyMasked: string;
    credentialVersion: number;
  };
  limit: number;
  totalListsReported: number;
  lists: Array<{
    listUid: string;
    name: string;
    subscribersCount: number | null;
    optIn: string | null;
  }>;
  sampledListUid: string | null;
  subscribersTotalReported: number | null;
  subscribers: Array<{
    subscriberUid: string;
    maskedEmail: string;
    status: string;
    dateAdded: string | null;
  }>;
  campaignsTotalReported: number | null;
  campaigns: Array<{
    campaignUid: string;
    name: string;
    status: string;
  }>;
}

function statusBadgeTone(status: string): BadgeTone {
  switch (status) {
    case 'CONNECTED':
      return 'emerald';
    case 'PENDING':
      return 'sky';
    case 'AUTH_FAILED':
      return 'rose';
    case 'LEGACY_QUARANTINE':
      return 'amber';
    case 'DISABLED':
    default:
      return 'slate';
  }
}

export function ConnectionsView({
  adminEmail,
  csrfToken,
  isDemoMode,
  phase1ReadOnly,
  initialData,
}: {
  adminEmail: string;
  csrfToken: string;
  isDemoMode: boolean;
  phase1ReadOnly: boolean;
  initialData: ConnectionsListResponse;
}) {
  const [data, setData] = useState<ConnectionsListResponse>(initialData);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [installationFilter, setInstallationFilter] = useState('');
  const [page, setPage] = useState(initialData.page || 1);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Add connection form state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newBaseUrl, setNewBaseUrl] = useState('https://app.nohitchweb.com/api/index.php');
  const [newApiKey, setNewApiKey] = useState('');
  const [newAuthMode, setNewAuthMode] = useState('auto');
  const [newWebhookSecret, setNewWebhookSecret] = useState('');
  const [newMaxRps, setNewMaxRps] = useState(5);
  const [newNotes, setNewNotes] = useState('');
  const [validateOnSave, setValidateOnSave] = useState(true);

  // Inline modal/action state per selected connection
  const [rotateTarget, setRotateTarget] = useState<SafeCustomerConnectionDto | null>(null);
  const [rotateApiKeyInput, setRotateApiKeyInput] = useState('');

  const [editTarget, setEditTarget] = useState<SafeCustomerConnectionDto | null>(null);
  const [editName, setEditName] = useState('');
  const [editBaseUrl, setEditBaseUrl] = useState('');
  const [editAuthMode, setEditAuthMode] = useState('auto');
  const [editMaxRps, setEditMaxRps] = useState(5);
  const [editWebhookSecret, setEditWebhookSecret] = useState('');
  const [editNotes, setEditNotes] = useState('');

  const [deleteTarget, setDeleteTarget] = useState<SafeCustomerConnectionDto | null>(null);
  const [deleteConfirmPhrase, setDeleteConfirmPhrase] = useState('');

  const [sampleData, setSampleData] = useState<SampleResponse | null>(null);

  async function refreshList(
    nextPage = page,
    nextSearch = search,
    nextStatus = statusFilter,
    nextInstallation = installationFilter
  ) {
    setLoading(true);
    try {
      const sp = new URLSearchParams({
        page: String(nextPage),
        pageSize: '25',
      });
      if (nextSearch.trim()) sp.set('search', nextSearch.trim());
      if (nextStatus) sp.set('status', nextStatus);
      if (nextInstallation) sp.set('installationId', nextInstallation);

      const res = await fetch(`/api/connections?${sp.toString()}`);
      if (res.ok) {
        const json = (await res.json()) as ConnectionsListResponse;
        setData(json);
        setPage(json.page);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateConnection(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    setLoading(true);
    try {
      const res = await fetch('/api/connections', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({
          customerName: newName,
          baseUrl: newBaseUrl,
          apiKey: newApiKey,
          authMode: newAuthMode,
          ...(newWebhookSecret.trim() ? { webhookSecret: newWebhookSecret.trim() } : {}),
          maxRequestsPerSecond: Number(newMaxRps) || 5,
          ...(newNotes.trim() ? { notes: newNotes.trim() } : {}),
          validateImmediately: validateOnSave,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        connection?: SafeCustomerConnectionDto;
        validation?: { ok: boolean; message: string } | null;
      };
      if (!res.ok) {
        setFeedback({ type: 'err', text: json.error ?? 'Failed to add customer connection.' });
        return;
      }

      setNewName('');
      setNewApiKey('');
      setNewWebhookSecret('');
      setNewNotes('');
      setShowCreateForm(false);
      setFeedback({
        type: 'ok',
        text: json.validation
          ? `Added "${json.connection?.customerName}" (${json.connection?.apiKeyMasked ?? 'masked'}). Live check: ${json.validation.message}`
          : `Added customer connection "${json.connection?.customerName}" (${json.connection?.apiKeyMasked ?? ''}).`,
      });
      await refreshList(1);
    } finally {
      setLoading(false);
    }
  }

  async function handleValidate(conn: SafeCustomerConnectionDto) {
    setFeedback(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/connections/${conn.id}/validate`, {
        method: 'POST',
        headers: { 'X-CSRF-Token': csrfToken },
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        validation?: { ok: boolean; message: string };
      };
      if (!res.ok && !json.validation) {
        setFeedback({ type: 'err', text: json.error ?? 'Validation failed.' });
      } else {
        setFeedback({
          type: json.validation?.ok ? 'ok' : 'err',
          text: json.validation?.message ?? json.error ?? 'Validation finished.',
        });
      }
      await refreshList();
    } finally {
      setLoading(false);
    }
  }

  async function handleTriggerSync(conn: SafeCustomerConnectionDto) {
    setFeedback(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/connections/${conn.id}/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({ action: 'FULL_SYNC' }),
      });
      const json = (await res.json()) as { error?: string; job?: { id: string } };
      if (!res.ok) {
        setFeedback({ type: 'err', text: json.error ?? 'Failed to queue read-only sync.' });
        return;
      }
      setFeedback({
        type: 'ok',
        text: `Queued read-only FULL_SYNC (${json.job?.id}) for "${conn.customerName}".`,
      });
      await refreshList();
    } finally {
      setLoading(false);
    }
  }

  async function handleInspectSample(conn: SafeCustomerConnectionDto) {
    setFeedback(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/connections/${conn.id}/sample?limit=10`);
      const json = (await res.json()) as SampleResponse & { error?: string };
      if (!res.ok) {
        setFeedback({ type: 'err', text: json.error ?? 'Failed to load bounded sample.' });
        return;
      }
      setSampleData(json);
    } finally {
      setLoading(false);
    }
  }

  async function patchConnection(
    id: string,
    payload: Record<string, unknown>,
    successMsg: string
  ) {
    setFeedback(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/connections/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setFeedback({ type: 'err', text: json.error ?? 'Update failed.' });
        return false;
      }
      setFeedback({ type: 'ok', text: successMsg });
      await refreshList();
      return true;
    } finally {
      setLoading(false);
    }
  }

  async function submitRotateKey(e: React.FormEvent) {
    e.preventDefault();
    if (!rotateTarget) return;
    const ok = await patchConnection(
      rotateTarget.id,
      { action: 'ROTATE_KEY', newApiKey: rotateApiKeyInput },
      `Rotated API key for "${rotateTarget.customerName}". Prior queued jobs with old credentials will fail-closed.`
    );
    if (ok) {
      setRotateTarget(null);
      setRotateApiKeyInput('');
    }
  }

  async function submitEditConnection(e: React.FormEvent) {
    e.preventDefault();
    if (!editTarget) return;
    const ok = await patchConnection(
      editTarget.id,
      {
        action: 'UPDATE_SETTINGS',
        customerName: editName,
        baseUrl: editBaseUrl,
        authMode: editAuthMode,
        maxRequestsPerSecond: Number(editMaxRps) || 5,
        ...(editWebhookSecret.trim() ? { webhookSecret: editWebhookSecret.trim() } : {}),
        notes: editNotes || null,
      },
      `Updated connection settings for "${editName}".`
    );
    if (ok) {
      setEditTarget(null);
      setEditWebhookSecret('');
    }
  }

  async function submitDeleteConnection(e: React.FormEvent) {
    e.preventDefault();
    if (!deleteTarget) return;
    setFeedback(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/connections/${deleteTarget.id}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({ confirmationPhrase: deleteConfirmPhrase }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setFeedback({ type: 'err', text: json.error ?? 'Delete failed.' });
        return;
      }
      setFeedback({
        type: 'ok',
        text: `Removed customer connection "${deleteTarget.customerName}" and its isolated data.`,
      });
      setDeleteTarget(null);
      setDeleteConfirmPhrase('');
      await refreshList(1);
    } finally {
      setLoading(false);
    }
  }

  const hasQuarantined = data.items.some((c) => c.isQuarantine);

  return (
    <AppShell
      adminEmail={adminEmail}
      csrfToken={csrfToken}
      isDemoMode={isDemoMode}
      phase1ReadOnly={phase1ReadOnly}
    >
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
              <PlugZap className="h-6 w-6 text-indigo-600" />
              MailWizz Customer API Connections
            </h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-600">
              Manage multiple MailWizz customer accounts on one or more installations. Every customer account uses its own encrypted API key, rate limit, sync state, webhook secret, compatibility verification, and strictly isolated lists/subscribers/campaigns.
            </p>
          </div>
          <Button
            type="button"
            onClick={() => setShowCreateForm((v) => !v)}
            data-testid="toggle-add-connection"
          >
            <Plus className="h-4 w-4" />
            {showCreateForm ? 'Close Form' : 'Add Customer Connection'}
          </Button>
        </div>

        {hasQuarantined && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-950">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
            <div>
              <div className="font-semibold">Quarantined Legacy Account Present</div>
              <p className="mt-0.5">
                Legacy rows imported without an unambiguous single customer owner were placed into a disabled quarantine container so they never leak into active customer workspaces or sync automatically.
              </p>
            </div>
          </div>
        )}

        {feedback && (
          <div
            role="status"
            data-testid="connections-feedback"
            className={`rounded-xl border px-4 py-3 text-sm ${
              feedback.type === 'ok'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                : 'border-rose-200 bg-rose-50 text-rose-900'
            }`}
          >
            {feedback.text}
          </div>
        )}

        {/* Create Connection Panel */}
        {showCreateForm && (
          <Card>
            <CardHeader>
              <CardTitle>Add MailWizz Customer Account</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreateConnection} className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label htmlFor="conn-name" className="block text-xs font-medium text-slate-700">
                    Customer Name
                  </label>
                  <input
                    id="conn-name"
                    type="text"
                    required
                    placeholder="Acme Newsletter Account"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="conn-url" className="block text-xs font-medium text-slate-700">
                    MailWizz API Base URL
                  </label>
                  <input
                    id="conn-url"
                    type="url"
                    required
                    placeholder="https://app.nohitchweb.com/api/index.php"
                    value={newBaseUrl}
                    onChange={(e) => setNewBaseUrl(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs"
                  />
                  <p className="mt-1 text-[11px] text-slate-500">
                    MailWizz 3.0.5 uses <code>/api/index.php</code> unless Clean URLs are enabled.
                  </p>
                </div>
                <div>
                  <label htmlFor="conn-apikey" className="block text-xs font-medium text-slate-700">
                    Customer API Key (Encrypted at Rest)
                  </label>
                  <input
                    id="conn-apikey"
                    type="password"
                    required
                    autoComplete="new-password"
                    placeholder="Paste MailWizz customer X-Api-Key"
                    value={newApiKey}
                    onChange={(e) => setNewApiKey(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs"
                  />
                </div>
                <div>
                  <label htmlFor="conn-auth" className="block text-xs font-medium text-slate-700">
                    Auth Mode
                  </label>
                  <select
                    id="conn-auth"
                    value={newAuthMode}
                    onChange={(e) => setNewAuthMode(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="auto">Auto (MailWizz 3.x X-Api-Key / Bearer fallback)</option>
                    <option value="x-api-key">X-Api-Key Only (Recommended)</option>
                    <option value="legacy-hmac">Legacy Signature (X-MW-SIGNATURE)</option>
                    <option value="bearer">Bearer Token</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="conn-webhook" className="block text-xs font-medium text-slate-700">
                    Dedicated Webhook Secret (Optional)
                  </label>
                  <input
                    id="conn-webhook"
                    type="password"
                    autoComplete="new-password"
                    placeholder="Used for POST /api/webhooks/mailwizz?connectionId=..."
                    value={newWebhookSecret}
                    onChange={(e) => setNewWebhookSecret(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="conn-rps" className="block text-xs font-medium text-slate-700">
                    Max API Requests / Second
                  </label>
                  <input
                    id="conn-rps"
                    type="number"
                    min={1}
                    max={25}
                    value={newMaxRps}
                    onChange={(e) => setNewMaxRps(Number(e.target.value) || 5)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div className="md:col-span-2">
                  <label htmlFor="conn-notes" className="block text-xs font-medium text-slate-700">
                    Notes (Optional)
                  </label>
                  <input
                    id="conn-notes"
                    type="text"
                    value={newNotes}
                    onChange={(e) => setNewNotes(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div className="md:col-span-2 flex flex-wrap items-center justify-between gap-3">
                  <label className="flex items-center gap-2 text-xs text-slate-700">
                    <input
                      type="checkbox"
                      checked={validateOnSave}
                      onChange={(e) => setValidateOnSave(e.target.checked)}
                    />
                    Run read-only connection validation immediately after save
                  </label>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setShowCreateForm(false)}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" disabled={loading}>
                      Save Customer Connection
                    </Button>
                  </div>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {/* Filter & Search Bar */}
        <Card className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                <input
                  type="search"
                  aria-label="Search customer connections"
                  placeholder="Search customer, slug, host..."
                  value={search}
                  onChange={(e) => {
                    const v = e.target.value;
                    setSearch(v);
                    void refreshList(1, v, statusFilter, installationFilter);
                  }}
                  className="rounded-lg border border-slate-300 bg-white pl-8 pr-3 py-1.5 text-sm"
                />
              </div>

              <select
                aria-label="Filter by status"
                value={statusFilter}
                onChange={(e) => {
                  const v = e.target.value;
                  setStatusFilter(v);
                  void refreshList(1, search, v, installationFilter);
                }}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
              >
                <option value="">All Statuses</option>
                <option value="CONNECTED">CONNECTED</option>
                <option value="PENDING">PENDING</option>
                <option value="AUTH_FAILED">AUTH_FAILED</option>
                <option value="DISABLED">DISABLED</option>
                <option value="LEGACY_QUARANTINE">LEGACY_QUARANTINE</option>
              </select>

              <select
                aria-label="Filter by installation"
                value={installationFilter}
                onChange={(e) => {
                  const v = e.target.value;
                  setInstallationFilter(v);
                  void refreshList(1, search, statusFilter, v);
                }}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
              >
                <option value="">All Installations ({data.installations.length})</option>
                {data.installations.map((inst) => (
                  <option key={inst.id} value={inst.id}>
                    {inst.hostname} ({inst.connectionCount})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2 text-xs text-slate-600">
              <span>
                {data.total} connection(s) • Page {data.page} of {data.totalPages}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page <= 1 || loading}
                onClick={() => void refreshList(page - 1)}
              >
                Prev
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page >= data.totalPages || loading}
                onClick={() => void refreshList(page + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </Card>

        {/* Rotate Key Dialog */}
        {rotateTarget && (
          <Card className="border-indigo-200 bg-indigo-50/40 p-5">
            <form onSubmit={submitRotateKey} className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <KeyRound className="h-4 w-4 text-indigo-600" />
                  Rotate API Key for {rotateTarget.customerName}
                </h2>
                <button
                  type="button"
                  onClick={() => setRotateTarget(null)}
                  className="text-xs text-slate-500 hover:text-slate-700"
                >
                  Close
                </button>
              </div>
              <p className="text-xs text-slate-600">
                Current key: <code>{rotateTarget.apiKeyMasked ?? 'none'}</code> (v{rotateTarget.credentialVersion ?? 0}). Rotating deactivates the previous credential immediately and invalidates cached compatibility until re-verified.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  placeholder="Enter new MailWizz customer X-Api-Key"
                  value={rotateApiKeyInput}
                  onChange={(e) => setRotateApiKeyInput(e.target.value)}
                  className="min-w-72 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs"
                />
                <Button type="submit" disabled={loading}>
                  Confirm Key Rotation
                </Button>
              </div>
            </form>
          </Card>
        )}

        {/* Edit Settings Dialog */}
        {editTarget && (
          <Card className="border-slate-300 p-5">
            <form onSubmit={submitEditConnection} className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="md:col-span-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900">
                  Edit Settings: {editTarget.customerName}
                </h2>
                <button
                  type="button"
                  onClick={() => setEditTarget(null)}
                  className="text-xs text-slate-500 hover:text-slate-700"
                >
                  Close
                </button>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Customer Name</label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Base URL</label>
                <input
                  type="url"
                  required
                  value={editBaseUrl}
                  onChange={(e) => setEditBaseUrl(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 font-mono text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Auth Mode</label>
                <select
                  value={editAuthMode}
                  onChange={(e) => setEditAuthMode(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
                >
                  <option value="auto">auto</option>
                  <option value="x-api-key">x-api-key</option>
                  <option value="legacy-hmac">legacy-hmac</option>
                  <option value="bearer">bearer</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Max RPS</label>
                <input
                  type="number"
                  min={1}
                  max={25}
                  value={editMaxRps}
                  onChange={(e) => setEditMaxRps(Number(e.target.value) || 5)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Replace Webhook Secret (Optional)
                </label>
                <input
                  type="password"
                  autoComplete="new-password"
                  placeholder="Leave blank to keep existing"
                  value={editWebhookSecret}
                  onChange={(e) => setEditWebhookSecret(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Notes</label>
                <input
                  type="text"
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                />
              </div>
              <div className="md:col-span-2 flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setEditTarget(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={loading}>
                  Save Changes
                </Button>
              </div>
            </form>
          </Card>
        )}

        {/* Delete Confirmation Dialog */}
        {deleteTarget && (
          <Card className="border-rose-200 bg-rose-50/50 p-5">
            <form onSubmit={submitDeleteConnection} className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-rose-900">
                  <AlertTriangle className="h-4 w-4 text-rose-700" />
                  Confirm Customer Connection Removal
                </h2>
                <button
                  type="button"
                  onClick={() => setDeleteTarget(null)}
                  className="text-xs text-slate-500 hover:text-slate-700"
                >
                  Close
                </button>
              </div>
              <p className="text-xs text-rose-900">
                This permanently removes local synced lists, subscribers, campaigns, cleanup records, and credentials for{' '}
                <strong>{deleteTarget.customerName}</strong> (slug: <code>{deleteTarget.customerSlug}</code>). Remote MailWizz data is never modified. Type <code>{deleteTarget.customerName}</code> or <code>{deleteTarget.customerSlug}</code> to confirm.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  required
                  placeholder={`Type "${deleteTarget.customerName}"`}
                  value={deleteConfirmPhrase}
                  onChange={(e) => setDeleteConfirmPhrase(e.target.value)}
                  className="min-w-72 flex-1 rounded-lg border border-rose-300 bg-white px-3 py-2 text-sm"
                />
                <Button type="submit" variant="danger" disabled={loading}>
                  <Trash2 className="h-4 w-4" />
                  Permanently Delete Connection
                </Button>
              </div>
            </form>
          </Card>
        )}

        {/* Bounded Live Read-Only Sample Inspector */}
        {sampleData && (
          <Card className="border-sky-200 bg-sky-50/30">
            <CardHeader className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>
                Read-Only Live Sample (Max {sampleData.limit}): {sampleData.connection.customerName}{' '}
                <span className="font-mono text-xs text-slate-500">
                  ({sampleData.connection.apiKeyMasked})
                </span>
              </CardTitle>
              <button
                type="button"
                onClick={() => setSampleData(null)}
                className="text-xs text-slate-600 hover:text-slate-900"
              >
                Close Sample
              </button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div>
                  <div className="text-xs font-semibold uppercase text-slate-500">
                    Lists (Reported: {sampleData.totalListsReported})
                  </div>
                  <ul className="mt-1.5 space-y-1 text-xs">
                    {sampleData.lists.map((l) => (
                      <li key={l.listUid} className="rounded bg-white px-2.5 py-1.5 border border-slate-200">
                        <div className="font-medium text-slate-900">{l.name}</div>
                        <div className="text-slate-500">
                          UID: <code>{l.listUid}</code> • Count: {l.subscribersCount ?? 'n/a'}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase text-slate-500">
                    Subscribers Sample (Masked, List {sampleData.sampledListUid ?? 'none'})
                  </div>
                  <ul className="mt-1.5 space-y-1 text-xs">
                    {sampleData.subscribers.map((s) => (
                      <li key={s.subscriberUid} className="rounded bg-white px-2.5 py-1.5 border border-slate-200">
                        <div className="font-mono text-slate-900">{s.maskedEmail}</div>
                        <div className="text-slate-500">
                          {s.subscriberUid} • {s.status}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase text-slate-500">
                    Campaigns Sample (Reported: {sampleData.campaignsTotalReported ?? 0})
                  </div>
                  <ul className="mt-1.5 space-y-1 text-xs">
                    {sampleData.campaigns.map((c) => (
                      <li key={c.campaignUid} className="rounded bg-white px-2.5 py-1.5 border border-slate-200">
                        <div className="font-medium text-slate-900">{c.name}</div>
                        <div className="text-slate-500">
                          {c.campaignUid} • {c.status}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Connections List */}
        <div className="space-y-3" data-testid="connections-list">
          {data.items.length === 0 ? (
            <Card className="p-8 text-center text-sm text-slate-500">
              No MailWizz customer connections match your filter. Click{' '}
              <strong>Add Customer Connection</strong> to onboard your first customer account.
            </Card>
          ) : (
            data.items.map((conn) => (
              <Card key={conn.id} className="p-5" data-testid={`connection-card-${conn.customerSlug}`}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-semibold text-slate-900">
                        {conn.customerName}
                      </h2>
                      <Badge tone={statusBadgeTone(conn.status)}>{conn.status}</Badge>
                      {conn.isPrimary && <Badge tone="indigo">Primary</Badge>}
                      {conn.isDemoData && <Badge tone="amber">Demo</Badge>}
                      {conn.isQuarantine && <Badge tone="amber">Quarantined</Badge>}
                      {conn.syncState?.isPaused && <Badge tone="slate">Sync Paused</Badge>}
                      {conn.detectedVersion && (
                        <Badge tone="teal">MailWizz {conn.detectedVersion}</Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
                      <span>
                        Slug: <code>{conn.customerSlug}</code>
                      </span>
                      <span>
                        URL: <code className="text-slate-800">{conn.baseUrl}</code>
                      </span>
                      <span>
                        API Key:{' '}
                        <code>{conn.apiKeyMasked ?? 'none'}</code>
                        {conn.credentialVersion ? ` (v${conn.credentialVersion})` : ''}
                      </span>
                      <span>
                        Auth: <code>{conn.authMode}</code>
                      </span>
                      <span>Rate: {conn.maxRequestsPerSecond} req/s</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                      <span>Lists: {conn.counts.mailingLists.toLocaleString()}</span>
                      <span>Subscribers: {conn.counts.subscribers.toLocaleString()}</span>
                      <span>Campaigns: {conn.counts.campaigns.toLocaleString()}</span>
                      <span>Cleanup Ops: {conn.counts.cleanupOperations.toLocaleString()}</span>
                      {conn.health?.lastCheckedAt && (
                        <span>
                          Last Health: {new Date(conn.health.lastCheckedAt).toLocaleString()} (
                          {conn.health.lastLatencyMs ?? 0}ms)
                        </span>
                      )}
                    </div>
                    {conn.health?.lastErrorSafe && (
                      <div className="text-xs text-rose-700">
                        Last safe error: {conn.health.lastErrorSafe}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={loading || conn.isQuarantine || !conn.hasActiveCredential}
                      onClick={() => void handleValidate(conn)}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Validate
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={loading || conn.isQuarantine || !conn.isEnabled || !conn.hasActiveCredential}
                      onClick={() => void handleInspectSample(conn)}
                    >
                      <Eye className="h-3.5 w-3.5" />
                      Sample (&le;10)
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={
                        loading ||
                        conn.isQuarantine ||
                        !conn.isEnabled ||
                        !conn.hasActiveCredential ||
                        conn.syncState?.isPaused
                      }
                      onClick={() => void handleTriggerSync(conn)}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Sync Read-Only
                    </Button>
                    <Link
                      href={`/compatibility?customerConnectionId=${encodeURIComponent(conn.id)}`}
                      className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Compatibility
                    </Link>
                    <Link
                      href={`/?customerConnectionId=${encodeURIComponent(conn.id)}`}
                      className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Overview
                    </Link>
                    {!conn.isQuarantine && (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={loading}
                          onClick={() => {
                            setEditTarget(conn);
                            setEditName(conn.customerName);
                            setEditBaseUrl(conn.baseUrl);
                            setEditAuthMode(conn.authMode);
                            setEditMaxRps(conn.maxRequestsPerSecond);
                            setEditNotes(conn.notes ?? '');
                          }}
                        >
                          Edit
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={loading}
                          onClick={() => {
                            setRotateTarget(conn);
                            setRotateApiKeyInput('');
                          }}
                        >
                          <KeyRound className="h-3.5 w-3.5" />
                          Rotate Key
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={loading}
                          onClick={() =>
                            void patchConnection(
                              conn.id,
                              {
                                action: conn.syncState?.isPaused ? 'RESUME_SYNC' : 'PAUSE_SYNC',
                              },
                              conn.syncState?.isPaused
                                ? `Resumed sync for "${conn.customerName}".`
                                : `Paused sync for "${conn.customerName}".`
                            )
                          }
                        >
                          {conn.syncState?.isPaused ? (
                            <>
                              <Play className="h-3.5 w-3.5" />
                              Resume Sync
                            </>
                          ) : (
                            <>
                              <Pause className="h-3.5 w-3.5" />
                              Pause Sync
                            </>
                          )}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={loading}
                          onClick={() =>
                            void patchConnection(
                              conn.id,
                              { action: 'SET_ENABLED', isEnabled: !conn.isEnabled },
                              conn.isEnabled
                                ? `Disabled customer connection "${conn.customerName}".`
                                : `Enabled customer connection "${conn.customerName}".`
                            )
                          }
                        >
                          <Power className="h-3.5 w-3.5" />
                          {conn.isEnabled ? 'Disable' : 'Enable'}
                        </Button>
                      </>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="danger"
                      disabled={loading}
                      onClick={() => {
                        setDeleteTarget(conn);
                        setDeleteConfirmPhrase('');
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Remove
                    </Button>
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>
      </div>
    </AppShell>
  );
}
