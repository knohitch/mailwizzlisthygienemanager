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
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased selection:bg-indigo-600 selection:text-white">
        {children}
      </body>
    </html>
  );
}
