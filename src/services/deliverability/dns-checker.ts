import dns from 'node:dns/promises';
import { prisma } from '@/lib/db';
import { recordAuditLog } from '@/services/security/audit';
import type { DnsCheckStatus, Prisma } from '@prisma/client';

export interface DnsResolverAdapter {
  resolveTxt(hostname: string): Promise<string[][]>;
  resolveMx(hostname: string): Promise<Array<{ exchange: string; priority: number }>>;
  resolveCname(hostname: string): Promise<string[]>;
  resolve4(hostname: string): Promise<string[]>;
}

const defaultDnsResolver: DnsResolverAdapter = {
  resolveTxt: (h) => dns.resolveTxt(h),
  resolveMx: (h) => dns.resolveMx(h),
  resolveCname: (h) => dns.resolveCname(h),
  resolve4: (h) => dns.resolve4(h),
};

export interface DnsDiagnosticInput {
  domain: string;
  fromDomain?: string;
  trackingDomain?: string;
  dkimSelector?: string;
  actorEmail: string;
  resolver?: DnsResolverAdapter;
}

export interface DnsDiagnosticResult {
  domain: string;
  fromDomain: string;
  trackingDomain: string | null;
  dkimSelector: string | null;
  spfStatus: DnsCheckStatus;
  spfRecord: string | null;
  spfDetail: string;
  dkimStatus: DnsCheckStatus;
  dkimRecord: string | null;
  dkimDetail: string;
  dmarcStatus: DnsCheckStatus;
  dmarcPolicy: string | null;
  dmarcAlignmentOk: boolean | null;
  dmarcRecord: string | null;
  dmarcDetail: string;
  mxStatus: DnsCheckStatus;
  mxRecords: Array<{ exchange: string; priority: number }>;
  trackingStatus: DnsCheckStatus;
  trackingDetail: string;
  recommendations: string[];
}

function normalizeDomain(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .split('/')[0]
    .replace(/\.$/, '');
}

function getOrgDomain(domain: string): string {
  const parts = domain.split('.').filter(Boolean);
  if (parts.length <= 2) return domain;
  return parts.slice(-2).join('.');
}

async function safeTxtLookup(
  resolver: DnsResolverAdapter,
  host: string
): Promise<string[]> {
  try {
    const rows = await resolver.resolveTxt(host);
    return rows.map((chunks) => chunks.join(''));
  } catch {
    return [];
  }
}

export async function analyzeDomainDns(
  input: DnsDiagnosticInput
): Promise<DnsDiagnosticResult> {
  const resolver = input.resolver ?? defaultDnsResolver;
  const domain = normalizeDomain(input.domain);
  const fromDomain = normalizeDomain(input.fromDomain || input.domain);
  const trackingDomain = input.trackingDomain
    ? normalizeDomain(input.trackingDomain)
    : null;
  const dkimSelector = input.dkimSelector?.trim() || null;

  if (!domain || !domain.includes('.')) {
    throw new Error('A valid domain name (e.g., example.com) is required.');
  }

  const recommendations: string[] = [];

  // 1. SPF Analysis (read-only TXT lookup)
  const txtRecords = await safeTxtLookup(resolver, domain);
  const spfRecords = txtRecords.filter((r) =>
    r.toLowerCase().startsWith('v=spf1')
  );

  let spfStatus: DnsCheckStatus = 'FAIL';
  let spfRecord: string | null = null;
  let spfDetail = '';

  if (spfRecords.length === 0) {
    spfStatus = 'FAIL';
    spfDetail = `No SPF TXT record (v=spf1) found on ${domain}.`;
    recommendations.push(
      `Add an SPF TXT record on ${domain} authorizing Alibaba Cloud DirectMail (for example, include:spf.dm.aliyun.com or your DirectMail region include) ending in ~all or -all.`
    );
  } else if (spfRecords.length > 1) {
    spfStatus = 'FAIL';
    spfRecord = spfRecords.join(' | ');
    spfDetail = `Multiple SPF records (${spfRecords.length}) found on ${domain}; RFC 7208 specifies PermError when >1 v=spf1 record exists.`;
    recommendations.push(
      `Merge multiple SPF TXT records on ${domain} into a single v=spf1 record.`
    );
  } else {
    spfRecord = spfRecords[0];
    const lowerSpf = spfRecord.toLowerCase();
    const lookupMechanisms = (
      lowerSpf.match(/\b(include:|a\b|a:|mx\b|mx:|ptr\b|exists:|redirect=)/g) ?? []
    ).length;

    if (lowerSpf.includes('+all')) {
      spfStatus = 'FAIL';
      spfDetail = 'SPF uses "+all", allowing any server on the internet to send as this domain.';
      recommendations.push('Replace "+all" with "~all" or "-all" immediately.');
    } else if (lowerSpf.includes('?all') || (!lowerSpf.includes('-all') && !lowerSpf.includes('~all'))) {
      spfStatus = 'WARN';
      spfDetail =
        'SPF ends in "?all" (neutral) or lacks an explicit qualifier; mailbox providers prefer "~all" or "-all".';
      recommendations.push('Update SPF qualifier to "~all" or "-all".');
    } else if (lookupMechanisms > 10) {
      spfStatus = 'FAIL';
      spfDetail = `SPF appears to trigger ${lookupMechanisms} DNS lookup mechanisms (RFC 7208 limit is 10), risking SPF PermError.`;
      recommendations.push('Flatten SPF includes so total DNS lookups remain <= 10.');
    } else {
      spfStatus = 'PASS';
      spfDetail = `Valid single SPF record (${lookupMechanisms}/10 estimated DNS lookup mechanisms).`;
    }
  }

  // 2. DKIM Analysis (strictly ONLY when selector is known; NEVER guess)
  let dkimStatus: DnsCheckStatus = 'UNKNOWN';
  let dkimRecord: string | null = null;
  let dkimDetail = '';

  if (!dkimSelector) {
    dkimStatus = 'UNKNOWN';
    dkimDetail =
      'DKIM selector not provided. Unknown selectors are never guessed; enter your configured DirectMail/MTA selector to verify the public key TXT record.';
    recommendations.push(
      'Locate your active DKIM selector in the Alibaba Cloud DirectMail Domain settings and run this check with the selector entered.'
    );
  } else {
    const dkimHost = `${dkimSelector}._domainkey.${fromDomain}`;
    const dkimTxt = await safeTxtLookup(resolver, dkimHost);
    const keyRec = dkimTxt.find(
      (r) => r.includes('p=') || r.toLowerCase().includes('v=dkim1')
    );
    if (!keyRec) {
      dkimStatus = 'FAIL';
      dkimDetail = `No valid DKIM TXT key found at ${dkimHost}.`;
      recommendations.push(
        `Verify that TXT record "${dkimHost}" is published cleanly from your DirectMail console.`
      );
    } else if (/p=\s*(;|$)/i.test(keyRec)) {
      dkimStatus = 'FAIL';
      dkimRecord = keyRec;
      dkimDetail = `DKIM record at ${dkimHost} has an empty public key (p=), indicating a revoked selector.`;
      recommendations.push(`Publish a valid non-empty RSA public key at ${dkimHost}.`);
    } else {
      dkimStatus = 'PASS';
      dkimRecord = keyRec;
      dkimDetail = `Valid DKIM public key record verified at ${dkimHost}.`;
    }
  }

  // 3. DMARC Analysis & Visible From-Domain Alignment Check
  const dmarcHost = `_dmarc.${fromDomain}`;
  const dmarcTxt = await safeTxtLookup(resolver, dmarcHost);
  const dmarcRec = dmarcTxt.find((r) => r.toLowerCase().startsWith('v=dmarc1'));

  let dmarcStatus: DnsCheckStatus = 'FAIL';
  let dmarcPolicy: string | null = null;
  let dmarcAlignmentOk: boolean | null = null;
  let dmarcRecord: string | null = null;
  let dmarcDetail = '';

  if (!dmarcRec) {
    dmarcStatus = 'FAIL';
    dmarcAlignmentOk = false;
    dmarcDetail = `No DMARC TXT record (v=DMARC1) found at ${dmarcHost}. Gmail and Yahoo require DMARC for bulk senders.`;
    recommendations.push(
      `Publish a DMARC record at ${dmarcHost} starting with "v=DMARC1; p=none; rua=mailto:dmarc@${fromDomain}" and progress to p=quarantine/reject.`
    );
  } else {
    dmarcRecord = dmarcRec;
    const policyMatch = /p=([a-z]+)/i.exec(dmarcRec);
    const adkimMatch = /adkim=([rs])/i.exec(dmarcRec);
    const aspfMatch = /aspf=([rs])/i.exec(dmarcRec);
    dmarcPolicy = policyMatch ? policyMatch[1].toLowerCase() : null;
    const adkim = adkimMatch ? adkimMatch[1].toLowerCase() : 'r';
    const aspf = aspfMatch ? aspfMatch[1].toLowerCase() : 'r';

    const exactMatch = domain === fromDomain;
    const orgMatch = getOrgDomain(domain) === getOrgDomain(fromDomain);
    const spfAligned = aspf === 's' ? exactMatch : orgMatch;
    const dkimAligned =
      dkimStatus === 'PASS' ? (adkim === 's' ? exactMatch : orgMatch) : null;

    dmarcAlignmentOk = Boolean(spfAligned || dkimAligned);

    if (!dmarcAlignmentOk) {
      dmarcStatus = 'FAIL';
      dmarcDetail = `DMARC record exists (p=${dmarcPolicy ?? 'unknown'}), but sending/Return-Path domain "${domain}" does not align with visible From domain "${fromDomain}" (aspf=${aspf}, adkim=${adkim}).`;
      recommendations.push(
        `Align your custom DirectMail envelope/Return-Path domain or DKIM signing domain ("${domain}") with your visible From domain ("${fromDomain}").`
      );
    } else if (dmarcPolicy === 'none' || !dmarcPolicy) {
      dmarcStatus = 'WARN';
      dmarcDetail = `DMARC alignment passes (${fromDomain}), but policy is p=${dmarcPolicy ?? 'missing'} (monitor-only).`;
      recommendations.push(
        `After monitoring DMARC RUA reports cleanly, strengthen ${dmarcHost} from p=none to p=quarantine or p=reject.`
      );
    } else {
      dmarcStatus = 'PASS';
      dmarcDetail = `DMARC policy p=${dmarcPolicy} verified and aligned with visible From domain ${fromDomain}.`;
    }
  }

  // 4. MX Records (relevant for bounce handling / reply-to domain credibility)
  let mxStatus: DnsCheckStatus = 'WARN';
  let mxRecords: Array<{ exchange: string; priority: number }> = [];
  try {
    mxRecords = await resolver.resolveMx(fromDomain);
    if (mxRecords.length > 0) {
      mxStatus = 'PASS';
    } else {
      mxStatus = 'WARN';
      recommendations.push(
        `No MX records found on ${fromDomain}; ensure replies and bounce-processing addresses route reliably.`
      );
    }
  } catch {
    mxStatus = 'WARN';
    recommendations.push(
      `MX lookup returned no records for ${fromDomain}. Ensure return/reply addresses use a valid MX-backed domain.`
    );
  }

  // 5. Tracking Domain Check
  let trackingStatus: DnsCheckStatus = 'UNKNOWN';
  let trackingDetail =
    'No dedicated MailWizz tracking domain entered. Using default MailWizz URLs across shared domains can hurt alignment/reputation compared to an aligned custom tracking subdomain.';

  if (trackingDomain) {
    let resolvedVia: string | null = null;
    try {
      const cnames = await resolver.resolveCname(trackingDomain);
      if (cnames.length > 0) resolvedVia = `CNAME -> ${cnames.join(', ')}`;
    } catch {
      // ignore CNAME miss, check A record
    }
    if (!resolvedVia) {
      try {
        const ipv4 = await resolver.resolve4(trackingDomain);
        if (ipv4.length > 0) resolvedVia = `A -> ${ipv4.join(', ')}`;
      } catch {
        // unresolved
      }
    }

    if (!resolvedVia) {
      trackingStatus = 'FAIL';
      trackingDetail = `Tracking domain ${trackingDomain} has no resolvable CNAME or A DNS record.`;
      recommendations.push(
        `Configure a DNS CNAME or A record pointing ${trackingDomain} to your MailWizz server with valid HTTPS TLS.`
      );
    } else if (getOrgDomain(trackingDomain) !== getOrgDomain(fromDomain)) {
      trackingStatus = 'WARN';
      trackingDetail = `Tracking domain ${trackingDomain} resolves (${resolvedVia}), but its organizational domain differs from visible From domain ${fromDomain}. Aligned tracking subdomains (e.g., track.${fromDomain}) improve link trust.`;
      recommendations.push(
        `Consider using a subdomain of ${fromDomain} (e.g., links.${fromDomain}) for MailWizz click/open tracking links with HTTPS.`
      );
    } else {
      trackingStatus = 'PASS';
      trackingDetail = `Tracking domain ${trackingDomain} resolves (${resolvedVia}) and shares organizational alignment with ${fromDomain}.`;
    }
  }

  return {
    domain,
    fromDomain,
    trackingDomain,
    dkimSelector,
    spfStatus,
    spfRecord,
    spfDetail,
    dkimStatus,
    dkimRecord,
    dkimDetail,
    dmarcStatus,
    dmarcPolicy,
    dmarcAlignmentOk,
    dmarcRecord,
    dmarcDetail,
    mxStatus,
    mxRecords,
    trackingStatus,
    trackingDetail,
    recommendations,
  };
}

export async function runAndSaveDomainAuthCheck(input: DnsDiagnosticInput) {
  const res = await analyzeDomainDns(input);

  const saved = await prisma.domainAuthCheck.create({
    data: {
      domain: res.domain,
      fromDomain: res.fromDomain,
      trackingDomain: res.trackingDomain,
      dkimSelector: res.dkimSelector,
      spfStatus: res.spfStatus,
      spfRecord: res.spfRecord,
      spfDetail: res.spfDetail,
      dkimStatus: res.dkimStatus,
      dkimRecord: res.dkimRecord,
      dkimDetail: res.dkimDetail,
      dmarcStatus: res.dmarcStatus,
      dmarcPolicy: res.dmarcPolicy,
      dmarcAlignmentOk: res.dmarcAlignmentOk,
      dmarcRecord: res.dmarcRecord,
      dmarcDetail: res.dmarcDetail,
      mxStatus: res.mxStatus,
      mxRecordsJson: res.mxRecords as unknown as Prisma.InputJsonValue,
      trackingStatus: res.trackingStatus,
      trackingDetail: res.trackingDetail,
      recommendationsJson: res.recommendations as unknown as Prisma.InputJsonValue,
      checkedByEmail: input.actorEmail,
    },
  });

  await recordAuditLog({
    actorEmail: input.actorEmail,
    action: 'DOMAIN_DNS_CHECK_RUN',
    resourceType: 'DomainAuthCheck',
    resourceId: saved.id,
    outcome: 'SUCCESS',
    details: {
      domain: res.domain,
      fromDomain: res.fromDomain,
      spfStatus: res.spfStatus,
      dkimStatus: res.dkimStatus,
      dmarcStatus: res.dmarcStatus,
    },
  });

  return saved;
}
