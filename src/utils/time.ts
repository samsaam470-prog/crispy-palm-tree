/** Current UTC timestamp in ISO-8601 format (second precision). */
export function nowIso(): string {
  return new Date().toISOString();
}

/** Format a sequential integer interview id as the dashboard display id. */
export function formatInterviewId(id: number): string {
  return String(id).padStart(3, '0');
}

/** Parse a dashboard display id ("001" or 1) into the integer primary key. */
export function parseInterviewId(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}
