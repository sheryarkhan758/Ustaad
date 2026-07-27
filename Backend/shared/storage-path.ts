/**
 * Guards the one field that must never point somewhere public.
 *
 * `tutor_documents.storage_path` and `volunteer_applications.document_path`
 * hold CNIC images, degree scans and CVs.  SEC-7, NFR-9 and FR-33.4 all say the
 * same thing: these live in a private bucket, are reachable only through a
 * short-lived signed URL scoped to an administrator, and every access is
 * logged.  A path that is actually a public URL — or a path inside this public
 * repository — defeats all three at once, silently.
 *
 * So the shape is validated on write rather than trusted.
 */

import { z } from 'zod';

export class StoragePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoragePathError';
  }
}

/** Top-level prefixes permitted inside the private bucket. */
export const PRIVATE_PATH_PREFIXES = ['tutors/', 'volunteers/', 'feedback/'] as const;

/**
 * @throws {StoragePathError} if the value is a URL, an absolute or traversing
 * path, or does not sit under a known private prefix.
 */
export function assertPrivateStoragePath(value: string): void {
  const path = value.trim();

  if (path === '') {
    throw new StoragePathError('storage path is empty');
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
    throw new StoragePathError(
      `storage path must be a private bucket key, not a URL: "${path}". ` +
        'Documents are served only through short-lived signed URLs (SEC-7).',
    );
  }
  if (path.startsWith('/') || /^[a-z]:[\\/]/i.test(path)) {
    throw new StoragePathError(
      `storage path must be relative to the private bucket, not an absolute path: "${path}"`,
    );
  }
  if (path.includes('..')) {
    throw new StoragePathError(`storage path may not traverse directories: "${path}"`);
  }
  if (path.includes('\\')) {
    throw new StoragePathError(`storage path must use forward slashes: "${path}"`);
  }
  if (!PRIVATE_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    throw new StoragePathError(
      `storage path must begin with one of ${PRIVATE_PATH_PREFIXES.join(', ')} — received "${path}"`,
    );
  }
}

export const privateStoragePathSchema = z.string().superRefine((value, ctx) => {
  try {
    assertPrivateStoragePath(value);
  } catch (error) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: error instanceof Error ? error.message : 'invalid storage path',
    });
  }
});
