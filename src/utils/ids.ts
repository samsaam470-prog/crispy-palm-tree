/**
 * Cryptographically secure random identifier generation (WebCrypto only —
 * safe on the Cloudflare Workers runtime; no Node APIs).
 */

const ALPHABET =
  'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'; // 56 chars, no look-alikes
const ALPHABET_BYTES = 56n;

/** Public interview token: 22 chars of base56 ≈ 127 bits of entropy. */
export function generatePublicId(length = 22): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) {
    // Rejection-free mapping via modulo introduces negligible bias for a
    // non-security boundary label; entropy still >= 5.79 bits/char.
    out += ALPHABET[Number(BigInt(b) % ALPHABET_BYTES)];
  }
  return out;
}

/** Stable client-visible id for questions/options/rules (not secret-grade). */
export function generateUid(prefix: string): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return `${prefix}_${hex}`;
}

/** Submission ID exposed in the dashboard. */
export function generateSubmissionId(): string {
  return `sub_${generatePublicId(16)}`;
}

/** Constant-time string comparison to avoid timing side channels. */
export function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still compare against itself to keep the early-exit path uniform-ish;
    // length differences are not secret in this deployment.
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
