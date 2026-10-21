/**
 * Cryptographically secure random identifier generation for Cloudflare Workers.
 */

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const ALPHABET_BYTES = BigInt(ALPHABET.length);

export function randomString(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const byte of bytes) {
    out += ALPHABET[Number(BigInt(byte) % ALPHABET_BYTES)];
  }
  return out;
}

export function generateId(prefix = 'id'): string {
  return `${prefix}_${randomString(12)}`;
}

export function generateUid(prefix = 'uid'): string {
  return `${prefix}_${randomString(10)}`;
}

export function generatePublicId(length = 22): string {
  return randomString(length);
}

export function generateSubmissionId(): string {
  return `sub_${randomString(16)}`;
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
