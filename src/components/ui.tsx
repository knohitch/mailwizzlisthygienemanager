import React from 'react';
import Link from 'next/link';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function Card({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      style={{ boxShadow: 'var(--card-shadow)' }}
      className={cn(
        'rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] transition-colors',
        className
      )}
    >
      {children}
    </div>
  );
}

export type BadgeTone =
  | 'slate'
  | 'emerald'
  | 'teal'
  | 'amber'
  | 'rose'
  | 'indigo'
  | 'sky';

const BADGE_STYLES: Record<BadgeTone, string> = {
  slate:
    'bg-[var(--bg-elevated)] text-[var(--fg-secondary)] border-[var(--border-default)]',
  emerald: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  teal: 'bg-teal-50 text-teal-800 border-teal-200',
  amber: 'bg-amber-50 text-amber-800 border-amber-200',
  rose: 'bg-rose-50 text-rose-800 border-rose-200',
  indigo:
    'bg-[var(--bg-elevated)] text-[var(--fg-primary)] border-[var(--border-strong)]',
  sky: 'bg-sky-50 text-sky-800 border-sky-200',
};

const DOT_STYLES: Record<BadgeTone, string> = {
  slate: 'bg-slate-400',
  emerald: 'bg-emerald-500',
  teal: 'bg-teal-500',
  amber: 'bg-amber-500',
  rose: 'bg-rose-500',
  indigo: 'bg-slate-400',
  sky: 'bg-sky-500',
};

export function StatusDot({
  tone = 'slate',
  pulse = false,
  className,
}: {
  tone?: BadgeTone;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block h-2 w-2 shrink-0 rounded-full',
        DOT_STYLES[tone],
        pulse && 'animate-pulse',
        className
      )}
    />
  );
}

export function Badge({
  tone = 'slate',
  dot = false,
  className,
  children,
}: {
  tone?: BadgeTone;
  dot?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'font-display inline-flex items-center gap-1.5 rounded-md border px-2.5 py-0.5 text-xs font-bold leading-5 tracking-tight',
        BADGE_STYLES[tone],
        className
      )}
    >
      {dot && <StatusDot tone={tone} className="h-1.5 w-1.5" />}
      {children}
    </span>
  );
}

export function CardHeader({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'border-b border-[var(--border-subtle)] bg-[var(--bg-well)] px-5 py-3.5',
        className
      )}
    >
      {children}
    </div>
  );
}

export function CardTitle({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <h2
      className={cn(
        'font-display text-base font-bold tracking-tight text-[var(--fg-primary)]',
        className
      )}
    >
      {children}
    </h2>
  );
}

export function CardDescription({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <p className={cn('mt-0.5 text-xs text-[var(--fg-secondary)]', className)}>
      {children}
    </p>
  );
}

export function CardContent({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={cn('p-5', className)}>{children}</div>;
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost';
  size?: 'sm' | 'md';
}) {
  const variants = {
    primary:
      'bg-[var(--fg-primary)] text-[var(--bg-canvas)] hover:opacity-90 border border-transparent disabled:opacity-55',
    secondary:
      'bg-[var(--accent-bg)] text-[var(--accent-fg)] border border-[var(--accent-border)] hover:opacity-90 disabled:opacity-55',
    outline:
      'bg-[var(--bg-card)] text-[var(--fg-primary)] hover:bg-[var(--bg-elevated)] border border-[var(--border-default)] disabled:opacity-55',
    danger:
      'bg-rose-600 text-white border border-rose-500 hover:bg-rose-500 disabled:opacity-55',
    ghost:
      'bg-transparent text-[var(--fg-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--fg-primary)] border border-transparent disabled:opacity-55',
  };
  const sizes = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
  };
  return (
    <button
      {...props}
      className={cn(
        'font-display inline-flex items-center justify-center gap-1.5 rounded-lg font-bold tracking-tight transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-fg)] disabled:cursor-not-allowed',
        variants[variant],
        sizes[size],
        className
      )}
    />
  );
}

export type AgentStageId =
  | 'observe'
  | 'analyze'
  | 'recommend'
  | 'review'
  | 'execute'
  | 'verify';

const AGENT_STAGES: Array<{
  id: AgentStageId;
  step: string;
  label: string;
  summary: string;
  href: string;
}> = [
  {
    id: 'observe',
    step: '01',
    label: 'Observe',
    summary: 'API Discovery & Sync',
    href: '/connections',
  },
  {
    id: 'analyze',
    step: '02',
    label: 'Analyze',
    summary: 'Engagement & History',
    href: '/',
  },
  {
    id: 'recommend',
    step: '03',
    label: 'Recommend',
    summary: 'Candidate Selection',
    href: '/reports',
  },
  {
    id: 'review',
    step: '04',
    label: 'Review',
    summary: 'Dry-Run & Snapshot',
    href: '/cleanup',
  },
  {
    id: 'execute',
    step: '05',
    label: 'Execute',
    summary: 'Guarded Batch Queue',
    href: '/reengagement',
  },
  {
    id: 'verify',
    step: '06',
    label: 'Verify',
    summary: 'Audit & Deliverability',
    href: '/deliverability',
  },
];

export function AgentWorkflowStrip({
  activeStage,
  phase1ReadOnly = true,
  className,
}: {
  activeStage: AgentStageId;
  phase1ReadOnly?: boolean;
  className?: string;
}) {
  return (
    <div
      aria-label="Agent operational workflow pipeline"
      style={{ boxShadow: 'var(--card-shadow)' }}
      className={cn(
        'overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)]',
        className
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-well)] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <StatusDot tone="emerald" pulse />
          <span className="font-display text-xs font-bold uppercase tracking-wider text-[var(--fg-primary)]">
            Autonomous Hygiene Agent Pipeline
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs font-semibold text-[var(--fg-secondary)]">
          <span>
            Execution Mode:{' '}
            <strong className="text-[var(--accent-fg)]">
              {phase1ReadOnly
                ? 'Read-Only Lock Active'
                : 'Full Operations Active'}
            </strong>
          </span>
          <span className="hidden text-[var(--fg-muted)] sm:inline">•</span>
          <span className="hidden text-[var(--fg-muted)] sm:inline">
            Snapshot: AES-256-GCM
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 divide-x divide-y divide-[var(--border-subtle)] sm:grid-cols-3 lg:grid-cols-6 lg:divide-y-0">
        {AGENT_STAGES.map((stage) => {
          const isActive = stage.id === activeStage;
          return (
            <Link
              key={stage.id}
              href={stage.href}
              className={cn(
                'group relative flex flex-col justify-between px-4 py-3 text-left transition-colors',
                isActive
                  ? 'bg-[var(--accent-bg)] text-[var(--fg-primary)]'
                  : 'bg-[var(--bg-card)] text-[var(--fg-secondary)] hover:bg-[var(--bg-well)] hover:text-[var(--fg-primary)]'
              )}
            >
              {isActive && (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 top-0 h-0.5 bg-[var(--accent-fg)]"
                />
              )}
              <div className="flex items-center justify-between gap-1.5">
                <span
                  className={cn(
                    'font-display text-xs font-bold uppercase tracking-wide',
                    isActive
                      ? 'text-[var(--accent-fg)]'
                      : 'text-[var(--fg-muted)]'
                  )}
                >
                  Stage {stage.step}
                </span>
                {isActive && <StatusDot tone="emerald" pulse />}
              </div>
              <div className="font-display mt-0.5 text-sm font-bold text-[var(--fg-primary)]">
                {stage.label}
              </div>
              <div className="mt-0.5 truncate text-xs text-[var(--fg-secondary)]">
                {stage.summary}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export function HygieneStatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'ENGAGED_STRONG':
      return (
        <Badge tone="emerald" dot>
          Engaged (Click/Strong)
        </Badge>
      );
    case 'ENGAGED_OPEN_ONLY':
      return (
        <Badge tone="teal" dot>
          Engaged (Open-Only)
        </Badge>
      );
    case 'INACTIVE_CANDIDATE':
      return (
        <Badge tone="amber" dot>
          Potentially Inactive
        </Badge>
      );
    case 'INSUFFICIENT_HISTORY':
      return (
        <Badge tone="sky" dot>
          Insufficient History
        </Badge>
      );
    case 'UNKNOWN':
      return (
        <Badge tone="slate" dot>
          UNKNOWN History
        </Badge>
      );
    case 'HARD_BOUNCED':
      return (
        <Badge tone="rose" dot>
          Hard Bounced
        </Badge>
      );
    case 'COMPLAINED':
      return (
        <Badge tone="rose" dot>
          Complained
        </Badge>
      );
    case 'UNSUBSCRIBED':
      return <Badge tone="slate">Unsubscribed</Badge>;
    case 'UNCONFIRMED':
      return <Badge tone="indigo">Unconfirmed</Badge>;
    case 'BLACKLISTED':
      return (
        <Badge tone="rose" dot>
          Blacklisted
        </Badge>
      );
    case 'EXCLUDED':
      return (
        <Badge tone="indigo" dot>
          Excluded
        </Badge>
      );
    default:
      return <Badge tone="slate">{status}</Badge>;
  }
}

export function EngagementClassBadge({ status }: { status: string }) {
  switch (status) {
    case 'ACTIVE':
      return (
        <Badge tone="emerald" dot>
          ACTIVE
        </Badge>
      );
    case 'COOLING':
      return (
        <Badge tone="teal" dot>
          COOLING
        </Badge>
      );
    case 'INACTIVE':
      return (
        <Badge tone="amber" dot>
          INACTIVE
        </Badge>
      );
    case 'LONG_TERM_INACTIVE':
      return (
        <Badge tone="rose" dot>
          LONG-TERM INACTIVE
        </Badge>
      );
    case 'NEVER_ENGAGED':
      return (
        <Badge tone="rose" dot>
          NEVER ENGAGED
        </Badge>
      );
    case 'INSUFFICIENT_DATA':
      return (
        <Badge tone="sky" dot>
          INSUFFICIENT DATA
        </Badge>
      );
    case 'EXCLUDED':
      return (
        <Badge tone="indigo" dot>
          EXCLUDED
        </Badge>
      );
    default:
      return <Badge tone="slate">{status}</Badge>;
  }
}
