import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'MailWizz List Hygiene Manager — Deliverability & Hygiene Agent',
  description:
    'Autonomous email list hygiene, subscriber engagement intelligence, multi-customer API governance, and deliverability diagnostics for MailWizz.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="min-h-screen bg-[var(--bg-canvas)] text-[var(--fg-primary)] antialiased selection:bg-emerald-500/30 selection:text-emerald-200">
        {children}
      </body>
    </html>
  );
}
