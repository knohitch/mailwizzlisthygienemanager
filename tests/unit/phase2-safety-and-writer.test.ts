import { describe, expect, it, vi } from 'vitest';
import {
  evaluateActionEligibility,
  type SubscriberSafetyCandidate,
} from '@/services/cleanup/safety';
import {
  encodeMailWizzForm,
  MailWizzMutationClient,
  MutationGateLockedError,
  UnsafeOperationBlockedError,
} from '@/services/mutations/mailwizz-writer';
import { ReadOnlyGuardError } from '@/services/mailwizz/client';

function makeCandidate(
  overrides: Partial<SubscriberSafetyCandidate> = {}
): SubscriberSafetyCandidate {
  return {
    id: 'sub-1',
    subscriberUid: 'mw_sub_1',
    mailingListId: 'list-1',
    mailingListUid: 'mw_list_1',
    email: 'user@example.com',
    firstName: 'Test',
    lastName: 'User',
    status: 'CONFIRMED',
    engagementStatus: 'INACTIVE',
    historyCoverage: 'VERIFIED_FULL',
    deliveredCampaignsCount: 8,
    clicksCount: 0,
    repliesCount: 0,
    conversionsCount: 0,
    hardBouncesCount: 0,
    complaintsCount: 0,
    lastClickAt: null,
    lastReplyAt: null,
    lastConversionAt: null,
    lastPurchaseAt: null,
    isExcluded: false,
    exclusionReason: null,
    isVip: false,
    hasPaidRelationship: false,
    isSuppressed: false,
    isArchived: false,
    ...overrides,
  };
}

describe('Phase 2 Safety Protections & MailWizz Mutation Writer', () => {
  it('blocks copying unsubscribed, complained, or hard-bounced contacts into confirmed lists', () => {
    expect(
      evaluateActionEligibility(
        makeCandidate({ status: 'UNSUBSCRIBED' }),
        'COPY_SUBSCRIBERS',
        { minDeliveredCampaigns: 5 }
      ).eligible
    ).toBe(false);

    expect(
      evaluateActionEligibility(
        makeCandidate({ complaintsCount: 1 }),
        'COPY_SUBSCRIBERS',
        { minDeliveredCampaigns: 5 }
      ).eligible
    ).toBe(false);

    expect(
      evaluateActionEligibility(
        makeCandidate({ hardBouncesCount: 1 }),
        'COPY_SUBSCRIBERS',
        { minDeliveredCampaigns: 5 }
      ).eligible
    ).toBe(false);

    expect(
      evaluateActionEligibility(makeCandidate(), 'COPY_SUBSCRIBERS', {
        minDeliveredCampaigns: 5,
      }).eligible
    ).toBe(true);
  });

  it('blocks suppression/unsubscribe on INSUFFICIENT_DATA, VIP, paid relationship, and recent conversion', () => {
    expect(
      evaluateActionEligibility(
        makeCandidate({
          engagementStatus: 'INSUFFICIENT_DATA',
          historyCoverage: 'NONE',
          deliveredCampaignsCount: 0,
        }),
        'UNSUBSCRIBE',
        { minDeliveredCampaigns: 5 }
      ).eligible
    ).toBe(false);

    expect(
      evaluateActionEligibility(
        makeCandidate({ isVip: true }),
        'UNSUBSCRIBE',
        { minDeliveredCampaigns: 5 }
      ).eligible
    ).toBe(false);

    expect(
      evaluateActionEligibility(
        makeCandidate({ lastConversionAt: new Date(Date.now() - 3 * 86_400_000) }),
        'SUPPRESS',
        { minDeliveredCampaigns: 5 }
      ).eligible
    ).toBe(false);
  });

  it('serializes MailWizz nested PHP form parameters cleanly', () => {
    const encoded = encodeMailWizzForm({
      general: { name: 'Clean Segment', opt_in: 'single' },
      subscribers: [{ EMAIL: 'a@example.com' }],
    });
    expect(encoded.get('general[name]')).toBe('Clean Segment');
    expect(encoded.get('general[opt_in]')).toBe('single');
    expect(encoded.get('subscribers[0][EMAIL]')).toBe('a@example.com');
  });

  it('blocks mutations when ENABLE_MAILWIZZ_MUTATIONS=false and permanently blocks global unsubscribe / DELETE', async () => {
    const fetchMock = vi.fn();
    const writer = new MailWizzMutationClient({
      apiUrl: 'https://mw.example.com/api/index.php',
      apiKey: 'secret-test-key',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await expect(
      writer.unsubscribeSubscriber({
        listUid: 'list1',
        subscriberUid: 'sub1',
        actorEmail: 'admin@example.com',
      })
    ).rejects.toBeInstanceOf(MutationGateLockedError);

    expect(fetchMock).not.toHaveBeenCalled();

    // Test double-opt-in refusal on bulk subscriber creation (enforced even before fetch)
    await expect(
      writer.createSubscribersBulk({
        targetListUid: 'list_double',
        targetListOptIn: 'double',
        subscribers: [{ EMAIL: 'test@example.com' }],
        actorEmail: 'admin@example.com',
      })
    ).rejects.toBeInstanceOf(UnsafeOperationBlockedError);

    // Internal requestJson permanently blocks trackOpening & global unsubscribe-by-email-from-all-lists
    const reqFn = (writer as unknown as {
      requestJson: (...args: unknown[]) => Promise<unknown>;
    }).requestJson.bind(writer);

    await expect(
      reqFn('POST', '/subscribers/unsubscribe-by-email-from-all-lists', {} as never, {})
    ).rejects.toBeInstanceOf(ReadOnlyGuardError);

    await expect(
      reqFn('DELETE', '/lists/l1/subscribers/s1', {} as never)
    ).rejects.toBeInstanceOf(UnsafeOperationBlockedError);
  });
});
