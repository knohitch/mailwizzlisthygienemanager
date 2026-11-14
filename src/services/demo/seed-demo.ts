import { prisma } from '@/lib/db';
import { hashEmail, sha256Hex } from '@/services/security/crypto';
import { ensureCapabilityMatrixInitialized } from '@/services/mailwizz/capability-matrix';
import { recomputeAllHygieneClassifications } from '@/services/analysis/classifier';
import { reconcileListsAndCampaigns } from '@/services/analysis/reconciliation';
import type { EngagementEventType, Prisma, SubscriberStatus } from '@prisma/client';

function seededNumber(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

export async function seedSyntheticDemoData(options?: {
  allowWhenRealDataExists?: boolean;
}): Promise<{
  listsCreated: number;
  subscribersCreated: number;
  campaignsCreated: number;
  eventsCreated: number;
}> {
  if (!options?.allowWhenRealDataExists) {
    const [realLists, realSubscribers, cfg] = await Promise.all([
      prisma.mailingList.count({ where: { isDemoData: false } }),
      prisma.subscriber.count({ where: { isDemoData: false } }),
      prisma.appConfig.findUnique({ where: { id: 'default' } }),
    ]);

    if (realLists > 0 || realSubscribers > 0 || Boolean(cfg?.mailwizzApiUrl)) {
      throw new Error(
        `Refusing to seed synthetic demo data because real (non-demo) MailWizz data or connection configuration already exists (realLists=${realLists}, realSubscribers=${realSubscribers}).`
      );
    }
  }

  await ensureCapabilityMatrixInitialized();

  // Clear existing demo data cleanly before re-seeding
  await prisma.engagementEvent.deleteMany({ where: { isDemoData: true } });
  await prisma.subscriber.deleteMany({ where: { isDemoData: true } });
  await prisma.listSegment.deleteMany({ where: { isDemoData: true } });
  await prisma.campaign.deleteMany({ where: { isDemoData: true } });
  await prisma.mailingList.deleteMany({ where: { isDemoData: true } });
  await prisma.directMailDailyMetric.deleteMany({ where: { isDemoData: true } });
  await prisma.inboxPlacementTest.deleteMany({ where: { isDemoData: true } });
  await prisma.postmasterStat.deleteMany({ where: { isDemoData: true } });

  await prisma.appConfig.upsert({
    where: { id: 'default' },
    update: { isDemoMode: true },
    create: {
      id: 'default',
      isDemoMode: true,
      lookbackDays: 90,
      minDeliveredCampaigns: 5,
    },
  });

  const now = new Date();
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);

  // 3 lists including the primary ~1,800 subscriber list
  const listDefs = [
    {
      listUid: 'demo-list-main-1800',
      name: 'Main Product Newsletter (Demo)',
      displayName: 'Main Product Newsletter',
      description: 'Primary customer & prospect newsletter (~1,800 subscribers)',
      fromName: 'Acme Marketing',
      fromEmail: 'newsletter@example.com',
      replyTo: 'support@example.com',
      count: 1800,
      withHistoricalEvents: true,
    },
    {
      listUid: 'demo-list-vip-buyers',
      name: 'VIP Customers & Trial Users (Demo)',
      displayName: 'VIP Customers',
      description: 'Active SaaS purchasers and trial signups',
      fromName: 'Acme Success',
      fromEmail: 'success@example.com',
      replyTo: 'success@example.com',
      count: 240,
      withHistoricalEvents: true,
    },
    {
      listUid: 'demo-list-api-only',
      name: 'Legacy Partner List - API Only (Demo)',
      displayName: 'Legacy Partner List (No Event History)',
      description:
        'Demonstrates UNKNOWN hygiene state when only MailWizz 3.0.5 REST API is connected without Priority B/C/D engagement logs.',
      fromName: 'Acme Partners',
      fromEmail: 'partners@example.com',
      replyTo: 'partners@example.com',
      count: 150,
      withHistoricalEvents: false,
    },
  ];

  const createdLists: Array<{ id: string; listUid: string; withHistoricalEvents: boolean; count: number }> = [];

  for (const def of listDefs) {
    const ml = await prisma.mailingList.create({
      data: {
        listUid: def.listUid,
        name: def.name,
        displayName: def.displayName,
        description: def.description,
        fromName: def.fromName,
        fromEmail: def.fromEmail,
        replyTo: def.replyTo,
        apiReportedCount: def.count,
        isDemoData: true,
        lastSyncedAt: now,
      },
    });
    createdLists.push({
      id: ml.id,
      listUid: def.listUid,
      withHistoricalEvents: def.withHistoricalEvents,
      count: def.count,
    });
  }

  // Campaigns for the lists (spanning 210+ days on list 0 to showcase Cooling / Inactive / Long-Term Inactive / Never Engaged)
  const campaignDefs = [
    { uid: 'demo-camp-01', listIdx: 0, name: 'Q1 Roadmap Kickoff', sendDaysAgo: 205, openRate: 0.36, clickRate: 0.09, bounceHard: 4, bounceSoft: 3, complaints: 1 },
    { uid: 'demo-camp-02', listIdx: 0, name: 'Q2 Product Deep Dive', sendDaysAgo: 155, openRate: 0.33, clickRate: 0.08, bounceHard: 4, bounceSoft: 3, complaints: 0 },
    { uid: 'demo-camp-03', listIdx: 0, name: 'Deliverability Best Practices', sendDaysAgo: 112, openRate: 0.31, clickRate: 0.07, bounceHard: 5, bounceSoft: 4, complaints: 0 },
    { uid: 'demo-camp-04', listIdx: 0, name: 'Autumn Feature Roundup', sendDaysAgo: 72, openRate: 0.29, clickRate: 0.06, bounceHard: 3, bounceSoft: 2, complaints: 1 },
    { uid: 'demo-camp-05', listIdx: 0, name: 'Annual Benchmark Report', sendDaysAgo: 21, openRate: 0.32, clickRate: 0.09, bounceHard: 3, bounceSoft: 2, complaints: 1 },
    { uid: 'demo-camp-06', listIdx: 0, name: 'November Product Digest', sendDaysAgo: 7, openRate: 0.30, clickRate: 0.07, bounceHard: 2, bounceSoft: 1, complaints: 0 },
    { uid: 'demo-camp-07', listIdx: 1, name: 'VIP Onboarding Tips #1', sendDaysAgo: 55, openRate: 0.48, clickRate: 0.16, bounceHard: 1, bounceSoft: 1, complaints: 0 },
    { uid: 'demo-camp-08', listIdx: 1, name: 'VIP Onboarding Tips #2', sendDaysAgo: 35, openRate: 0.46, clickRate: 0.15, bounceHard: 0, bounceSoft: 1, complaints: 0 },
    { uid: 'demo-camp-09', listIdx: 1, name: 'VIP Onboarding Tips #3', sendDaysAgo: 18, openRate: 0.51, clickRate: 0.18, bounceHard: 1, bounceSoft: 0, complaints: 0 },
    { uid: 'demo-camp-10', listIdx: 1, name: 'VIP Quarterly Roadmap', sendDaysAgo: 8, openRate: 0.49, clickRate: 0.14, bounceHard: 0, bounceSoft: 0, complaints: 0 },
    { uid: 'demo-camp-11', listIdx: 1, name: 'VIP Renewal Check-In', sendDaysAgo: 3, openRate: 0.44, clickRate: 0.12, bounceHard: 0, bounceSoft: 0, complaints: 0 },
    { uid: 'demo-camp-12', listIdx: 2, name: 'Partner Bulletin (API-Only)', sendDaysAgo: 15, openRate: 0.22, clickRate: 0.04, bounceHard: 2, bounceSoft: 1, complaints: 0 },
  ];

  const createdCampaigns: Array<{ id: string; campaignUid: string; listIdx: number; sendAt: Date }> = [];
  for (const c of campaignDefs) {
    const ml = createdLists[c.listIdx];
    const sendAt = daysAgo(c.sendDaysAgo);
    const subsCount = ml.count;
    const hardBounces = c.bounceHard;
    const softBounces = c.bounceSoft;
    const bouncesCount = hardBounces + softBounces;
    const deliverySuccess = subsCount - bouncesCount;
    const uniqueOpens = Math.round(deliverySuccess * c.openRate);
    const uniqueClicks = Math.round(deliverySuccess * c.clickRate);

    const savedCamp = await prisma.campaign.create({
      data: {
        campaignUid: c.uid,
        mailingListId: ml.id,
        listUid: ml.listUid,
        name: c.name,
        subject: c.name,
        type: 'regular',
        status: 'sent',
        sendAt,
        dateAddedMailwizz: daysAgo(c.sendDaysAgo + 2),
        subscribersCount: subsCount,
        processedCount: subsCount,
        deliverySuccessCount: deliverySuccess,
        deliverySuccessRate: Number(((deliverySuccess / subsCount) * 100).toFixed(2)),
        deliveryErrorCount: bouncesCount,
        deliveryErrorRate: Number(((bouncesCount / subsCount) * 100).toFixed(2)),
        opensCount: Math.round(uniqueOpens * 1.3),
        opensRate: Number((c.openRate * 130).toFixed(2)),
        uniqueOpensCount: uniqueOpens,
        uniqueOpensRate: Number((c.openRate * 100).toFixed(2)),
        clicksCount: Math.round(uniqueClicks * 1.25),
        clicksRate: Number((c.clickRate * 125).toFixed(2)),
        uniqueClicksCount: uniqueClicks,
        uniqueClicksRate: Number((c.clickRate * 100).toFixed(2)),
        unsubscribesCount: Math.round(subsCount * 0.004),
        unsubscribesRate: 0.4,
        complaintsCount: c.complaints,
        complaintsRate: Number(((c.complaints / subsCount) * 100).toFixed(2)),
        bouncesCount,
        bouncesRate: Number(((bouncesCount / subsCount) * 100).toFixed(2)),
        hardBouncesCount: hardBounces,
        hardBouncesRate: Number(((hardBounces / subsCount) * 100).toFixed(2)),
        softBouncesCount: softBounces,
        softBouncesRate: Number(((softBounces / subsCount) * 100).toFixed(2)),
        internalBouncesCount: 0,
        internalBouncesRate: 0,
        isDemoData: true,
        lastSyncedAt: now,
      },
    });
    createdCampaigns.push({
      id: savedCamp.id,
      campaignUid: c.uid,
      listIdx: c.listIdx,
      sendAt,
    });
  }

  // Create native segments per list
  for (const ml of createdLists) {
    await prisma.listSegment.create({
      data: {
        mailingListId: ml.id,
        segmentUid: `${ml.listUid}-seg-confirmed`,
        name: 'Confirmed Subscribers (Native)',
        operatorMatch: 'all',
        apiSubscribersCount: Math.round(ml.count * 0.85),
        conditionsJson: [{ field: 'status', operator: 'is', value: 'confirmed' }],
        campaignConditionsJson: [],
        isDemoData: true,
        lastSyncedAt: now,
      },
    });
  }

  const domains = [
    'gmail.com',
    'outlook.com',
    'yahoo.com',
    'proton.me',
    'company.io',
    'vipclient.com',
  ];

  const subscriberRows: Prisma.SubscriberCreateManyInput[] = [];
  let globalIdx = 0;

  for (let listIdx = 0; listIdx < createdLists.length; listIdx++) {
    const ml = createdLists[listIdx];
    for (let i = 0; i < ml.count; i++) {
      globalIdx++;
      const r = seededNumber(globalIdx);
      let status: SubscriberStatus = 'CONFIRMED';
      if (r > 0.96) status = 'BLACKLISTED';
      else if (r > 0.90) status = 'UNSUBSCRIBED';
      else if (r > 0.84) status = 'UNCONFIRMED';

      const domain =
        i % 50 === 0 ? 'vipclient.com' : domains[globalIdx % (domains.length - 1)];
      const email =
        i === 1 && (listIdx === 0 || listIdx === 1)
          ? 'shared.multilist@gmail.com'
          : `demo.user.${listIdx + 1}.${i + 1}@${domain}`;
      if (i === 1 && listIdx === 0) status = 'CONFIRMED';
      if (i === 1 && listIdx === 1) status = 'UNSUBSCRIBED';
      const subUid = `demo_sub_${listIdx + 1}_${String(i + 1).padStart(4, '0')}`;
      const dateAdded =
        status === 'CONFIRMED' && i % 40 === 0 && i > 1
          ? daysAgo(5) // recent grace period
          : daysAgo(210 + (i % 160));

      subscriberRows.push({
        mailingListId: ml.id,
        subscriberUid: subUid,
        email,
        emailHash: hashEmail(email),
        firstName: `Demo${i + 1}`,
        lastName: `Subscriber`,
        status,
        rawStatus: status.toLowerCase(),
        source: i % 3 === 0 ? 'api' : 'import',
        dateAddedMailwizz: dateAdded,
        isVip: listIdx === 1 && i > 0 && i % 25 === 0,
        hasPaidRelationship: listIdx === 1 && i > 0 && i % 15 === 0,
        isDemoData: true,
        lastSyncedAt: now,
      });
    }
  }

  await prisma.subscriber.createMany({ data: subscriberRows });

  // Fetch inserted subscriber IDs to attach synthetic EngagementEvents
  const insertedSubs = await prisma.subscriber.findMany({
    where: { isDemoData: true },
    select: {
      id: true,
      mailingListId: true,
      subscriberUid: true,
      status: true,
      dateAddedMailwizz: true,
    },
  });

  const listById = new Map(createdLists.map((l, idx) => [l.id, { ...l, idx }]));
  const eventRows: Prisma.EngagementEventCreateManyInput[] = [];

  for (let sIdx = 0; sIdx < insertedSubs.length; sIdx++) {
    const sub = insertedSubs[sIdx];
    const listMeta = listById.get(sub.mailingListId);
    if (!listMeta) continue;

    const listCampaigns = createdCampaigns.filter((c) => c.listIdx === listMeta.idx);
    const numMatch = Number(sub.subscriberUid.split('_').pop() ?? sIdx);

    // List 2 (API-only demo) gets ONLY 2 API bounce log events and ZERO delivery/open/click logs
    if (!listMeta.withHistoricalEvents) {
      if (sub.status === 'CONFIRMED' && numMatch <= 2 && listCampaigns[0]) {
        eventRows.push({
          subscriberId: sub.id,
          campaignId: listCampaigns[0].id,
          mailingListId: sub.mailingListId,
          eventType: 'HARD_BOUNCE',
          source: 'API_BOUNCE_LOG',
          occurredAt: listCampaigns[0].sendAt,
          isHistorical: true,
          isDemoData: true,
          dedupeKey: sha256Hex(`DEMO|${sub.id}|${listCampaigns[0].id}|HARD_BOUNCE`),
          metadataJson: { message: '550 5.1.1 User unknown (Demo)' },
        });
      }
      continue;
    }

    if (sub.status !== 'CONFIRMED') continue;

    // Assign realistic cohorts for the 1,800-subscriber & 240-subscriber lists:
    const cohort = numMatch % 100;

    // Hard bounces (~1.5% of confirmed)
    if (cohort === 1 && listCampaigns[0]) {
      eventRows.push({
        subscriberId: sub.id,
        campaignId: listCampaigns[0].id,
        mailingListId: sub.mailingListId,
        eventType: 'HARD_BOUNCE',
        source: 'API_BOUNCE_LOG',
        occurredAt: listCampaigns[0].sendAt,
        isHistorical: true,
        isDemoData: true,
        dedupeKey: sha256Hex(`DEMO|${sub.id}|${listCampaigns[0].id}|HARD_BOUNCE`),
        metadataJson: { message: '550 5.1.1 Recipient address rejected (Demo)' },
      });
      continue;
    }

    // Complaints (~0.5%)
    if (cohort === 2 && listCampaigns[0]) {
      eventRows.push({
        subscriberId: sub.id,
        campaignId: listCampaigns[0].id,
        mailingListId: sub.mailingListId,
        eventType: 'COMPLAINT',
        source: 'SYNTHETIC_DEMO',
        occurredAt: listCampaigns[0].sendAt,
        isHistorical: true,
        isDemoData: true,
        dedupeKey: sha256Hex(`DEMO|${sub.id}|${listCampaigns[0].id}|COMPLAINT`),
      });
      continue;
    }

    // Insufficient history (<5 delivered campaigns, e.g. 2-3 delivered) (~10%)
    const campaignsToDeliver =
      cohort >= 3 && cohort <= 12
        ? listCampaigns.slice(-3)
        : listCampaigns;

    for (const camp of campaignsToDeliver) {
      eventRows.push({
        subscriberId: sub.id,
        campaignId: camp.id,
        mailingListId: sub.mailingListId,
        eventType: 'DELIVERED',
        source: 'SYNTHETIC_DEMO',
        occurredAt: camp.sendAt,
        isHistorical: true,
        isDemoData: true,
        dedupeKey: sha256Hex(`DEMO|${sub.id}|${camp.id}|DELIVERED`),
      });
    }

    const pushEngagement = (
      camp: { id: string; sendAt: Date },
      eventType: EngagementEventType
    ) => {
      eventRows.push({
        subscriberId: sub.id,
        campaignId: camp.id,
        mailingListId: sub.mailingListId,
        eventType,
        source: 'SYNTHETIC_DEMO',
        occurredAt: new Date(camp.sendAt.getTime() + 3600_000),
        isHistorical: true,
        isDemoData: true,
        dedupeKey: sha256Hex(`DEMO|${sub.id}|${camp.id}|${eventType}`),
      });
    };

    const latestCamp = campaignsToDeliver[campaignsToDeliver.length - 1];
    if (!latestCamp) continue;

    if (cohort >= 13 && cohort <= 32) {
      // Strong engaged within active window (<60d) (~20%), plus click-without-open edge case
      if (cohort === 15) {
        pushEngagement(latestCamp, 'CLICK');
      } else {
        pushEngagement(latestCamp, 'OPEN');
        pushEngagement(latestCamp, 'CLICK');
      }
    } else if (cohort >= 33 && cohort <= 48) {
      // Open-only active within <60 days (~16%)
      pushEngagement(latestCamp, 'OPEN');
    } else if (cohort >= 49 && cohort <= 62 && listCampaigns[3]) {
      // COOLING (~72 days ago on list 0, 60-89d window)
      pushEngagement(listCampaigns[3], 'OPEN');
    } else if (cohort >= 63 && cohort <= 76 && campaignsToDeliver.length >= 5) {
      // INACTIVE (~112 days ago on list 0, 90-179d window)
      if (listCampaigns[2]) {
        pushEngagement(listCampaigns[2], 'OPEN');
      }
    } else if (cohort >= 77 && cohort <= 88 && campaignsToDeliver.length >= 5) {
      // LONG_TERM_INACTIVE (~205 days ago on list 0, >=180d window)
      if (listCampaigns[0]) {
        pushEngagement(listCampaigns[0], 'CLICK');
      }
    }
    // Remaining cohort 89..99 with >=5 delivered campaigns and 0 engagements -> NEVER_ENGAGED!
  }

  // Batch insert events in chunks of 2,000
  const chunkSize = 2000;
  for (let i = 0; i < eventRows.length; i += chunkSize) {
    await prisma.engagementEvent.createMany({
      data: eventRows.slice(i, i + chunkSize),
      skipDuplicates: true,
    });
  }

  await recomputeAllHygieneClassifications();
  await reconcileListsAndCampaigns();

  // Seed clearly-labeled synthetic Phase 3 Deliverability demo fixtures
  const dayUtc = (d: number) => {
    const dt = daysAgo(d);
    return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
  };

  const dmDays = [180, 150, 120, 90, 60, 45, 30, 14, 7, 2];
  await prisma.directMailDailyMetric.createMany({
    data: dmDays.map((d, idx) => {
      const reqs = 1850 + idx * 40;
      const fails = Math.max(12, Math.round(reqs * (0.042 - idx * 0.002)));
      const invalids = Math.round(fails * 0.65);
      return {
        metricDate: dayUtc(d),
        domainName: 'mail.demo-example.test',
        source: 'SYNTHETIC_DEMO',
        requestsCount: reqs,
        deliveredCount: reqs - fails,
        failedCount: fails,
        invalidAddressCount: invalids,
        complaintCount: idx < 5 ? 3 : 1,
        accountStatus: 'SYNTHETIC_DEMO_NORMAL',
        notes: 'Synthetic Alibaba DirectMail SMTP/API demonstration baseline.',
        isDemoData: true,
      };
    }),
    skipDuplicates: true,
  });

  await prisma.inboxPlacementTest.createMany({
    data: [
      {
        testDomain: 'mail.demo-example.test',
        sendingProvider: 'Alibaba Cloud DirectMail (SMTP)',
        campaignUid: 'demo-camp-0-5',
        recipientProvider: 'GMAIL',
        testedAt: daysAgo(5),
        placement: 'PROMOTIONS',
        spfPass: true,
        dkimPass: true,
        dmarcPass: true,
        postmasterReputation: 'MEDIUM',
        notes: 'Synthetic controlled seed test: landed in Promotions tab.',
        recordedByEmail: 'admin@example.com',
        isDemoData: true,
      },
      {
        testDomain: 'mail.demo-example.test',
        sendingProvider: 'Alibaba Cloud DirectMail (SMTP)',
        campaignUid: 'demo-camp-0-5',
        recipientProvider: 'OUTLOOK',
        testedAt: daysAgo(5),
        placement: 'PRIMARY',
        spfPass: true,
        dkimPass: true,
        dmarcPass: true,
        notes: 'Synthetic controlled seed test: delivered to Outlook Focused/Primary.',
        recordedByEmail: 'admin@example.com',
        isDemoData: true,
      },
      {
        testDomain: 'mail.demo-example.test',
        sendingProvider: 'Alibaba Cloud DirectMail (SMTP)',
        campaignUid: 'demo-camp-0-4',
        recipientProvider: 'YAHOO',
        testedAt: daysAgo(19),
        placement: 'SPAM',
        spfPass: true,
        dkimPass: true,
        dmarcPass: true,
        notes: 'Synthetic seed test prior to list hygiene suppression.',
        recordedByEmail: 'admin@example.com',
        isDemoData: true,
      },
    ],
  });

  await prisma.postmasterStat.createMany({
    data: [
      {
        domain: 'mail.demo-example.test',
        statDate: dayUtc(14),
        domainReputation: 'MEDIUM',
        userReportedSpamRatio: 0.0021,
        dkimSuccessRatio: 0.996,
        dmarcSuccessRatio: 0.994,
        spfSuccessRatio: 0.998,
        inboundEncryptionRatio: 1.0,
        source: 'SYNTHETIC_DEMO',
        notes: 'Synthetic Postmaster baseline for UI demonstration.',
        isDemoData: true,
      },
      {
        domain: 'mail.demo-example.test',
        statDate: dayUtc(3),
        domainReputation: 'HIGH',
        userReportedSpamRatio: 0.0008,
        dkimSuccessRatio: 0.999,
        dmarcSuccessRatio: 0.998,
        spfSuccessRatio: 0.999,
        inboundEncryptionRatio: 1.0,
        source: 'SYNTHETIC_DEMO',
        notes: 'Synthetic Postmaster observation after suppressing stale contacts.',
        isDemoData: true,
      },
    ],
    skipDuplicates: true,
  });

  return {
    listsCreated: createdLists.length,
    subscribersCreated: subscriberRows.length,
    campaignsCreated: createdCampaigns.length,
    eventsCreated: eventRows.length,
  };
}
