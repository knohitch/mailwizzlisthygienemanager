import type { EngagementEventType, EventSource, SubscriberStatus } from '@prisma/client';

/**
 * Canonical MailWizz semantic version classification.
 */
export type MailWizzVersionClassification =
  | 'BASELINE_3_0_5'
  | 'PATCH_3_0_X'
  | 'MINOR_3_X'
  | 'LEGACY_1_2_X'
  | 'FUTURE_MAJOR'
  | 'UNKNOWN_CUSTOM';

export type VersionSource =
  | 'API_HEADER_OR_META'
  | 'ADMIN_SUPPLIED'
  | 'BASELINE_DEFAULT'
  | 'UNKNOWN';

export interface ParsedMailWizzVersion {
  raw: string;
  major: number | null;
  minor: number | null;
  patch: number | null;
  prerelease: string | null;
  classification: MailWizzVersionClassification;
  isBaseline305: boolean;
  isVerifiedLineage: boolean;
}

export interface DetectedVersionInfo {
  configuredVersion: string | null;
  detectedVersion: string | null;
  approvedVersion: string | null;
  effectiveVersion: string | null;
  source: VersionSource;
  verifiedByApiSignal: boolean;
  parsed: ParsedMailWizzVersion;
  upgradeDetected: boolean;
  upgradeSummary: string | null;
}

/**
 * Explicit 5-state capability status required for MailWizz compatibility governance.
 */
export type CompatibilityCapabilityStatus =
  | 'VERIFIED'
  | 'AVAILABLE_BUT_UNTESTED'
  | 'UNSUPPORTED'
  | 'UNKNOWN'
  | 'BLOCKED';

export type CompatibilityVerdict =
  | 'FULLY VERIFIED'
  | 'PARTIALLY COMPATIBLE'
  | 'UNVERIFIED'
  | 'INCOMPATIBLE';

export type CapabilityKey =
  | 'list_discovery'
  | 'subscriber_retrieval'
  | 'subscriber_pagination'
  | 'subscriber_status_retrieval'
  | 'campaign_discovery'
  | 'campaign_statistics'
  | 'historical_engagement_retrieval'
  | 'bounce_reporting'
  | 'segment_discovery'
  | 'segment_creation'
  | 'list_creation'
  | 'subscriber_copying'
  | 'subscriber_suppression'
  | 'subscriber_unsubscribe'
  | 'webhook_event_processing';

export interface CapabilityCheckEntry {
  key: CapabilityKey;
  label: string;
  category: 'READ_CORE' | 'HISTORICAL_ENGAGEMENT' | 'SEGMENTS' | 'MUTATIONS' | 'WEBHOOKS' | 'SAFETY';
  endpointOrFeature: string;
  status: CompatibilityCapabilityStatus;
  testedReadOnly: boolean;
  criticalForSync: boolean;
  criticalForMutations: boolean;
  reason: string;
  contractErrors: string[];
  additiveFieldsObserved: string[];
  lastCheckedAt: string | null;
}

export interface ContractValidationIssue {
  severity: 'ERROR' | 'WARNING';
  code:
    | 'MISSING_REQUIRED_FIELD'
    | 'RENAMED_FIELD'
    | 'UNEXPECTED_TYPE'
    | 'PAGINATION_ANOMALY'
    | 'UNKNOWN_SUBSCRIBER_STATUS'
    | 'STATUS_SEMANTIC_DRIFT'
    | 'AUTH_DRIFT'
    | 'ENDPOINT_UNAVAILABLE'
    | 'WEBHOOK_FORMAT_CHANGE'
    | 'ADDITIVE_FIELDS_DETECTED';
  endpoint: string;
  message: string;
  fieldPath?: string;
}

export interface ContractValidationResult<T> {
  ok: boolean;
  data?: T;
  issues: ContractValidationIssue[];
  additiveFields: string[];
}

/**
 * Canonical internal domain models (adapter-normalized).
 * Core dashboards, classifier, sync, planner, and executor depend strictly on these interfaces.
 */
export interface InternalMailingList {
  listUid: string;
  name: string;
  displayName: string | null;
  description: string | null;
  fromName: string | null;
  fromEmail: string | null;
  replyTo: string | null;
  optIn: string | null;
  optOut: string | null;
  subscribersCount: number | null;
  additiveFields: string[];
}

export interface InternalSubscriber {
  subscriberUid: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  status: SubscriberStatus;
  rawStatus: string;
  unknownStatusDetected: boolean;
  source: string | null;
  dateAdded: string | null;
  additiveFields: string[];
}

export interface InternalSegmentSummary {
  segmentUid: string;
  name: string;
  subscribersCount: number;
  additiveFields: string[];
}

export interface InternalSegmentDetail {
  segmentUid: string;
  name: string;
  operatorMatch: string;
  subscribersCount: number;
  conditions: unknown[];
  campaignConditions: unknown[];
  additiveFields: string[];
}

export interface InternalCampaignSummary {
  campaignUid: string;
  campaignIdMailwizz: string | null;
  name: string;
  status: string;
  additiveFields: string[];
}

export interface InternalCampaignDetail {
  campaignUid: string;
  campaignIdMailwizz: string | null;
  name: string;
  subject: string | null;
  type: string | null;
  status: string;
  sendAt: string | null;
  dateAdded: string | null;
  listUid: string | null;
  segmentUid: string | null;
  additiveFields: string[];
}

export interface InternalCampaignStats {
  campaignStatus?: string;
  subscribersCount: number;
  processedCount: number;
  deliverySuccessCount: number;
  deliverySuccessRate: number;
  deliveryErrorCount: number;
  deliveryErrorRate: number;
  opensCount: number;
  opensRate: number;
  uniqueOpensCount: number;
  uniqueOpensRate: number;
  clicksCount: number;
  clicksRate: number;
  uniqueClicksCount: number;
  uniqueClicksRate: number;
  unsubscribesCount: number;
  unsubscribesRate: number;
  complaintsCount: number;
  complaintsRate: number;
  bouncesCount: number;
  bouncesRate: number;
  hardBouncesCount: number;
  hardBouncesRate: number;
  softBouncesCount: number;
  softBouncesRate: number;
  internalBouncesCount: number;
  internalBouncesRate: number;
  additiveFields: string[];
}

export interface InternalBounceRecord {
  subscriberUid: string;
  email: string | null;
  bounceType: 'hard' | 'soft' | 'internal' | 'unknown';
  message: string;
  processed: string;
  additiveFields: string[];
}

export interface InternalActivityRecord {
  subscriberUid: string;
  occurredAt: string | null;
  status: string | null;
  additiveFields: string[];
}

export interface InternalWebhookEvent {
  eventType: EngagementEventType | null;
  rawEventType: string;
  timestamp?: string | number;
  campaignUid: string;
  subscriberUid: string;
  listUid?: string;
  eventId?: string;
  contractWarnings: string[];
}

export interface InternalPaginatedPage<T> {
  records: T[];
  totalReportedCount: number;
  totalPages: number;
  currentPage: number;
  nextPage: number | null;
  additiveFields: string[];
}

export interface MailWizzAdapter {
  readonly id: string;
  readonly name: string;
  readonly supportedMajors: number[];
  readonly verifiedBaselineVersion: string;
  readonly isFictionalFutureStub: false;

  normalizePaginatedEnvelope<T>(
    rawPayload: unknown,
    recordNormalizer: (raw: unknown) => ContractValidationResult<T>,
    endpoint: string
  ): ContractValidationResult<InternalPaginatedPage<T>>;

  normalizeListRecord(raw: unknown, endpoint?: string): ContractValidationResult<InternalMailingList>;
  normalizeSingleListResponse(raw: unknown, endpoint?: string): ContractValidationResult<InternalMailingList>;
  normalizeSubscriberRecord(
    raw: unknown,
    endpoint?: string
  ): ContractValidationResult<InternalSubscriber>;
  normalizeSingleSubscriberResponse(
    raw: unknown,
    endpoint?: string
  ): ContractValidationResult<InternalSubscriber>;
  normalizeSegmentSummary(
    raw: unknown,
    endpoint?: string
  ): ContractValidationResult<InternalSegmentSummary>;
  normalizeSegmentDetailResponse(
    raw: unknown,
    endpoint?: string
  ): ContractValidationResult<InternalSegmentDetail>;
  normalizeCampaignSummary(
    raw: unknown,
    endpoint?: string
  ): ContractValidationResult<InternalCampaignSummary>;
  normalizeCampaignDetailResponse(
    raw: unknown,
    endpoint?: string
  ): ContractValidationResult<InternalCampaignDetail>;
  normalizeCampaignStatsResponse(
    raw: unknown,
    endpoint?: string
  ): ContractValidationResult<InternalCampaignStats>;
  normalizeBounceRecord(
    raw: unknown,
    endpoint?: string
  ): ContractValidationResult<InternalBounceRecord>;
  normalizeActivityRecord(
    raw: unknown,
    endpoint?: string
  ): ContractValidationResult<InternalActivityRecord>;
  normalizeWebhookPayload(rawPayload: unknown): {
    events: InternalWebhookEvent[];
    issues: ContractValidationIssue[];
  };
}

/**
 * Decoupled historical engagement data-source contract (Section 7).
 * Strictly separate from MailWizz mutation adapters and Alibaba DirectMail reporting.
 */
export interface HistoricalEngagementSourceResult {
  sourceKind: EventSource;
  available: boolean;
  readOnlyVerified: boolean;
  events: Array<{
    subscriberUid: string;
    campaignUid: string | null;
    listUid: string | null;
    eventType: EngagementEventType;
    occurredAt: Date;
    isHistorical: boolean;
    metadata?: Record<string, unknown>;
  }>;
  warnings: string[];
}

export interface HistoricalEngagementSourceAdapter {
  readonly id: string;
  readonly sourceKind: EventSource;
  checkAvailability(): Promise<{
    available: boolean;
    readOnlyVerified: boolean;
    details: string;
  }>;
}

export interface CompatibilityReport {
  overallStatus: CompatibilityVerdict;
  adapterInUse: string;
  adapterMode: 'VERIFIED_NATIVE' | 'PROVISIONAL_COMPAT_READONLY' | 'RESTRICTED_SAFE_MODE';
  connectionStatus: 'CONNECTED' | 'AUTH_FAILED' | 'UNREACHABLE' | 'NOT_CONFIGURED';
  versionInfo: DetectedVersionInfo;
  mutationSafetyAllowed: boolean;
  mutationLockReason: string | null;
  historicalEngagementAvailable: boolean;
  historicalEngagementSummary: string;
  capabilities: CapabilityCheckEntry[];
  warnings: string[];
  requiredManualActions: string[];
  additiveFieldsObserved: string[];
  lastVerifiedAt: string | null;
}
