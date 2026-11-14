/**
 * Shared RFC 4180 CSV cell formatter with spreadsheet formula-injection neutralization (CWE-1236).
 */
export function sanitizeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : '';
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  let str = String(value);
  // Neutralize formula execution in Excel / Calc / Sheets when string starts directly or after whitespace with =, +, -, @, \t, or \r
  if (/^[\s\u00A0]*[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }

  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
