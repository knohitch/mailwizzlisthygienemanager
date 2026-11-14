'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Activity,
  BarChart3,
  Filter,
  FlaskConical,
  Globe,
  LayoutDashboard,
  LogOut,
  MailCheck,
  Settings,
  ShieldCheck,
} from 'lucide-react';
import { Badge, Button, cn } from './ui';

export function AppShell({
  adminEmail,
  csrfToken,
  isDemoMode,
  phase1ReadOnly,
  children,
}: {
  adminEmail: string;
  csrfToken: string;
  isDemoMode?: boolean;
  phase1ReadOnly?: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: {
        'X-CSRF-Token': csrfToken,
      },
    });
    router.push('/login');
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-xs">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900 text-white">
                <Activity className="h-5 w-5" />
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-900">
                  MailWizz List Hygiene Manager
                </div>
                <div className="text-xs text-slate-500">
                  MailWizz 3.0.5 • DirectMail Deliverability Console
                </div>
              </div>
            </Link>

            {phase1ReadOnly !== false && (
              <Badge tone="emerald" className="hidden sm:inline-flex">
                <ShieldCheck className="h-3.5 w-3.5" />
                Phase 1 Read-Only
              </Badge>
            )}
            {isDemoMode && (
              <Badge tone="amber" className="hidden sm:inline-flex">
                <FlaskConical className="h-3.5 w-3.5" />
                DEMO DATA
              </Badge>
            )}
          </div>

          <nav className="flex flex-wrap items-center gap-2" aria-label="Primary navigation">
            <Link
              href="/"
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                pathname === '/'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              )}
            >
              <LayoutDashboard className="h-4 w-4" />
              Dashboard
            </Link>
            <Link
              href="/cleanup"
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                pathname.startsWith('/cleanup')
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              )}
            >
              <Filter className="h-4 w-4" />
              Filter &amp; Cleanup
            </Link>
            <Link
              href="/reengagement"
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                pathname.startsWith('/reengagement')
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              )}
            >
              <MailCheck className="h-4 w-4" />
              Re-Engagement
            </Link>
            <Link
              href="/reports"
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                pathname.startsWith('/reports')
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              )}
            >
              <BarChart3 className="h-4 w-4" />
              Reports
            </Link>
            <Link
              href="/deliverability"
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                pathname.startsWith('/deliverability')
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              )}
            >
              <Globe className="h-4 w-4" />
              Deliverability
            </Link>
            <Link
              href="/settings"
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                pathname.startsWith('/settings')
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              )}
            >
              <Settings className="h-4 w-4" />
              Settings &amp; Sources
            </Link>

            <span className="hidden border-l border-slate-200 pl-3 text-xs text-slate-500 md:inline">
              {adminEmail}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={handleLogout}
              aria-label="Sign out"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </nav>
        </div>

        {isDemoMode && (
          <div
            role="status"
            className="border-t border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs font-medium text-amber-900"
          >
            SYNTHETIC DEMO DATA ACTIVE — Displaying seeded synthetic subscribers and campaigns for safe Phase 1 testing. Configure your MailWizz API in{' '}
            <Link href="/settings" className="underline hover:text-amber-700">
              Settings
            </Link>{' '}
            when ready to sync live data.
          </div>
        )}
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
