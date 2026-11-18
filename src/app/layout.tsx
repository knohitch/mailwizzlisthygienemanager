import type { Metadata } from 'next';
import { Nunito, Open_Sans } from 'next/font/google';
import './globals.css';

const nunito = Nunito({
  subsets: ['latin'],
  weight: ['600', '700', '800'],
  variable: '--font-nunito',
  display: 'swap',
});

const openSans = Open_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-open-sans',
  display: 'swap',
});

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
    <html
      lang="en"
      className={`dark ${nunito.variable} ${openSans.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-[var(--bg-canvas)] text-[var(--fg-primary)] antialiased selection:bg-emerald-500/25 selection:text-[var(--fg-primary)]">
        {children}
      </body>
    </html>
  );
}
