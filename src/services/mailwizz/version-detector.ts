import type {
  DetectedVersionInfo,
  MailWizzVersionClassification,
  ParsedMailWizzVersion,
  VersionSource,
} from './contracts';

/**
 * Baseline MailWizz release verified by architecture and full contract regression suite.
 */
export const VERIFIED_BASELINE_VERSION = '3.0.5';

const SEMVER_EXTRACT_RE = /\b(\d+)\.(\d+)(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?/;

export class MailWizzVersionDetector {
  /**
   * Passively extracts MailWizz version metadata from official response headers
   * or standard envelope fields (`version`, `meta.version`, `data.version`).
   * Never calls any undocumented version-discovery endpoint.
   */
  extractVersionFromHttpResponse(
    headers: Pick<Headers, 'get'>,
    rawJson?: unknown
  ): string | null {
    const directHeader =
      headers.get('x-mailwizz-version') ||
      headers.get('x-mw-version') ||
      headers.get('x-app-version');
    if (directHeader && directHeader.trim()) {
      return directHeader.trim();
    }

    const poweredBy = headers.get('x-powered-by') || headers.get('server') || '';
    const explicitProductMatch = /mailwizz[/\s]+(\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?)/i.exec(
      poweredBy
    );
    if (explicitProductMatch?.[1]) {
      return explicitProductMatch[1].trim();
    }

    if (rawJson && typeof rawJson === 'object' && !Array.isArray(rawJson)) {
      const obj = rawJson as Record<string, unknown>;
      const meta =
        obj.meta && typeof obj.meta === 'object'
          ? (obj.meta as Record<string, unknown>)
          : null;
      const data =
        obj.data && typeof obj.data === 'object'
          ? (obj.data as Record<string, unknown>)
          : null;
      const record =
        data?.record && typeof data.record === 'object'
          ? (data.record as Record<string, unknown>)
          : null;

      const candidates = [
        obj.version,
        meta?.version,
        meta?.mailwizz_version,
        data?.version,
        data?.mailwizz_version,
        record?.version,
      ];
      for (const c of candidates) {
        if (typeof c === 'string' && c.trim().length > 0) {
          return c.trim();
        }
      }
    }

    return null;
  }

  /**
   * Parses any version string (`3.0.5`, `3.0.x`, `3.1.2`, `3.x`, `4.0.0`, `custom-build`)
   * into structured compatibility family classification.
   */
  parseVersion(rawVersion: string | null | undefined): ParsedMailWizzVersion {
    const trimmed = (rawVersion ?? '').trim();
    if (!trimmed) {
      return {
        raw: '',
        major: null,
        minor: null,
        patch: null,
        prerelease: null,
        classification: 'UNKNOWN_CUSTOM',
        isBaseline305: false,
        isVerifiedLineage: false,
      };
    }

    // Handle wildcard families like "3.0.x", "3.1.x", "3.x", "4.x"
    const wildcardMatch = /^v?(\d+)(?:\.(\d+|x))?(?:\.(\d+|x))?(?:-([0-9A-Za-z.-]+))?$/i.exec(
      trimmed
    );

    let major: number | null = null;
    let minor: number | null = null;
    let patch: number | null = null;
    let prerelease: string | null = null;

    if (wildcardMatch) {
      major = Number(wildcardMatch[1]);
      minor =
        wildcardMatch[2] && wildcardMatch[2].toLowerCase() !== 'x'
          ? Number(wildcardMatch[2])
          : null;
      patch =
        wildcardMatch[3] && wildcardMatch[3].toLowerCase() !== 'x'
          ? Number(wildcardMatch[3])
          : null;
      prerelease = wildcardMatch[4] ?? null;
    } else {
      const semverMatch = SEMVER_EXTRACT_RE.exec(trimmed);
      if (semverMatch) {
        major = Number(semverMatch[1]);
        minor = Number(semverMatch[2]);
        patch = semverMatch[3] !== undefined ? Number(semverMatch[3]) : null;
        prerelease = semverMatch[4] ?? null;
      }
    }

    let classification: MailWizzVersionClassification = 'UNKNOWN_CUSTOM';
    if (major !== null) {
      if (major === 1 || major === 2) {
        classification = 'LEGACY_1_2_X';
      } else if (major === 3) {
        if (minor === 0 && patch === 5 && !prerelease) {
          classification = 'BASELINE_3_0_5';
        } else if (minor === 0) {
          classification = 'PATCH_3_0_X';
        } else {
          classification = 'MINOR_3_X';
        }
      } else if (major >= 4) {
        classification = 'FUTURE_MAJOR';
      }
    }

    return {
      raw: trimmed,
      major,
      minor,
      patch,
      prerelease,
      classification,
      isBaseline305: classification === 'BASELINE_3_0_5',
      isVerifiedLineage:
        classification === 'BASELINE_3_0_5' || classification === 'PATCH_3_0_X',
    };
  }

  /**
   * Compiles complete version resolution combining API-observed version,
   * administrator-configured version (marked unverified), and previously approved baseline.
   */
  resolveVersionInfo(params: {
    configuredVersion?: string | null;
    detectedVersion?: string | null;
    approvedVersion?: string | null;
  }): DetectedVersionInfo {
    const configuredVersion = params.configuredVersion?.trim() || null;
    const detectedVersion = params.detectedVersion?.trim() || null;
    const approvedVersion = params.approvedVersion?.trim() || null;

    let effectiveVersion: string | null = null;
    let source: VersionSource = 'UNKNOWN';
    let verifiedByApiSignal = false;

    if (detectedVersion) {
      effectiveVersion = detectedVersion;
      source = 'API_HEADER_OR_META';
      verifiedByApiSignal = true;
    } else if (configuredVersion) {
      effectiveVersion = configuredVersion;
      source = 'ADMIN_SUPPLIED';
      verifiedByApiSignal = false;
    } else if (approvedVersion) {
      effectiveVersion = approvedVersion;
      source = 'BASELINE_DEFAULT';
      verifiedByApiSignal = false;
    }

    const parsed = this.parseVersion(effectiveVersion);
    const baselineComparisonTarget = approvedVersion ?? VERIFIED_BASELINE_VERSION;

    let upgradeDetected = false;
    let upgradeSummary: string | null = null;

    if (effectiveVersion && effectiveVersion !== baselineComparisonTarget) {
      const targetParsed = this.parseVersion(baselineComparisonTarget);
      if (parsed.major !== null && targetParsed.major !== null) {
        if (parsed.major > targetParsed.major) {
          upgradeDetected = true;
          upgradeSummary = `Major MailWizz upgrade detected (${baselineComparisonTarget} → ${effectiveVersion}). Mutations remain fail-closed until upgraded contract validation passes and administrator approves the new version.`;
        } else if (
          parsed.major === targetParsed.major &&
          parsed.minor !== null &&
          targetParsed.minor !== null &&
          (parsed.minor !== targetParsed.minor ||
            (parsed.patch !== null &&
              targetParsed.patch !== null &&
              parsed.patch > targetParsed.patch))
        ) {
          upgradeDetected = true;
          upgradeSummary = `MailWizz version changed from ${baselineComparisonTarget} to ${effectiveVersion}. Re-run read-only compatibility validation before approving mutations.`;
        }
      } else if (parsed.classification === 'UNKNOWN_CUSTOM') {
        upgradeDetected = true;
        upgradeSummary = `Unrecognized/custom MailWizz version "${effectiveVersion}" differs from approved baseline ${baselineComparisonTarget}. Treating capabilities conservatively until read-only checks pass.`;
      }
    }

    if (source === 'ADMIN_SUPPLIED' && configuredVersion && !upgradeSummary) {
      upgradeSummary = `Using administrator-supplied MailWizz version "${configuredVersion}" (UNVERIFIED — MailWizz server did not emit an authenticated API version header).`;
    }

    return {
      configuredVersion,
      detectedVersion,
      approvedVersion,
      effectiveVersion,
      source,
      verifiedByApiSignal,
      parsed,
      upgradeDetected,
      upgradeSummary,
    };
  }
}

export const mailWizzVersionDetector = new MailWizzVersionDetector();
