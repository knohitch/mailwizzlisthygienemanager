'use client';

import React, { useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
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
  Terminal,
  X,
} from 'lucide-react';
import { Badge, Button, StatusDot, cn } from './ui';

interface NavItem {
  href: string;
  label: string;
  code: string;
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
        code: 'CMD',
        icon: LayoutDashboard,
        matchExact: true,
      },
      {
        href: '/connections',
        label: 'Connections',
        code: 'API',
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
        code: 'CLN',
        icon: Filter,
      },
      {
        href: '/reengagement',
        label: 'Re-Engagement',
        code: 'RNG',
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
        code: 'RPT',
        icon: BarChart3,
      },
      {
        href: '/deliverability',
        label: 'Deliverability',
        code: 'DLV',
        icon: Globe,
      },
      {
        href: '/compatibility',
        label: 'Compatibility',
        code: 'CMP',
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
        code: 'CFG',
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

      {/* Left Charcoal Agent Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-sidebar)] transition-transform duration-200 lg:static lg:translate-x-0',
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Agent Brand Identity Header */}
        <div className="flex h-14 items-center justify-between border-b border-[var(--border-subtle)] px-4">
          <Link
            href="/"
            className="flex items-center gap-2.5 focus-visible:outline-none"
            onClick={() => setMobileNavOpen(false)}
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-[var(--border-default)] bg-[var(--bg-elevated)] text-emerald-400">
              <Terminal className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0">
              <div className="truncate font-mono text-xs font-semibold tracking-tight text-[var(--fg-primary)]">
                MW_HYGIENE_AGENT
              </div>
              <div className="flex items-center gap-1.5 font-mono text-[10px] text-[var(--fg-muted)]">
                <StatusDot tone="emerald" pulse />
                <span>ONLINE // v3.0.5+</span>
              </div>
            </div>
          </Link>
          <button
            type="button"
            onClick={() => setMobileNavOpen(false)}
            className="rounded p-1 text-[var(--fg-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--fg-primary)] lg:hidden"
            aria-label="Close navigation menu"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Grouped Navigation */}
        <nav
          className="flex-1 space-y-5 overflow-y-auto px-3 py-4"
          aria-label="Primary navigation"
        >
          {NAV_GROUPS.map((group) => (
            <div key={group.groupLabel} className="space-y-1">
              <div className="px-2.5 font-mono text-[10px] font-semibold uppercase tracking-widest text-[var(--fg-muted)]">
                {group.groupLabel}
              </div>
              <div className="space-y-0.5">
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
                        'group relative flex items-center justify-between rounded-md px-2.5 py-2 text-xs font-medium transition-colors',
                        isActive
                          ? 'border border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--fg-primary)]'
                          : 'border border-transparent text-[var(--fg-secondary)] hover:bg-[var(--bg-card)] hover:text-[var(--fg-primary)]'
                      )}
                    >
                      <span className="flex items-center gap-2.5">
                        <Icon
                          className={cn(
                            'h-3.5 w-3.5 shrink-0 transition-colors',
                            isActive
                              ? 'text-emerald-400'
                              : 'text-[var(--fg-muted)] group-hover:text-[var(--fg-secondary)]'
                          )}
                        />
                        <span>{item.label}</span>
                      </span>
                      <span
                        aria-hidden="true"
                        className="flex items-center gap-1.5"
                      >
                        <span className="font-mono text-[10px] text-[var(--fg-muted)]">
                          {item.code}
                        </span>
                        {isActive && <StatusDot tone="emerald" />}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Agent Safety Gate Telemetry Footer */}
        <div className="space-y-2.5 border-t border-[var(--border-subtle)] bg-[var(--bg-well)] p-3">
          <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] p-2.5 font-mono text-[10px]">
            <div className="flex items-center justify-between font-semibold text-[var(--fg-primary)]">
              <span className="flex items-center gap-1.5">
                <Lock className="h-3 w-3 text-emerald-400" />
                MUTATION_GATE
              </span>
              <span className="text-emerald-400">FAIL_CLOSED</span>
            </div>
            <div className="mt-1.5 space-y-0.5 text-[var(--fg-muted)]">
              <div>WRITE_LOCK: ENABLED</div>
              <div>CIPHER: AES-256-GCM</div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 px-1 text-xs">
            <div className="min-w-0">
              <div
                className="truncate font-mono text-[11px] font-medium text-[var(--fg-primary)]"
                title={adminEmail}
              >
                {adminEmail}
              </div>
              <div className="font-mono text-[10px] text-[var(--fg-muted)]">
                OPERATOR // AUTH_ACTIVE
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top Charcoal Command Header */}
        <header className="sticky top-0 z-30 border-b border-[var(--border-subtle)] bg-[var(--bg-sidebar)]">
          <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={() => setMobileNavOpen(true)}
                className="inline-flex items-center justify-center rounded-md border border-[var(--border-default)] bg-[var(--bg-card)] p-1.5 text-[var(--fg-secondary)] hover:bg-[var(--bg-elevated)] lg:hidden"
                aria-label="Open navigation menu"
              >
                <Menu className="h-4 w-4" />
              </button>

              <div className="flex items-center gap-1.5 truncate font-mono text-xs">
                <span className="hidden text-[var(--fg-muted)] sm:inline">
                  {crumb.category}
                </span>
                <ChevronRight className="hidden h-3.5 w-3.5 text-[var(--fg-muted)] sm:inline" />
                <span className="truncate font-semibold text-[var(--fg-primary)]">
                  {crumb.title}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {phase1ReadOnly !== false && (
                <Badge tone="emerald" dot>
                  <ShieldCheck className="h-3 w-3" />
                  Phase 1 Read-Only
                </Badge>
              )}
              {isDemoMode && (
                <Badge tone="amber" dot>
                  <FlaskConical className="h-3 w-3" />
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
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border-default)] bg-[var(--bg-card)] text-[var(--fg-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--fg-primary)]"
              >
                {darkMode ? (
                  <Sun className="h-3.5 w-3.5 text-amber-400" />
                ) : (
                  <Moon className="h-3.5 w-3.5" />
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
              className="border-t border-amber-200 bg-amber-50 px-4 py-1.5 text-center font-mono text-[11px] font-medium text-amber-900"
            >
              SYNTHETIC DEMO DATA ACTIVE — Displaying seeded synthetic
              subscribers and campaigns for safe Phase 1 testing. Configure your
              MailWizz API in{' '}
              <Link
                href="/settings"
                className="font-semibold underline hover:opacity-80"
              >
                Settings
              </Link>{' '}
              or onboard accounts in{' '}
              <Link
                href="/connections"
                className="font-semibold underline hover:opacity-80"
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
