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
    return { category: 'Hygiene Automation', title: 'Filter & Safe Cleanup Workspace' };
  }
  if (pathname.startsWith('/reengagement')) {
    return { category: 'Hygiene Automation', title: 'Re-Engagement Orchestration' };
  }
  if (pathname.startsWith('/reports')) {
    return { category: 'Intelligence & Verification', title: 'Hygiene & Audience Reports' };
  }
  if (pathname.startsWith('/deliverability')) {
    return { category: 'Intelligence & Verification', title: 'Deliverability Diagnostics' };
  }
  if (pathname.startsWith('/compatibility')) {
    return { category: 'Intelligence & Verification', title: 'Adapter & Version Compatibility' };
  }
  if (pathname.startsWith('/settings')) {
    return { category: 'Governance', title: 'System Settings & Data Sources' };
  }
  if (pathname.startsWith('/lists/')) {
    return { category: 'Subscriber Intelligence', title: 'Mailing List Inspector' };
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
    return window.localStorage.getItem('mw-hygiene-theme') === 'dark';
  } catch {
    return false;
  }
}

function getThemeServerSnapshot(): boolean {
  return false;
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
    <div className="flex min-h-screen bg-slate-50/80 text-slate-900">
      {/* Mobile Backdrop */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-xs lg:hidden"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Left Enterprise Agent Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 flex-col border-r border-slate-200/90 bg-white transition-transform duration-200 lg:static lg:translate-x-0',
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Brand Identity Header */}
        <div className="flex h-15 items-center justify-between border-b border-slate-200/80 px-4">
          <Link
            href="/"
            className="flex items-center gap-2.5 focus-visible:outline-none"
            onClick={() => setMobileNavOpen(false)}
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white shadow-2xs">
              <Activity className="h-4 w-4 text-indigo-400" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold tracking-tight text-slate-900">
                MailWizz Hygiene
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                <StatusDot tone="emerald" pulse className="h-1.5 w-1.5" />
                <span>Agent Active • v3.0.5+</span>
              </div>
            </div>
          </Link>
          <button
            type="button"
            onClick={() => setMobileNavOpen(false)}
            className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 lg:hidden"
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
              <div className="px-2.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
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
                        'group flex items-center justify-between rounded-lg px-2.5 py-2 text-xs font-medium transition-colors',
                        isActive
                          ? 'bg-slate-900 text-white shadow-2xs'
                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                      )}
                    >
                      <span className="flex items-center gap-2.5">
                        <Icon
                          className={cn(
                            'h-4 w-4 shrink-0 transition-colors',
                            isActive
                              ? 'text-indigo-400'
                              : 'text-slate-400 group-hover:text-slate-600'
                          )}
                        />
                        <span>{item.label}</span>
                      </span>
                      {isActive && (
                        <span className="h-1.5 w-1.5 rounded-full bg-indigo-400" />
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Agent Safety Gate Posture Card in Sidebar Footer */}
        <div className="border-t border-slate-200/80 bg-slate-50/60 p-3.5 space-y-2.5">
          <div className="rounded-lg border border-slate-200/90 bg-white p-2.5 text-[11px]">
            <div className="flex items-center justify-between font-semibold text-slate-800">
              <span className="flex items-center gap-1.5">
                <Lock className="h-3.5 w-3.5 text-emerald-600" />
                Mutation Safety Gate
              </span>
              <span className="font-mono text-[10px] text-emerald-700">LOCKED</span>
            </div>
            <p className="mt-1 leading-relaxed text-slate-500">
              Remote MailWizz writes are fail-closed. AES-256-GCM snapshots active.
            </p>
          </div>

          <div className="flex items-center justify-between gap-2 px-1 text-xs">
            <div className="min-w-0">
              <div className="truncate font-medium text-slate-800" title={adminEmail}>
                {adminEmail}
              </div>
              <div className="text-[10px] text-slate-500">Authorized Operator</div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top Command Header */}
        <header className="sticky top-0 z-30 border-b border-slate-200/90 bg-white/95 backdrop-blur-xs">
          <div className="mx-auto flex h-15 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() => setMobileNavOpen(true)}
                className="inline-flex items-center justify-center rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden"
                aria-label="Open navigation menu"
              >
                <Menu className="h-4 w-4" />
              </button>

              <div className="flex items-center gap-1.5 text-xs text-slate-500 truncate">
                <span className="hidden sm:inline font-medium text-slate-500">
                  {crumb.category}
                </span>
                <ChevronRight className="hidden sm:inline h-3.5 w-3.5 text-slate-400" />
                <span className="font-semibold text-slate-900 truncate">
                  {crumb.title}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {phase1ReadOnly !== false && (
                <Badge tone="emerald">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Phase 1 Read-Only
                </Badge>
              )}
              {isDemoMode && (
                <Badge tone="amber">
                  <FlaskConical className="h-3.5 w-3.5" />
                  DEMO DATA
                </Badge>
              )}

              <button
                type="button"
                onClick={toggleTheme}
                aria-label={darkMode ? 'Switch to light theme' : 'Switch to dark theme'}
                title={darkMode ? 'Switch to light theme' : 'Switch to dark theme'}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200/90 bg-white text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
              >
                {darkMode ? (
                  <Sun className="h-3.5 w-3.5 text-amber-500" />
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
              className="border-t border-amber-200/80 bg-amber-50/90 px-4 py-1.5 text-center text-xs font-medium text-amber-900"
            >
              SYNTHETIC DEMO DATA ACTIVE — Displaying seeded synthetic subscribers and campaigns for safe Phase 1 testing. Configure your MailWizz API in{' '}
              <Link href="/settings" className="font-semibold underline hover:text-amber-700">
                Settings
              </Link>{' '}
              or onboard accounts in{' '}
              <Link href="/connections" className="font-semibold underline hover:text-amber-700">
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
