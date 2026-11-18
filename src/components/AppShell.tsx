'use client';

import React, { useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Activity,
  BarChart3,
  ChevronRight,
  Filter,
  FlaskConical,
  GitCompareArrows,
  Globe,
  LayoutDashboard,
  Lock,
  LogOut,
  MailCheck,
  Menu,
  Moon,
  PlugZap,
  Settings,
  ShieldCheck,
  Sun,
  X,
} from 'lucide-react';
import { Badge, Button, StatusDot, cn } from './ui';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  matchExact?: boolean;
}

interface NavGroup {
  groupLabel: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    groupLabel: 'Command & Accounts',
    items: [
      {
        href: '/',
        label: 'Dashboard',
        icon: LayoutDashboard,
        matchExact: true,
      },
      {
        href: '/connections',
        label: 'Connections',
        icon: PlugZap,
      },
    ],
  },
  {
    groupLabel: 'Hygiene Automation',
    items: [
      {
        href: '/cleanup',
        label: 'Filter & Cleanup',
        icon: Filter,
      },
      {
        href: '/reengagement',
        label: 'Re-Engagement',
        icon: MailCheck,
      },
    ],
  },
  {
    groupLabel: 'Intelligence & Verification',
    items: [
      {
        href: '/reports',
        label: 'Reports',
        icon: BarChart3,
      },
      {
        href: '/deliverability',
        label: 'Deliverability',
        icon: Globe,
      },
      {
        href: '/compatibility',
        label: 'Compatibility',
        icon: GitCompareArrows,
      },
    ],
  },
  {
    groupLabel: 'Governance',
    items: [
      {
        href: '/settings',
        label: 'Settings & Sources',
        icon: Settings,
      },
    ],
  },
];

function getWorkspaceBreadcrumb(pathname: string): {
  category: string;
  title: string;
} {
  if (pathname === '/') {
    return { category: 'Command & Accounts', title: 'Agent Command Center' };
  }
  if (pathname.startsWith('/connections')) {
    return { category: 'Command & Accounts', title: 'Customer API Connections' };
  }
  if (pathname.startsWith('/cleanup')) {
    return {
      category: 'Hygiene Automation',
      title: 'Filter & Safe Cleanup Workspace',
    };
  }
  if (pathname.startsWith('/reengagement')) {
    return {
      category: 'Hygiene Automation',
      title: 'Re-Engagement Orchestration',
    };
  }
  if (pathname.startsWith('/reports')) {
    return {
      category: 'Intelligence & Verification',
      title: 'Hygiene & Audience Reports',
    };
  }
  if (pathname.startsWith('/deliverability')) {
    return {
      category: 'Intelligence & Verification',
      title: 'Deliverability Diagnostics',
    };
  }
  if (pathname.startsWith('/compatibility')) {
    return {
      category: 'Intelligence & Verification',
      title: 'Adapter & Version Compatibility',
    };
  }
  if (pathname.startsWith('/settings')) {
    return {
      category: 'Governance',
      title: 'System Settings & Data Sources',
    };
  }
  if (pathname.startsWith('/lists/')) {
    return {
      category: 'Subscriber Intelligence',
      title: 'Mailing List Inspector',
    };
  }
  return { category: 'Workspace', title: 'MailWizz Hygiene Agent' };
}

function subscribeTheme(callback: () => void) {
  window.addEventListener('mw-theme-change', callback);
  window.addEventListener('storage', callback);
  return () => {
    window.removeEventListener('mw-theme-change', callback);
    window.removeEventListener('storage', callback);
  };
}

function getThemeSnapshot(): boolean {
  try {
    const saved = window.localStorage.getItem('mw-hygiene-theme');
    return saved ? saved === 'dark' : true;
  } catch {
    return true;
  }
}

function getThemeServerSnapshot(): boolean {
  return true;
}

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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const darkMode = useSyncExternalStore(
    subscribeTheme,
    getThemeSnapshot,
    getThemeServerSnapshot
  );

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  function toggleTheme() {
    const next = !darkMode;
    document.documentElement.classList.toggle('dark', next);
    try {
      window.localStorage.setItem('mw-hygiene-theme', next ? 'dark' : 'light');
      window.dispatchEvent(new Event('mw-theme-change'));
    } catch {
      // ignore storage errors
    }
  }

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

  const crumb = getWorkspaceBreadcrumb(pathname);

  return (
    <div className="flex min-h-screen bg-[var(--bg-canvas)] text-[var(--fg-primary)]">
      {/* Mobile Backdrop */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/70 backdrop-blur-xs lg:hidden"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Left Agent Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-sidebar)] transition-transform duration-200 lg:static lg:translate-x-0',
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Agent Brand Identity Header */}
        <div className="flex h-16 items-center justify-between border-b border-[var(--border-subtle)] px-4">
          <Link
            href="/"
            className="flex items-center gap-3 focus-visible:outline-none"
            onClick={() => setMobileNavOpen(false)}
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--accent-border)] bg-[var(--accent-bg)] text-[var(--accent-fg)]">
              <Activity className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="font-display truncate text-base font-extrabold tracking-tight text-[var(--fg-primary)]">
                MailWizz Hygiene
              </div>
              <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--fg-secondary)]">
                <StatusDot tone="emerald" pulse />
                <span>Agent Active • v3.0.5+</span>
              </div>
            </div>
          </Link>
          <button
            type="button"
            onClick={() => setMobileNavOpen(false)}
            className="rounded-lg p-1.5 text-[var(--fg-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--fg-primary)] lg:hidden"
            aria-label="Close navigation menu"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Grouped Navigation */}
        <nav
          className="flex-1 space-y-6 overflow-y-auto px-3.5 py-5"
          aria-label="Primary navigation"
        >
          {NAV_GROUPS.map((group) => (
            <div key={group.groupLabel} className="space-y-1.5">
              <div className="font-display px-3 text-xs font-extrabold uppercase tracking-wider text-[var(--fg-muted)]">
                {group.groupLabel}
              </div>
              <div className="space-y-1">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = item.matchExact
                    ? pathname === item.href
                    : pathname.startsWith(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileNavOpen(false)}
                      className={cn(
                        'font-display group relative flex items-center justify-between rounded-lg px-3 py-2.5 text-sm font-bold transition-colors',
                        isActive
                          ? 'border border-[var(--accent-border)] bg-[var(--accent-bg)] text-[var(--fg-primary)]'
                          : 'border border-transparent text-[var(--fg-secondary)] hover:bg-[var(--bg-well)] hover:text-[var(--fg-primary)]'
                      )}
                    >
                      <span className="flex items-center gap-3">
                        <Icon
                          className={cn(
                            'h-4 w-4 shrink-0 transition-colors',
                            isActive
                              ? 'text-[var(--accent-fg)]'
                              : 'text-[var(--fg-muted)] group-hover:text-[var(--fg-secondary)]'
                          )}
                        />
                        <span>{item.label}</span>
                      </span>
                      {isActive && (
                        <span aria-hidden="true">
                          <StatusDot tone="emerald" />
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Agent Safety Gate Telemetry Footer */}
        <div className="space-y-3 border-t border-[var(--border-subtle)] bg-[var(--bg-well)] p-3.5">
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3 text-xs">
            <div className="font-display flex items-center justify-between font-bold text-[var(--fg-primary)]">
              <span className="flex items-center gap-1.5">
                <Lock className="h-3.5 w-3.5 text-[var(--accent-fg)]" />
                Mutation Gate
              </span>
              <span className="text-[var(--accent-fg)]">Fail-Closed</span>
            </div>
            <p className="mt-1 leading-relaxed text-[var(--fg-secondary)]">
              Remote MailWizz writes are locked. AES-256-GCM snapshots active.
            </p>
          </div>

          <div className="flex items-center justify-between gap-2 px-1">
            <div className="min-w-0">
              <div
                className="font-display truncate text-xs font-bold text-[var(--fg-primary)]"
                title={adminEmail}
              >
                {adminEmail}
              </div>
              <div className="text-xs text-[var(--fg-muted)]">
                Authorized Operator
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top Command Header */}
        <header className="sticky top-0 z-30 border-b border-[var(--border-subtle)] bg-[var(--bg-sidebar)]">
          <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={() => setMobileNavOpen(true)}
                className="inline-flex items-center justify-center rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] p-2 text-[var(--fg-secondary)] hover:bg-[var(--bg-elevated)] lg:hidden"
                aria-label="Open navigation menu"
              >
                <Menu className="h-4 w-4" />
              </button>

              <div className="font-display flex items-center gap-2 truncate text-sm">
                <span className="hidden font-semibold text-[var(--fg-muted)] sm:inline">
                  {crumb.category}
                </span>
                <ChevronRight className="hidden h-4 w-4 text-[var(--fg-muted)] sm:inline" />
                <span className="truncate font-extrabold text-[var(--fg-primary)]">
                  {crumb.title}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              {phase1ReadOnly !== false && (
                <Badge tone="emerald" dot>
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Phase 1 Read-Only
                </Badge>
              )}
              {isDemoMode && (
                <Badge tone="amber" dot>
                  <FlaskConical className="h-3.5 w-3.5" />
                  DEMO DATA
                </Badge>
              )}

              <button
                type="button"
                onClick={toggleTheme}
                aria-label={
                  darkMode ? 'Switch to light theme' : 'Switch to dark theme'
                }
                title={
                  darkMode ? 'Switch to light theme' : 'Switch to dark theme'
                }
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] text-[var(--fg-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--fg-primary)]"
              >
                {darkMode ? (
                  <Sun className="h-4 w-4 text-amber-400" />
                ) : (
                  <Moon className="h-4 w-4" />
                )}
              </button>

              <Button
                variant="outline"
                size="sm"
                onClick={handleLogout}
                aria-label="Sign out"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Sign out</span>
              </Button>
            </div>
          </div>

          {isDemoMode && (
            <div
              role="status"
              className="border-t border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs font-semibold text-amber-900"
            >
              SYNTHETIC DEMO DATA ACTIVE — Displaying seeded synthetic
              subscribers and campaigns for safe Phase 1 testing. Configure your
              MailWizz API in{' '}
              <Link
                href="/settings"
                className="font-bold underline hover:opacity-80"
              >
                Settings
              </Link>{' '}
              or onboard accounts in{' '}
              <Link
                href="/connections"
                className="font-bold underline hover:opacity-80"
              >
                Customer Connections
              </Link>{' '}
              when ready to sync live data.
            </div>
          )}
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
          {children}
        </main>
      </div>
    </div>
  );
}
