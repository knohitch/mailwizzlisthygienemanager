import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'MailWizz List Hygiene Manager',
  description:
    'Self-hosted MailWizz 3.0.5 read-only list hygiene analytics, engagement classification, and deliverability dashboard.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        {children}
      </body>
    </html>
  );
}
