import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getServerSession } from '@/services/security/auth';
import { deriveCsrfToken } from '@/services/security/csrf';
import { isMailWizzMutationsEnabled } from '@/services/mutations/gate';
import { SettingsView } from '@/components/SettingsView';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const session = await getServerSession();
  if (!session) {
    redirect('/login');
  }

  const cfg = await prisma.appConfig.upsert({
    where: { id: 'default' },
    update: {},
    create: { id: 'default' },
  });

  const initialSettings = {
    mailwizzApiUrl: cfg.mailwizzApiUrl ?? '',
    hasMailwizzApiKey: Boolean(cfg.mailwizzApiKeyEnc),
    mailwizzApiKeyMasked: cfg.mailwizzApiKeyLast4,
    mailwizzAuthMode: cfg.mailwizzAuthMode ?? 'auto',
    mailwizzDetectedVersion: cfg.mailwizzDetectedVersion ?? null,
    hasReportingDbUrl: Boolean(cfg.reportingDbUrlEnc),
    reportingDbPrefix: cfg.reportingDbPrefix,
    hasWebhookSecret: Boolean(cfg.webhookSecretEnc),
    lookbackDays: cfg.lookbackDays,
    minDeliveredCampaigns: cfg.minDeliveredCampaigns,
    countOpensAsEngaged: cfg.countOpensAsEngaged,
    countClicksAsEngaged: cfg.countClicksAsEngaged,
    countRepliesAsEngaged: cfg.countRepliesAsEngaged,
    countConversionsAsEngaged: cfg.countConversionsAsEngaged,
    excludedDomains: Array.isArray(cfg.excludedDomainsJson)
      ? cfg.excludedDomainsJson.map(String)
      : [],
    excludedSources: Array.isArray(cfg.excludedSourcesJson)
      ? cfg.excludedSourcesJson.map(String)
      : [],
    excludeRecentSubscribersDays: cfg.excludeRecentSubscribersDays,
    maxApiRequestsPerSecond: cfg.maxApiRequestsPerSecond,
    batchSize: cfg.batchSize,
    syncScheduleCron: cfg.syncScheduleCron,
    syncScheduleEnabled: cfg.syncScheduleEnabled,
    timezone: cfg.timezone,
    reportingPeriodDays: cfg.reportingPeriodDays,
    dataRetentionDays: cfg.dataRetentionDays,
    isDemoMode: cfg.isDemoMode,
    lastValidatedAt: cfg.lastValidatedAt?.toISOString() ?? null,
    lastValidationStatus: cfg.lastValidationStatus,
    lastValidationMessage: cfg.lastValidationMessage,
    phase1ReadOnly: !isMailWizzMutationsEnabled(),
  };

  return (
    <SettingsView
      adminEmail={session.adminEmail}
      csrfToken={deriveCsrfToken(session)}
      initialSettings={initialSettings}
    />
  );
}
