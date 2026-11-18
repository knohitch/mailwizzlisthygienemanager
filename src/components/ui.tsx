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
      className={cn(
        'rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] transition-colors',
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
  emerald: 'bg-emerald-400',
  teal: 'bg-teal-400',
  amber: 'bg-amber-400',
  rose: 'bg-rose-400',
  indigo: 'bg-slate-200',
  sky: 'bg-sky-400',
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
        'inline-block h-1.5 w-1.5 shrink-0 rounded-full',
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
        'inline-flex items-center gap-1.5 rounded border px-2 py-0.5 font-mono text-[11px] font-medium leading-4 tracking-tight',
        BADGE_STYLES[tone],
        className
      )}
    >
      {dot && <StatusDot tone={tone} />}
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
        'border-b border-[var(--border-subtle)] bg-[var(--bg-well)] px-4 py-3',
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
        'text-xs font-semibold uppercase tracking-wider text-[var(--fg-primary)]',
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
    <p className={cn('mt-0.5 text-xs text-[var(--fg-muted)]', className)}>
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
  return <div className={cn('p-4', className)}>{children}</div>;
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
      'bg-[var(--fg-primary)] text-[var(--bg-canvas)] hover:opacity-90 border border-transparent disabled:opacity-35',
    secondary:
      'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 disabled:opacity-35',
    outline:
      'bg-[var(--bg-well)] text-[var(--fg-primary)] hover:bg-[var(--bg-elevated)] border border-[var(--border-default)] disabled:opacity-35',
    danger:
      'bg-rose-500/15 text-rose-400 border border-rose-500/30 hover:bg-rose-500/25 disabled:opacity-35',
    ghost:
      'bg-transparent text-[var(--fg-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--fg-primary)] border border-transparent disabled:opacity-35',
  };
  const sizes = {
    sm: 'px-2.5 py-1.5 text-xs',
    md: 'px-3.5 py-2 text-xs',
  };
  return (
    <button
      {...props}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium tracking-tight transition-all focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--fg-secondary)] disabled:cursor-not-allowed',
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
      className={cn(
        'overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)]',
        className
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-well)] px-3.5 py-2">
        <div className="flex items-center gap-2">
          <StatusDot tone="emerald" pulse />
          <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-secondary)]">
            AGENT_LOOP // DETERMINISTIC HYGIENE PIPELINE
          </span>
        </div>
        <div className="flex items-center gap-3 font-mono text-[11px] text-[var(--fg-muted)]">
          <span>
            GATE:{' '}
            <strong className="text-emerald-400">
              {phase1ReadOnly ? 'READ_ONLY_LOCK' : 'GUARDED_MUTATION'}
            </strong>
          </span>
          <span className="hidden sm:inline">•</span>
          <span className="hidden sm:inline">SNAPSHOT: AES-256-GCM</span>
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
                'group relative flex flex-col justify-between px-3.5 py-2.5 text-left transition-colors',
                isActive
                  ? 'bg-[var(--bg-elevated)] text-[var(--fg-primary)]'
                  : 'bg-[var(--bg-card)] text-[var(--fg-secondary)] hover:bg-[var(--bg-well)] hover:text-[var(--fg-primary)]'
              )}
            >
              {isActive && (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 top-0 h-0.5 bg-emerald-400"
                />
              )}
              <div className="flex items-center justify-between gap-1.5">
                <span
                  className={cn(
                    'font-mono text-[10px] uppercase tracking-wider',
                    isActive
                      ? 'font-semibold text-emerald-400'
                      : 'text-[var(--fg-muted)]'
                  )}
                >
                  [{stage.step}] {stage.label}
                </span>
                {isActive && <StatusDot tone="emerald" pulse />}
              </div>
              <div className="mt-1 truncate text-[11px] text-[var(--fg-muted)]">
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
