/**
 * Symmetric encryption primitives — AES-256-GCM.
 *
 * Used for exactly one thing today: residential addresses at rest (SEC-3,
 * NFR-18).  It is kept separate from `address.ts` so that the cryptography can
 * be reviewed and tested on its own, and so that nothing else acquires its own
 * private copy of an IV-generation routine.
 *
 * GCM rather than CBC because it is authenticated: a ciphertext that has been
 * tampered with fails to decrypt rather than producing plausible garbage. For
 * an address that is disclosed to a woman travelling alone to it, silently
 * returning the wrong street is a worse failure than returning an error.
 *
 * ── Stored format ──────────────────────────────────────────────────────────
 *   v1.<iv base64url>.<authTag base64url>.<ciphertext base64url>
 *
 * The version prefix is not decoration. Key rotation and algorithm change are
 * both things this project may have to do after rows exist, and a format that
 * cannot say which scheme produced a value forces a guess.
 */

import { createDecipheriv, createCipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';
const IV_BYTES = 12; // 96 bits — the size GCM is specified for.
const KEY_BYTES = 32; // AES-256.

export class EncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EncryptionError';
  }
}

/**
 * Reads and validates `ADDRESS_ENCRYPTION_KEY`.
 *
 * Read per call rather than cached at import, so a test can set the variable
 * and so a missing key fails at the point of use with a clear message instead
 * of at module load with a stack trace.
 */
function loadKey(): Buffer {
  const raw = process.env.ADDRESS_ENCRYPTION_KEY;

  if (!raw || raw.trim() === '') {
    throw new EncryptionError(
      'ADDRESS_ENCRYPTION_KEY is not set. Addresses are encrypted at rest (NFR-18) and the ' +
        'application will not store or read one without a key. Generate one with:\n' +
        '  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  if (raw.startsWith('REPLACE_')) {
    throw new EncryptionError(
      'ADDRESS_ENCRYPTION_KEY still holds the placeholder from .env.example. Set a real key.',
    );
  }

  let key: Buffer;
  try {
    key = Buffer.from(raw.trim(), 'hex');
  } catch {
    throw new EncryptionError('ADDRESS_ENCRYPTION_KEY must be hex-encoded');
  }

  if (key.length !== KEY_BYTES) {
    throw new EncryptionError(
      `ADDRESS_ENCRYPTION_KEY must be ${KEY_BYTES} bytes (${KEY_BYTES * 2} hex characters); ` +
        `found ${key.length}`,
    );
  }
  return key;
}

/** True when a key is configured and usable. Used by the health check. */
export function isEncryptionConfigured(): boolean {
  try {
    loadKey();
    return true;
  } catch {
    return false;
  }
}

const b64 = (buffer: Buffer): string => buffer.toString('base64url');
const unb64 = (value: string): Buffer => Buffer.from(value, 'base64url');

/**
 * Encrypt a UTF-8 string.
 *
 * A fresh random IV per call. Reusing an IV under GCM with the same key is
 * catastrophic — it leaks the XOR of the plaintexts and breaks authentication —
 * so it is generated here and never accepted as a parameter.
 */
export function encrypt(plaintext: string): string {
  if (typeof plaintext !== 'string') {
    throw new EncryptionError('only strings may be encrypted');
  }

  const key = loadKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [VERSION, b64(iv), b64(authTag), b64(ciphertext)].join('.');
}

/**
 * Decrypt a value produced by `encrypt`.
 *
 * @throws {EncryptionError} on a malformed value, an unknown version, or a
 * failed authentication tag — which is what tampering or a wrong key looks
 * like. There is deliberately no "best effort" path.
 */
export function decrypt(stored: string): string {
  if (typeof stored !== 'string' || stored === '') {
    throw new EncryptionError('nothing to decrypt');
  }

  const parts = stored.split('.');
  if (parts.length !== 4) {
    throw new EncryptionError('ciphertext is malformed: expected version.iv.tag.data');
  }

  const [version, ivPart, tagPart, dataPart] = parts as [string, string, string, string];
  if (version !== VERSION) {
    throw new EncryptionError(
      `ciphertext was written by scheme "${version}"; this build understands "${VERSION}" only`,
    );
  }

  const key = loadKey();
  const iv = unb64(ivPart);
  const authTag = unb64(tagPart);

  if (iv.length !== IV_BYTES) throw new EncryptionError('ciphertext has a malformed IV');
  if (authTag.length !== 16) throw new EncryptionError('ciphertext has a malformed auth tag');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  try {
    return Buffer.concat([decipher.update(unb64(dataPart)), decipher.final()]).toString('utf8');
  } catch {
    // Deliberately not forwarding the underlying message: it distinguishes a
    // wrong key from a corrupted tag, which is more than a caller needs.
    throw new EncryptionError(
      'address could not be decrypted: the authentication tag does not verify. ' +
        'The value has been altered, or ADDRESS_ENCRYPTION_KEY has changed.',
    );
  }
}

/** Constant-time comparison, for secrets compared by value. */
export function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}
