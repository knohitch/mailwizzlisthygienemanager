import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { requireApiAuth } from '@/lib/api-auth';
import { MailWizzApiError, MailWizzClient } from '@/services/mailwizz/client';
import type { MailWizzAuthMode } from '@/services/mailwizz/compat';
import { createConfiguredMailWizzClient } from '@/services/mailwizz/sync';
import { runReadOnlyCompatibilityCheck } from '@/services/mailwizz/compatibility-validator';
import {
  ensureCapabilityMatrixInitialized,
  updateCapabilityStatus,
} from '@/services/mailwizz/capability-matrix';
import { verifyMailWizzReportingSchema } from '@/services/mailwizz/reporting-db';
import { decryptSecret } from '@/services/security/crypto';
import { recordAuditLog } from '@/services/security/audit';

export async function POST(req: NextRequest) {
  const auth = await requireApiAuth(req, {
    requireCsrf: true,
    rateLimitBucket: 'settings-validate',
    limitPerMin: 20,
  });
  if (!auth.ok) return auth.response;

  await ensureCapabilityMatrixInitialized();

  try {
    const { client, reportingDbUri, reportingDbPrefix } =
      await createConfiguredMailWizzClient();

    const env = getEnv();
    const cfg = await prisma.appConfig.findUnique({ where: { id: 'default' } });
    let resolvedAuthMode: MailWizzAuthMode =
      (cfg?.mailwizzAuthMode as MailWizzAuthMode) || 'auto';
    let apiResult;
    try {
      apiResult = await client.validateConnection();
    } catch (firstErr) {
      // Auto-probe legacy 1.x HMAC and Bearer auth if standard auto/X-Api-Key got 401/403
      if (
        resolvedAuthMode === 'auto' &&
        firstErr instanceof MailWizzApiError &&
        (firstErr.statusCode === 401 || firstErr.statusCode === 403)
      ) {
        const apiUrl = cfg?.mailwizzApiUrl || env.MAILWIZZ_API_URL || '';
        const apiKey = cfg?.mailwizzApiKeyEnc
          ? decryptSecret(cfg.mailwizzApiKeyEnc)
          : env.MAILWIZZ_API_KEY || '';
        const fallbacks: MailWizzAuthMode[] = ['legacy-hmac', 'bearer'];
        let recovered = null;
        for (const mode of fallbacks) {
          try {
            const altClient = new MailWizzClient({
              apiUrl,
              apiKey,
              authMode: mode,
              maxRequestsPerSecond: cfg?.maxApiRequestsPerSecond ?? 5,
              allowInsecureHttp: env.ALLOW_INSECURE_MAILWIZZ_HTTP,
              maxRetries: 0,
            });
            recovered = await altClient.validateConnection();
            resolvedAuthMode = mode;
            break;
          } catch {
            // try next auth mode
          }
        }
        if (!recovered) throw firstErr;
        apiResult = recovered;
      } else {
        throw firstErr;
      }
    }

    await updateCapabilityStatus(
      'auth_x_api_key',
      'VERIFIED',
      apiResult.message
    );
    await updateCapabilityStatus('lists_discovery', 'VERIFIED');
    await updateCapabilityStatus('list_discovery', 'VERIFIED');

    let reportingDbResult = null;
    if (reportingDbUri) {
      try {
        reportingDbResult = await verifyMailWizzReportingSchema(
          reportingDbUri,
          reportingDbPrefix
        );
        await updateCapabilityStatus(
          'readonly_reporting_db',
          reportingDbResult.ok && reportingDbResult.isReadOnlyVerified
            ? 'VERIFIED'
            : 'UNAVAILABLE',
          reportingDbResult.notes.join(' ') ||
            `Schema check ok=${reportingDbResult.ok}, readOnly=${reportingDbResult.isReadOnlyVerified}`
        );
      } catch (dbErr) {
        await updateCapabilityStatus(
          'readonly_reporting_db',
          'UNAVAILABLE',
          dbErr instanceof Error ? dbErr.message : 'Reporting DB connection error'
        );
        reportingDbResult = {
          ok: false,
          error: dbErr instanceof Error ? dbErr.message : 'Reporting DB connection failed',
        };
      }
    }

    await prisma.appConfig.update({
      where: { id: 'default' },
      data: {
        // Preserve 'auto' preference cleanly rather than locking onto a transient fallback mode
        ...(cfg?.mailwizzAuthMode && cfg.mailwizzAuthMode !== 'auto'
          ? { mailwizzAuthMode: cfg.mailwizzAuthMode }
          : {}),
        ...(apiResult.detectedVersion
          ? { mailwizzDetectedVersion: apiResult.detectedVersion }
          : {}),
        lastValidatedAt: new Date(),
        lastValidationStatus: 'SUCCESS',
        lastValidationMessage: `${apiResult.message} (working auth: ${resolvedAuthMode})`,
      },
    });

    const compatReport = await runReadOnlyCompatibilityCheck({
      actorEmail: auth.session.adminEmail,
      ipAddress: auth.ip,
    }).catch(() => null);

    await recordAuditLog({
      actorEmail: auth.session.adminEmail,
      action: 'VALIDATE_CONNECTION',
      resourceType: 'AppConfig',
      outcome: 'SUCCESS',
      ipAddress: auth.ip,
      details: {
        listCount: apiResult.listCount,
        workingAuthMode: resolvedAuthMode,
        compatibilityStatus: compatReport?.overallStatus ?? 'UNVERIFIED',
      },
    });

    return NextResponse.json({
      ok: true,
      api: apiResult,
      reportingDb: reportingDbResult,
      compatibility: compatReport
        ? {
            overallStatus: compatReport.overallStatus,
            adapterMode: compatReport.adapterMode,
            detectedVersion: compatReport.versionInfo.detectedVersion,
          }
        : null,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'MailWizz connection validation failed.';

    await updateCapabilityStatus('auth_x_api_key', 'UNAVAILABLE', message);
    await prisma.appConfig
      .update({
        where: { id: 'default' },
        data: {
          lastValidatedAt: new Date(),
          lastValidationStatus: 'FAILED',
          lastValidationMessage: message.slice(0, 500),
        },
      })
      .catch(() => undefined);

    await recordAuditLog({
      actorEmail: auth.session.adminEmail,
      action: 'VALIDATE_CONNECTION',
      resourceType: 'AppConfig',
      outcome: 'FAILED',
      ipAddress: auth.ip,
      details: { message: message.slice(0, 200) },
    });

    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
