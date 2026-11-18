'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Activity,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  ShieldCheck,
} from 'lucide-react';
import { Badge, Button, Card, StatusDot } from '@/components/ui';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? 'Authentication failed.');
        return;
      }
      router.push('/');
      router.refresh();
    } catch {
      setError('Network error while signing in.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col justify-center bg-slate-50 px-4 py-12">
      <div className="mx-auto grid w-full max-w-4xl grid-cols-1 overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm lg:grid-cols-12">
        {/* Left Brand & Agent Security Architecture Panel */}
        <div className="flex flex-col justify-between border-b border-slate-200/80 bg-slate-900 p-7 text-slate-100 lg:col-span-5 lg:border-b-0 lg:border-r">
          <div className="space-y-6">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-indigo-400 ring-1 ring-white/15">
                  <Activity className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-sm font-semibold tracking-tight text-white">
                    MailWizz Hygiene Manager
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Autonomous Hygiene &amp; Deliverability Agent
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-2 pt-2">
              <div className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300 ring-1 ring-emerald-500/25">
                <StatusDot tone="emerald" pulse className="h-1.5 w-1.5" />
                Read-Only Phase 1 • Fail-Closed Guard
              </div>
              <h1 className="text-xl font-semibold tracking-tight text-white">
                Operator Authentication
              </h1>
              <p className="text-xs leading-relaxed text-slate-300">
                Sign in to inspect multi-customer MailWizz audiences, verify engagement history, simulate dry-run cleanups with encrypted recovery snapshots, and audit DirectMail deliverability.
              </p>
            </div>

            <ul className="space-y-3 border-t border-white/10 pt-5 text-xs text-slate-300">
              <li className="flex items-start gap-2.5">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-indigo-400" />
                <span>
                  <strong className="text-white">Multi-Customer Isolation:</strong> Per-account API keys, rate governors, and tenant-scoped datasets.
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-indigo-400" />
                <span>
                  <strong className="text-white">Dry-Run &amp; Snapshot First:</strong> Every hygiene plan generates an AES-256-GCM pre-change snapshot before execution.
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-indigo-400" />
                <span>
                  <strong className="text-white">Zero False Engagement:</strong> Transport-level block on tracking pixel endpoints during API sync.
                </span>
              </li>
            </ul>
          </div>

          <div className="mt-8 border-t border-white/10 pt-4 text-[11px] text-slate-400">
            MailWizz 3.0.5+ Compatible • Self-Hosted Operator Console
          </div>
        </div>

        {/* Right Form Panel */}
        <div className="flex flex-col justify-center p-7 sm:p-10 lg:col-span-7">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold tracking-tight text-slate-900">
                Administrator Sign In
              </h2>
              <p className="text-xs text-slate-500">
                Enter your provisioned administrator credentials to unlock the workspace.
              </p>
            </div>
            <Badge tone="emerald">
              <ShieldCheck className="h-3.5 w-3.5" />
              Read-Only Phase 1
            </Badge>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="admin-email"
                className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-700"
              >
                Administrator Email
              </label>
              <input
                id="admin-email"
                name="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@example.com"
                className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-2xs transition-colors focus:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              />
            </div>

            <div>
              <label
                htmlFor="admin-password"
                className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-700"
              >
                Administrator Password
              </label>
              <div className="relative">
                <input
                  id="admin-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter administrator password"
                  className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-3.5 pr-10 text-sm text-slate-900 shadow-2xs transition-colors focus:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            {error && (
              <div
                role="alert"
                className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-800"
              >
                {error}
              </div>
            )}

            <Button type="submit" disabled={submitting} className="w-full py-2.5">
              <Lock className="h-4 w-4" />
              {submitting ? 'Authenticating session...' : 'Sign in to Console'}
            </Button>
          </form>

          <Card className="mt-6 border-slate-200/80 bg-slate-50/70 p-3.5">
            <div className="flex items-start gap-2.5 text-xs text-slate-600">
              <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              <div className="space-y-0.5">
                <div className="font-medium text-slate-800">
                  Security &amp; Session Governance
                </div>
                <p className="text-[11px] leading-relaxed text-slate-500">
                  HTTP-only server-side sessions, double-submit CSRF tokens, scrypt password hashing, and AES-256-GCM credential encryption active.
                </p>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </main>
  );
}
