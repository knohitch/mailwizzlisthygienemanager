import { prisma } from '@/lib/db';
import type { HistoricalEngagementSourceAdapter } from './contracts';
import { verifyMailWizzReportingSchema } from './reporting-db';

export interface HistoricalSourcesSummary {
  anyAvailable: boolean;
  summaryText: string;
  verifiedExportCount: number;
  reportingDbAvailable: boolean;
  reportingDbDetails: string;
  nativeActivityApiSupported: boolean;
  webhookLiveCount: number;
}

export class VerifiedExportHistoricalAdapter implements HistoricalEngagementSourceAdapter {
  readonly id = 'historical-verified-export-adapter';
  readonly sourceKind = 'VERIFIED_EXPORT' as const;

  constructor(private readonly customerConnectionId?: string) {}

  async checkAvailability(): Promise<{
    available: boolean;
    readOnlyVerified: boolean;
    details: string;
  }> {
    const count = await prisma.engagementEvent.count({
      where: {
        source: 'VERIFIED_EXPORT',
        isDemoData: false,
        ...(this.customerConnectionId ? { customerConnectionId: this.customerConnectionId } : {}),
      },
    });
    return {
      available: true,
      readOnlyVerified: true,
      details:
        count > 0
          ? `${count} verified MailWizz CSV/JSON export event(s) stored cleanly.`
          : 'CSV/JSON import endpoint ready (`POST /api/reports/import`); no non-demo exports imported yet.',
    };
  }
}

export class ReadOnlyReportingDbHistoricalAdapter implements HistoricalEngagementSourceAdapter {
  readonly id = 'historical-readonly-reporting-db-adapter';
  readonly sourceKind = 'READONLY_REPORTING_DB' as const;

  constructor(
    private readonly connectionUri: string | null | undefined,
    private readonly prefix = 'mw_'
  ) {}

  async checkAvailability(): Promise<{
    available: boolean;
    readOnlyVerified: boolean;
    details: string;
  }> {
    if (!this.connectionUri) {
      return {
        available: false,
        readOnlyVerified: false,
        details: 'Optional Priority C MySQL Reporting DB URI is not configured.',
      };
    }

    try {
      const check = await verifyMailWizzReportingSchema(this.connectionUri, this.prefix);
      if (check.ok && check.isReadOnlyVerified) {
        return {
          available: true,
          readOnlyVerified: true,
          details: `Verified SELECT-only schema (${check.prefix}*) with base subscriber & campaign tables intact.`,
        };
      }
      return {
        available: false,
        readOnlyVerified: check.isReadOnlyVerified,
        details:
          check.notes.join(' ') ||
          `Reporting DB schema check failed or user is not strictly SELECT-only (ok=${check.ok}, readOnly=${check.isReadOnlyVerified}).`,
      };
    } catch (err) {
      return {
        available: false,
        readOnlyVerified: false,
        details:
          err instanceof Error ? err.message : 'Reporting DB connection failed during read-only verification.',
      };
    }
  }
}

export async function inspectHistoricalSources(params: {
  customerConnectionId?: string;
  reportingDbUri?: string | null;
  reportingDbPrefix?: string;
  nativeActivityApiSupported: boolean;
}): Promise<HistoricalSourcesSummary> {
  const connFilter = params.customerConnectionId
    ? { customerConnectionId: params.customerConnectionId }
    : {};
  const [exportCheck, reportingCheck, exportCount, webhookCount] = await Promise.all([
    new VerifiedExportHistoricalAdapter(params.customerConnectionId).checkAvailability(),
    new ReadOnlyReportingDbHistoricalAdapter(
      params.reportingDbUri,
      params.reportingDbPrefix ?? 'mw_'
    ).checkAvailability(),
    prisma.engagementEvent.count({
      where: { source: 'VERIFIED_EXPORT', isDemoData: false, ...connFilter },
    }),
    prisma.engagementEvent.count({
      where: { source: 'WEBHOOK_LIVE', isDemoData: false, ...connFilter },
    }),
  ]);

  const activePaths: string[] = [];
  if (params.nativeActivityApiSupported) activePaths.push('REST /campaigns/{uid}/{opens|clicks|delivery-logs}');
  if (reportingCheck.available) activePaths.push('SELECT-only Reporting DB (Priority C)');
  if (exportCount > 0) activePaths.push(`Verified Export Imports (${exportCount} events)`);
  if (webhookCount > 0) activePaths.push(`Live Webhooks (${webhookCount} events)`);

  const anyAvailable =
    params.nativeActivityApiSupported ||
    reportingCheck.available ||
    exportCount > 0 ||
    exportCheck.available;

  const summaryText =
    activePaths.length > 0
      ? `Active historical/engagement sources: ${activePaths.join(', ')}.`
      : 'No automated historical engagement source has ingested non-demo events yet; Priority B CSV/JSON report upload remains ready (tracking triggers stay blocked).';

  return {
    anyAvailable,
    summaryText,
    verifiedExportCount: exportCount,
    reportingDbAvailable: reportingCheck.available,
    reportingDbDetails: reportingCheck.details,
    nativeActivityApiSupported: params.nativeActivityApiSupported,
    webhookLiveCount: webhookCount,
  };
}
