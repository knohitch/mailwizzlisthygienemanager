'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  ShieldCheck,
  Terminal,
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
    <main className="flex min-h-screen flex-col justify-center bg-[var(--bg-canvas)] px-4 py-12 text-[var(--fg-primary)]">
      <div className="mx-auto grid w-full max-w-4xl grid-cols-1 overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] lg:grid-cols-12">
        {/* Left Charcoal Agent Runtime Panel */}
        <div className="flex flex-col justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-sidebar)] p-7 lg:col-span-5 lg:border-b-0 lg:border-r">
          <div className="space-y-6">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded border border-[var(--border-default)] bg-[var(--bg-elevated)] text-emerald-400">
                  <Terminal className="h-4 w-4" />
                </div>
                <div>
                  <div className="font-mono text-xs font-semibold tracking-tight text-[var(--fg-primary)]">
                    MW_HYGIENE_AGENT
                  </div>
                  <div className="font-mono text-[10px] text-[var(--fg-muted)]">
                    Autonomous Hygiene &amp; Deliverability Agent
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-2.5 pt-2">
              <div className="inline-flex items-center gap-1.5 rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] font-medium text-emerald-400">
                <StatusDot tone="emerald" pulse />
                RUNTIME: READ_ONLY_GUARD
              </div>
              <h1 className="text-xl font-semibold tracking-tight text-[var(--fg-primary)]">
                Operator Authentication
              </h1>
              <p className="text-xs leading-relaxed text-[var(--fg-secondary)]">
                Authenticate to inspect multi-customer MailWizz audiences,
                verify engagement history, simulate dry-run cleanups with
                encrypted recovery snapshots, and audit DirectMail
                deliverability.
              </p>
            </div>

            <ul className="space-y-3 border-t border-[var(--border-subtle)] pt-5 text-xs text-[var(--fg-secondary)]">
              <li className="flex items-start gap-2.5">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                <span>
                  <strong className="text-[var(--fg-primary)]">
                    Multi-Customer Isolation:
                  </strong>{' '}
                  Per-account API keys, rate governors, and tenant-scoped
                  datasets.
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                <span>
                  <strong className="text-[var(--fg-primary)]">
                    Dry-Run &amp; Snapshot First:
                  </strong>{' '}
                  Every hygiene plan generates an AES-256-GCM pre-change
                  snapshot before execution.
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                <span>
                  <strong className="text-[var(--fg-primary)]">
                    Zero False Engagement:
                  </strong>{' '}
                  Transport-level block on tracking pixel endpoints during API
                  sync.
                </span>
              </li>
            </ul>
          </div>

          <div className="mt-8 border-t border-[var(--border-subtle)] pt-4 font-mono text-[10px] text-[var(--fg-muted)]">
            MAILWIZZ 3.0.5+ // SELF-HOSTED AGENT RUNTIME
          </div>
        </div>

        {/* Right Form Panel */}
        <div className="flex flex-col justify-center p-7 sm:p-10 lg:col-span-7">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold tracking-tight text-[var(--fg-primary)]">
                Administrator Sign In
              </h2>
              <p className="text-xs text-[var(--fg-muted)]">
                Enter your provisioned administrator credentials to unlock the
                workspace.
              </p>
            </div>
            <Badge tone="emerald" dot>
              <ShieldCheck className="h-3 w-3" />
              Read-Only Phase 1
            </Badge>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="admin-email"
                className="mb-1.5 block font-mono text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-secondary)]"
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
                className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-well)] px-3.5 py-2.5 text-sm text-[var(--fg-primary)] transition-colors focus:border-[var(--border-strong)] focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="admin-password"
                className="mb-1.5 block font-mono text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-secondary)]"
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
                  className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-well)] py-2.5 pl-3.5 pr-10 text-sm text-[var(--fg-primary)] transition-colors focus:border-[var(--border-strong)] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--fg-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--fg-primary)]"
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
                className="rounded-md border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-800"
              >
                {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5"
            >
              <Lock className="h-3.5 w-3.5" />
              {submitting ? 'Authenticating session...' : 'Sign in to Console'}
            </Button>
          </form>

          <Card className="mt-6 bg-[var(--bg-well)] p-3.5">
            <div className="flex items-start gap-2.5 text-xs text-[var(--fg-secondary)]">
              <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--fg-muted)]" />
              <div className="space-y-0.5">
                <div className="font-mono text-[11px] font-semibold text-[var(--fg-primary)]">
                  SECURITY_POSTURE // SESSION_GOVERNANCE
                </div>
                <p className="text-[11px] leading-relaxed text-[var(--fg-muted)]">
                  HTTP-only server-side sessions, double-submit CSRF tokens,
                  scrypt password hashing, and AES-256-GCM credential encryption
                  active.
                </p>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </main>
  );
}
