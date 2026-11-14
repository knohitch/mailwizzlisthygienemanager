import type {
  CompatibilityReport,
  DetectedVersionInfo,
  MailWizzAdapter,
} from './contracts';
import { mailWizzV3Adapter } from './adapter-v3';
import { VERIFIED_BASELINE_VERSION } from './version-detector';

export interface ResolvedAdapterContext {
  adapter: MailWizzAdapter;
  adapterMode: CompatibilityReport['adapterMode'];
  mutationSafetyAllowed: boolean;
  mutationLockReason: string | null;
  autoCleanupAllowed: boolean;
  warnings: string[];
  requiredManualActions: string[];
}

export class MailWizzFutureAdapterResolver {
  resolve(params: {
    versionInfo: DetectedVersionInfo;
    envMutationsEnabled: boolean;
    coreContractsPassed?: boolean;
    approvedVersionPassedCheck?: boolean;
  }): ResolvedAdapterContext {
    const { versionInfo, envMutationsEnabled } = params;
    const { classification, raw } = versionInfo.parsed;
    const warnings: string[] = [];
    const requiredManualActions: string[] = [];

    const effective = versionInfo.effectiveVersion ?? versionInfo.approvedVersion ?? VERIFIED_BASELINE_VERSION;
    const isExplicitlyApproved =
      Boolean(versionInfo.approvedVersion) &&
      versionInfo.effectiveVersion === versionInfo.approvedVersion &&
      (params.approvedVersionPassedCheck ?? true);

    let adapterMode: CompatibilityReport['adapterMode'] = 'PROVISIONAL_COMPAT_READONLY';
    let mutationSafetyAllowed = false;
    let mutationLockReason: string | null = null;
    let autoCleanupAllowed = false;

    if (params.coreContractsPassed === false) {
      adapterMode = 'RESTRICTED_SAFE_MODE';
      mutationSafetyAllowed = false;
      autoCleanupAllowed = false;
      mutationLockReason =
        'Core MailWizz API contract checks failed. Automated cleanup and remote mutations are fail-closed to protect subscriber records.';
      warnings.push(mutationLockReason);
      requiredManualActions.push(
        'Inspect failed capability checks below and compare API payloads against MAILWIZZ_UPGRADE_VALIDATION.md before running syncs or mutations.'
      );
      return {
        adapter: mailWizzV3Adapter,
        adapterMode,
        mutationSafetyAllowed,
        mutationLockReason,
        autoCleanupAllowed,
        warnings,
        requiredManualActions,
      };
    }

    if (classification === 'FUTURE_MAJOR' || classification === 'UNKNOWN_CUSTOM') {
      adapterMode = 'RESTRICTED_SAFE_MODE';
      mutationSafetyAllowed = false;
      autoCleanupAllowed = false;
      mutationLockReason =
        classification === 'FUTURE_MAJOR'
          ? `Detected future major MailWizz release (${raw || effective}). No fictional V${versionInfo.parsed.major} adapter is assumed; remote mutations and auto-cleanup are fail-closed until full contract tests pass.`
          : `Unrecognized or custom MailWizz version "${raw || effective}". Mutations and auto-cleanup remain locked fail-closed until read-only verification succeeds.`;
      warnings.push(mutationLockReason);
      requiredManualActions.push(
        'Back up PostgreSQL state, test all endpoints in a disposable staging environment, inspect release notes for breaking changes, and verify every read-only contract before approving.'
      );
    } else if (classification === 'MINOR_3_X') {
      if (isExplicitlyApproved && params.coreContractsPassed) {
        adapterMode = 'VERIFIED_NATIVE';
        autoCleanupAllowed = true;
        if (envMutationsEnabled) {
          mutationSafetyAllowed = true;
        } else {
          mutationLockReason =
            'ENABLE_MAILWIZZ_MUTATIONS=false (Phase 1 safe read-only mode active).';
        }
      } else {
        adapterMode = 'PROVISIONAL_COMPAT_READONLY';
        mutationSafetyAllowed = false;
        autoCleanupAllowed = false;
        mutationLockReason = `Newer 3.x version (${effective}) is reusing the 3.x adapter in provisional read-only mode until administrator compatibility approval.`;
        warnings.push(mutationLockReason);
        requiredManualActions.push(
          `Run a non-mutating Compatibility Check against ${effective} and click "Approve Verified Version" only if all critical contracts pass.`
        );
      }
    } else {
      // BASELINE_3_0_5, PATCH_3_0_X, or LEGACY_1_2_X with verified contracts
      if (versionInfo.upgradeDetected && !isExplicitlyApproved) {
        adapterMode = 'PROVISIONAL_COMPAT_READONLY';
        mutationSafetyAllowed = false;
        autoCleanupAllowed = false;
        mutationLockReason = `Version transition (${versionInfo.approvedVersion ?? VERIFIED_BASELINE_VERSION} → ${effective}) detected; mutations stay paused pending administrator confirmation.`;
        warnings.push(mutationLockReason);
        requiredManualActions.push(
          'Confirm patch-version check results and approve the active baseline version.'
        );
      } else {
        adapterMode = params.coreContractsPassed === true ? 'VERIFIED_NATIVE' : 'PROVISIONAL_COMPAT_READONLY';
        autoCleanupAllowed = params.coreContractsPassed === true;
        if (!envMutationsEnabled) {
          mutationSafetyAllowed = false;
          mutationLockReason =
            'ENABLE_MAILWIZZ_MUTATIONS=false (Phase 1 safe read-only lock active).';
        } else if (params.coreContractsPassed === true) {
          mutationSafetyAllowed = true;
        } else {
          mutationSafetyAllowed = false;
          mutationLockReason =
            'Run and pass read-only compatibility verification before enabling live mutations.';
        }
      }
    }

    if (versionInfo.source === 'ADMIN_SUPPLIED' && versionInfo.configuredVersion) {
      warnings.push(
        `Configured version "${versionInfo.configuredVersion}" is administrator-supplied (UNVERIFIED — MailWizz server did not expose an official API version header).`
      );
    }

    return {
      adapter: mailWizzV3Adapter,
      adapterMode,
      mutationSafetyAllowed,
      mutationLockReason,
      autoCleanupAllowed,
      warnings,
      requiredManualActions,
    };
  }
}

export const mailWizzFutureAdapterResolver = new MailWizzFutureAdapterResolver();
