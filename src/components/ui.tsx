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
        'rounded-xl border border-slate-200/90 bg-white shadow-2xs transition-colors',
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
  slate: 'bg-slate-100/90 text-slate-700 border-slate-200/90',
  emerald: 'bg-emerald-50/90 text-emerald-800 border-emerald-200/80',
  teal: 'bg-teal-50/90 text-teal-800 border-teal-200/80',
  amber: 'bg-amber-50/90 text-amber-800 border-amber-200/80',
  rose: 'bg-rose-50/90 text-rose-800 border-rose-200/80',
  indigo: 'bg-indigo-50/90 text-indigo-800 border-indigo-200/80',
  sky: 'bg-sky-50/90 text-sky-800 border-sky-200/80',
};

const DOT_STYLES: Record<BadgeTone, string> = {
  slate: 'bg-slate-400',
  emerald: 'bg-emerald-500',
  teal: 'bg-teal-500',
  amber: 'bg-amber-500',
  rose: 'bg-rose-500',
  indigo: 'bg-indigo-500',
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
        'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium leading-5 tracking-tight',
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
        'border-b border-slate-100 bg-slate-50/40 px-5 py-3.5',
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
        'text-sm font-semibold tracking-tight text-slate-900',
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
    <p className={cn('mt-0.5 text-xs text-slate-500', className)}>
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
      'bg-slate-900 text-white hover:bg-slate-800 disabled:bg-slate-400 border border-slate-900/10 shadow-2xs',
    secondary:
      'bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-indigo-300 border border-indigo-600/20 shadow-2xs',
    outline:
      'bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900 border border-slate-300/90 disabled:opacity-50 shadow-2xs',
    danger:
      'bg-rose-600 text-white hover:bg-rose-500 disabled:bg-rose-300 border border-rose-600/20 shadow-2xs',
    ghost:
      'bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900 border border-transparent disabled:opacity-50',
  };
  const sizes = {
    sm: 'px-2.5 py-1.5 text-xs',
    md: 'px-3.5 py-2 text-sm',
  };
  return (
    <button
      {...props}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed',
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
        'rounded-xl border border-slate-200/90 bg-white px-4 py-3 shadow-2xs',
        className
      )}
    >
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
        <div className="flex items-center gap-2">
          <StatusDot tone="indigo" pulse />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Autonomous Hygiene Agent Pipeline
          </span>
        </div>
        <span className="font-mono text-[11px] text-slate-500">
          {phase1ReadOnly
            ? 'Remote Mutation Lock: ACTIVE (Read-Only / Dry-Run Mode)'
            : 'Remote Mutation Lock: GUARDED'}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {AGENT_STAGES.map((stage) => {
          const isActive = stage.id === activeStage;
          return (
            <Link
              key={stage.id}
              href={stage.href}
              className={cn(
                'group flex flex-col justify-between rounded-lg border px-3 py-2 text-left transition-colors',
                isActive
                  ? 'border-indigo-500/40 bg-indigo-50/60 text-slate-900'
                  : 'border-slate-200/70 bg-slate-50/40 text-slate-600 hover:border-slate-300 hover:bg-slate-50'
              )}
            >
              <div className="flex items-center justify-between gap-1.5">
                <span
                  className={cn(
                    'font-mono text-[10px] font-semibold uppercase tracking-wider',
                    isActive ? 'text-indigo-600' : 'text-slate-400 group-hover:text-slate-600'
                  )}
                >
                  Stage {stage.step}
                </span>
                {isActive && (
                  <span className="h-1.5 w-1.5 rounded-full bg-indigo-600" />
                )}
              </div>
              <div className="mt-0.5 text-xs font-semibold text-slate-900">
                {stage.label}
              </div>
              <div className="text-[11px] text-slate-500 truncate">
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
