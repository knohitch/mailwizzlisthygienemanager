import mysql from 'mysql2/promise';
import { logger } from '@/services/security/logger';

export interface ReportingDbSchemaVerification {
  ok: boolean;
  prefix: string;
  discoveredTables: Record<string, boolean>;
  verifiedColumns: Record<string, string[]>;
  isReadOnlyVerified: boolean;
  notes: string[];
}

export interface ReportingDbEngagementRow {
  subscriberUid: string;
  campaignUid: string;
  listUid: string | null;
  eventType: 'DELIVERED' | 'OPEN' | 'CLICK' | 'HARD_BOUNCE' | 'SOFT_BOUNCE' | 'COMPLAINT';
  occurredAt: Date;
  metadata?: Record<string, unknown>;
}

const SAFE_PREFIX_REGEX = /^[a-zA-Z0-9_]{0,20}$/;

export function assertReadOnlySqlStatement(sql: string): void {
  const trimmed = sql.trim().replace(/\/\*[\s\S]*?\*\//g, '').trim();
  const upper = trimmed.toUpperCase();
  if (!upper.startsWith('SELECT ') && !upper.startsWith('SHOW ')) {
    throw new Error('Reporting DB guard rejected non-SELECT/SHOW SQL statement.');
  }
  const forbidden = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|REPLACE|GRANT|REVOKE|SET|CALL|EXECUTE|LOCK)\b/;
  if (forbidden.test(upper)) {
    throw new Error('Reporting DB guard rejected SQL containing write/DDL keyword.');
  }
}

export async function verifyMailWizzReportingSchema(
  connectionUri: string,
  prefix = 'mw_'
): Promise<ReportingDbSchemaVerification> {
  if (!SAFE_PREFIX_REGEX.test(prefix)) {
    throw new Error('Invalid reporting database table prefix.');
  }

  const connection = await mysql.createConnection({
    uri: connectionUri,
    connectTimeout: 8000,
    multipleStatements: false,
  });

  try {
    const notes: string[] = [];

    // 1. Verify privileges are read-only (best effort; fail closed on write grant if check succeeds)
    assertReadOnlySqlStatement('SHOW GRANTS FOR CURRENT_USER()');
    let isReadOnlyVerified = false;
    try {
      const [grantRows] = await connection.query('SHOW GRANTS FOR CURRENT_USER()');
      const grantsText = JSON.stringify(grantRows).toUpperCase();
      const hasWriteGrant =
        grantsText.includes('ALL PRIVILEGES') ||
        /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT OPTION|SUPER)\b/.test(
          grantsText
        );
      isReadOnlyVerified = !hasWriteGrant && (grantsText.includes('SELECT') || grantsText.includes('USAGE'));
      if (hasWriteGrant) {
        notes.push(
          'WARNING: Reporting DB user has write privileges. Create a dedicated SELECT-only MySQL user before enabling live reporting queries.'
        );
      }
    } catch {
      // Fallback for MySQL 8+ role-restricted users: inspect INFORMATION_SCHEMA.USER_PRIVILEGES
      try {
        const privQuery =
          "SELECT PRIVILEGE_TYPE FROM INFORMATION_SCHEMA.USER_PRIVILEGES WHERE GRANTEE LIKE CONCAT('%', SUBSTRING_INDEX(CURRENT_USER(), '@', 1), '%')";
        assertReadOnlySqlStatement(privQuery);
        const [privRows] = await connection.query(privQuery);
        const privText = JSON.stringify(privRows).toUpperCase();
        const hasWrite = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|SUPER)\b/.test(privText);
        isReadOnlyVerified = !hasWrite && privText.includes('SELECT');
      } catch {
        notes.push('Could not inspect SHOW GRANTS; continuing with SELECT-only query guard.');
      }
    }

    // 2. Discover tables against INFORMATION_SCHEMA (covers MailWizz 1.x, 2.x, 3.x, and future schemas)
    const candidateNames = [
      'list',
      'list_subscriber',
      'campaign',
      'campaign_delivery_log',
      'campaign_delivery_log_archive',
      'campaign_track_open',
      'campaign_track_url',
      'campaign_url',
      'campaign_bounce_log',
      'campaign_complain_log',
      'campaign_complaint_log',
      'campaign_abuse_report',
    ].map((name) => `${prefix}${name}`);

    const tableQuery =
      'SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)';
    assertReadOnlySqlStatement(tableQuery);
    const [tableRows] = await connection.query(tableQuery, [candidateNames]);
    const foundSet = new Set(
      (tableRows as Array<{ TABLE_NAME: string }>).map((r) => r.TABLE_NAME)
    );

    const discoveredTables: Record<string, boolean> = {};
    for (const candidate of candidateNames) {
      discoveredTables[candidate] = foundSet.has(candidate);
    }

    const verifiedColumns: Record<string, string[]> = {};
    if (foundSet.size > 0) {
      const colQuery =
        'SELECT TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)';
      assertReadOnlySqlStatement(colQuery);
      const [colRows] = await connection.query(colQuery, [Array.from(foundSet)]);
      for (const row of colRows as Array<{ TABLE_NAME: string; COLUMN_NAME: string }>) {
        verifiedColumns[row.TABLE_NAME] = verifiedColumns[row.TABLE_NAME] ?? [];
        verifiedColumns[row.TABLE_NAME].push(row.COLUMN_NAME);
      }
    }

    return {
      ok: foundSet.has(`${prefix}list_subscriber`) && foundSet.has(`${prefix}campaign`),
      prefix,
      discoveredTables,
      verifiedColumns,
      isReadOnlyVerified,
      notes,
    };
  } finally {
    await connection.end().catch(() => undefined);
  }
}

export async function fetchEngagementEventsFromReportingDb(params: {
  connectionUri: string;
  prefix?: string;
  lookbackDays: number;
}): Promise<{
  verification: ReportingDbSchemaVerification;
  events: ReportingDbEngagementRow[];
}> {
  const prefix = params.prefix ?? 'mw_';
  const verification = await verifyMailWizzReportingSchema(params.connectionUri, prefix);
  if (!verification.ok) {
    logger.warn('MailWizz reporting DB schema check did not find required base tables', {
      prefix,
    });
    return { verification, events: [] };
  }

  if (!verification.isReadOnlyVerified) {
    throw new Error(
      'Reporting DB connection refused because MySQL user is not strictly SELECT-only.'
    );
  }

  const connection = await mysql.createConnection({
    uri: params.connectionUri,
    connectTimeout: 8000,
    multipleStatements: false,
  });

  const events: ReportingDbEngagementRow[] = [];
  const sinceDate = new Date(Date.now() - params.lookbackDays * 86_400_000);

  try {
    const subTable = `${prefix}list_subscriber`;
    const campTable = `${prefix}campaign`;
    const listTable = `${prefix}list`;
    const hasListTable = verification.discoveredTables[listTable];

    const queryEventTable = async (
      tableKey: string,
      eventType: ReportingDbEngagementRow['eventType'],
      dateColCandidates: string[]
    ) => {
      const fullTable = `${prefix}${tableKey}`;
      if (!verification.discoveredTables[fullTable]) return;
      const cols = verification.verifiedColumns[fullTable] ?? [];
      const dateCol = dateColCandidates.find((c) => cols.includes(c));
      if (!dateCol || !cols.includes('subscriber_id') || !cols.includes('campaign_id')) {
        return;
      }

      const listSelect = hasListTable ? 'l.list_uid AS list_uid' : 'NULL AS list_uid';
      const listJoin = hasListTable ? `LEFT JOIN \`${listTable}\` l ON l.list_id = c.list_id` : '';

      const sql = `SELECT s.subscriber_uid AS subscriber_uid, c.campaign_uid AS campaign_uid, ${listSelect}, t.\`${dateCol}\` AS occurred_at FROM \`${fullTable}\` t INNER JOIN \`${subTable}\` s ON s.subscriber_id = t.subscriber_id INNER JOIN \`${campTable}\` c ON c.campaign_id = t.campaign_id ${listJoin} WHERE t.\`${dateCol}\` >= ?`;
      assertReadOnlySqlStatement(sql);
      const [rows] = await connection.query(sql, [sinceDate]);
      for (const r of rows as Array<{
        subscriber_uid: string;
        campaign_uid: string;
        list_uid: string | null;
        occurred_at: Date | string;
      }>) {
        events.push({
          subscriberUid: r.subscriber_uid,
          campaignUid: r.campaign_uid,
          listUid: r.list_uid,
          eventType,
          occurredAt: new Date(r.occurred_at),
        });
      }
    };

    const dateCols = ['date_added', 'created_at', 'added_at', 'sent_at', 'timestamp'];
    await queryEventTable('campaign_delivery_log', 'DELIVERED', dateCols);
    await queryEventTable('campaign_delivery_log_archive', 'DELIVERED', dateCols);
    await queryEventTable('campaign_track_open', 'OPEN', dateCols);

    // campaign_track_url links to campaign_url which holds campaign_id
    const urlTrackTable = `${prefix}campaign_track_url`;
    const urlTable = `${prefix}campaign_url`;
    if (
      verification.discoveredTables[urlTrackTable] &&
      verification.discoveredTables[urlTable]
    ) {
      const cols = verification.verifiedColumns[urlTrackTable] ?? [];
      const clickDateCol = dateCols.find((c) => cols.includes(c));
      if (cols.includes('url_id') && cols.includes('subscriber_id') && clickDateCol) {
        const listSelect = hasListTable ? 'l.list_uid AS list_uid' : 'NULL AS list_uid';
        const listJoin = hasListTable ? `LEFT JOIN \`${listTable}\` l ON l.list_id = c.list_id` : '';
        const clickSql = `SELECT s.subscriber_uid AS subscriber_uid, c.campaign_uid AS campaign_uid, ${listSelect}, t.\`${clickDateCol}\` AS occurred_at FROM \`${urlTrackTable}\` t INNER JOIN \`${urlTable}\` u ON u.url_id = t.url_id INNER JOIN \`${subTable}\` s ON s.subscriber_id = t.subscriber_id INNER JOIN \`${campTable}\` c ON c.campaign_id = u.campaign_id ${listJoin} WHERE t.\`${clickDateCol}\` >= ?`;
        assertReadOnlySqlStatement(clickSql);
        const [rows] = await connection.query(clickSql, [sinceDate]);
        for (const r of rows as Array<{
          subscriber_uid: string;
          campaign_uid: string;
          list_uid: string | null;
          occurred_at: Date | string;
        }>) {
          events.push({
            subscriberUid: r.subscriber_uid,
            campaignUid: r.campaign_uid,
            listUid: r.list_uid,
            eventType: 'CLICK',
            occurredAt: new Date(r.occurred_at),
          });
        }
      }
    }

    await queryEventTable('campaign_complain_log', 'COMPLAINT', dateCols);
    await queryEventTable('campaign_complaint_log', 'COMPLAINT', dateCols);
    await queryEventTable('campaign_abuse_report', 'COMPLAINT', dateCols);

    return { verification, events };
  } finally {
    await connection.end().catch(() => undefined);
  }
}
