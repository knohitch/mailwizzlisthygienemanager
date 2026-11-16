import { NextRequest, NextResponse } from 'next/server';
import { requireApiAuth } from '@/lib/api-auth';
import { recordAuditLog } from '@/services/security/audit';
import {
  generateAllReportsSummary,
  generateReportCsv,
  type HygieneReportType,
} from '@/services/reports/generator';

const VALID_REPORT_TYPES = new Set<HygieneReportType>([
  'ACTIVE_AUDIENCE',
  'INACTIVE_AUDIENCE',
  'NEVER_ENGAGED',
  'SUPPRESSION_RECOMMENDATIONS',
  'REENGAGEMENT',
  'CLEANUP_EXECUTION',
  'BEFORE_AFTER_COMPARISON',
  'DATA_QUALITY',
]);

export async function GET(req: NextRequest) {
  const auth = await requireApiAuth(req, { rateLimitBucket: 'reports-read' });
  if (!auth.ok) return auth.response;

  const sp = new URL(req.url).searchParams;
  const customerConnectionId =
    sp.get('customerConnectionId')?.trim() ||
    sp.get('connectionId')?.trim() ||
    undefined;
  const mailingListId = sp.get('mailingListId')?.trim() || undefined;
  const format = sp.get('format')?.trim() || 'json';
  const reportType = sp.get('reportType')?.trim() as HygieneReportType | undefined;
  const mask = sp.get('mask') === 'true';

  if (format === 'csv' && reportType && VALID_REPORT_TYPES.has(reportType)) {
    const { filename, csv, rowCount } = await generateReportCsv({
      reportType,
      customerConnectionId,
      mailingListId,
      maskContacts: mask,
    });
    await recordAuditLog({
      customerConnectionId,
      actorEmail: auth.session.adminEmail,
      action: 'EXPORT_HYGIENE_REPORT_CSV',
      resourceType: 'HygieneReport',
      resourceId: reportType,
      outcome: 'SUCCESS',
      ipAddress: auth.ip,
      details: {
        customerConnectionId: customerConnectionId ?? 'ALL',
        mailingListId: mailingListId ?? 'ALL',
        rowCount,
        masked: mask,
      },
    });
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  const summary = await generateAllReportsSummary(mailingListId, customerConnectionId);
  return NextResponse.json(summary);
}
