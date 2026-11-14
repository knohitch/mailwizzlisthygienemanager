import React from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function Card({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'rounded-xl border border-slate-200 bg-white shadow-xs',
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
  slate: 'bg-slate-100 text-slate-700 border-slate-200',
  emerald: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  teal: 'bg-teal-50 text-teal-800 border-teal-200',
  amber: 'bg-amber-50 text-amber-800 border-amber-200',
  rose: 'bg-rose-50 text-rose-800 border-rose-200',
  indigo: 'bg-indigo-50 text-indigo-800 border-indigo-200',
  sky: 'bg-sky-50 text-sky-800 border-sky-200',
};

export function Badge({
  tone = 'slate',
  className,
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        BADGE_STYLES[tone],
        className
      )}
    >
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
    <div className={cn('border-b border-slate-100 px-5 py-3.5', className)}>
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
    <h2 className={cn('text-sm font-semibold text-slate-900', className)}>
      {children}
    </h2>
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
      'bg-slate-900 text-white hover:bg-slate-800 disabled:bg-slate-400 border border-transparent',
    secondary:
      'bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-indigo-300 border border-transparent',
    outline:
      'bg-white text-slate-700 hover:bg-slate-50 border border-slate-300 disabled:opacity-50',
    danger:
      'bg-rose-600 text-white hover:bg-rose-500 disabled:bg-rose-300 border border-transparent',
    ghost:
      'bg-transparent text-slate-600 hover:bg-slate-100 border border-transparent disabled:opacity-50',
  };
  const sizes = {
    sm: 'px-2.5 py-1.5 text-xs',
    md: 'px-3.5 py-2 text-sm',
  };
  return (
    <button
      {...props}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed',
        variants[variant],
        sizes[size],
        className
      )}
    />
  );
}

export function HygieneStatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'ENGAGED_STRONG':
      return <Badge tone="emerald">Engaged (Click/Strong)</Badge>;
    case 'ENGAGED_OPEN_ONLY':
      return <Badge tone="teal">Engaged (Open-Only)</Badge>;
    case 'INACTIVE_CANDIDATE':
      return <Badge tone="amber">Potentially Inactive</Badge>;
    case 'INSUFFICIENT_HISTORY':
      return <Badge tone="sky">Insufficient History</Badge>;
    case 'UNKNOWN':
      return <Badge tone="slate">UNKNOWN History</Badge>;
    case 'HARD_BOUNCED':
      return <Badge tone="rose">Hard Bounced</Badge>;
    case 'COMPLAINED':
      return <Badge tone="rose">Complained</Badge>;
    case 'UNSUBSCRIBED':
      return <Badge tone="slate">Unsubscribed</Badge>;
    case 'UNCONFIRMED':
      return <Badge tone="indigo">Unconfirmed</Badge>;
    case 'BLACKLISTED':
      return <Badge tone="rose">Blacklisted</Badge>;
    case 'EXCLUDED':
      return <Badge tone="indigo">Excluded</Badge>;
    default:
      return <Badge tone="slate">{status}</Badge>;
  }
}

export function EngagementClassBadge({ status }: { status: string }) {
  switch (status) {
    case 'ACTIVE':
      return <Badge tone="emerald">ACTIVE</Badge>;
    case 'COOLING':
      return <Badge tone="teal">COOLING</Badge>;
    case 'INACTIVE':
      return <Badge tone="amber">INACTIVE</Badge>;
    case 'LONG_TERM_INACTIVE':
      return <Badge tone="rose">LONG-TERM INACTIVE</Badge>;
    case 'NEVER_ENGAGED':
      return <Badge tone="rose">NEVER ENGAGED</Badge>;
    case 'INSUFFICIENT_DATA':
      return <Badge tone="sky">INSUFFICIENT DATA</Badge>;
    case 'EXCLUDED':
      return <Badge tone="indigo">EXCLUDED</Badge>;
    default:
      return <Badge tone="slate">{status}</Badge>;
  }
}
