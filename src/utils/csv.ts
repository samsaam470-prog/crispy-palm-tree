/**
 * CSV generation with proper escaping and spreadsheet formula-injection
 * mitigation (OWASP style: prefix dangerous leading characters with ').
 */

const FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r'];

export function sanitizeCsvValue(value: string): string {
  const s = value ?? '';
  if (s.length > 0 && FORMULA_PREFIXES.includes(s[0])) {
    return `'${s}`;
  }
  return s;
}

export function escapeCsvField(value: string): string {
  const s = sanitizeCsvValue(String(value ?? ''));
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function csvRow(fields: string[]): string {
  return fields.map(escapeCsvField).join(',');
}

export function buildCsv(header: string[], rowsData: string[][]): string {
  const lines = [csvRow(header), ...rowsData.map(csvRow)];
  return lines.join('\r\n') + '\r\n';
}
