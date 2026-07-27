/**
 * Private document storage — SEC-7, NFR-9, FR-33.4.
 *
 * CNIC images, degree scans and volunteer CVs. One interface, two backends:
 *
 *  · **Supabase Storage**, private bucket, when `SUPABASE_URL` and
 *    `SUPABASE_SERVICE_ROLE_KEY` are set.
 *  · **A gitignored `/uploads` directory** otherwise, so development proceeds
 *    without a Supabase account.
 *
 * The local backend is a development convenience, not a second product. It
 * implements the same contract — a short-lived signed upload ticket, a
 * short-lived signed read URL, and a storage path that is never a public URL —
 * so no calling code knows which is running. It refuses to start under
 * `NODE_ENV=production`, because a serverless filesystem is ephemeral and a
 * CNIC image written to it would be silently lost, or worse, silently served.
 *
 * ── What the API never does ────────────────────────────────────────────────
 * The server never receives the file. It issues a ticket; the browser uploads
 * directly; the handler records only the resulting path. That keeps a 5 MB CNIC
 * image out of the request body, out of memory, and out of any log.
 */

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { assertContentMatchesDeclaration } from '../../shared/file-signature';
import { assertPrivateStoragePath } from '../../shared/storage-path';

/* -------------------------------------------------------------------------
 * Contract
 * ---------------------------------------------------------------------- */

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** JPG, PNG and PDF. Nothing executable, nothing renderable as HTML. */
export const ALLOWED_UPLOADS: ReadonlyArray<{ mimeType: string; extensions: string[] }> = [
  { mimeType: 'image/jpeg', extensions: ['.jpg', '.jpeg'] },
  { mimeType: 'image/png', extensions: ['.png'] },
  { mimeType: 'application/pdf', extensions: ['.pdf'] },
];

export class UploadValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UploadValidationError';
  }
}

export interface UploadRequest {
  /** Top-level bucket prefix. Matches `shared/storage-path.ts`. */
  scope: 'tutors' | 'volunteers' | 'feedback';
  ownerId: string;
  /** A label, not the user's filename: `cnic-front`, `degree`. */
  kind: string;
  /** As declared by the client. Validated against `mimeType`. */
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface UploadTicket {
  /** The bucket key to record once the upload succeeds. Never a URL. */
  storagePath: string;
  /** Where the browser PUTs the bytes. Short-lived. */
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: Date;
  maxBytes: number;
}

export interface DocumentStorage {
  readonly backend: 'supabase' | 'local';
  createUploadTicket(request: UploadRequest): Promise<UploadTicket>;
  /**
   * Write bytes the server holds, after validating declaration **and content**.
   *
   * Used by the two publicly reachable forms. Returns the bucket key — never a
   * URL, and never anything a caller could turn into one without going back
   * through `createReadUrl` (SEC-24).
   */
  putObject(request: UploadRequest, body: Buffer): Promise<string>;
  /** Short-lived, administrator-scoped read link (SEC-7). */
  createReadUrl(storagePath: string, ttlSeconds?: number): Promise<string>;
}

/**
 * The full check for a file the server actually holds: declaration, extension,
 * size, and then the leading bytes.
 */
export function validateUploadContent(request: UploadRequest, body: Buffer): void {
  validateUpload({ ...request, sizeBytes: body.byteLength });
  assertContentMatchesDeclaration(body, request.mimeType);
}

/* -------------------------------------------------------------------------
 * Validation — shared by both backends
 * ---------------------------------------------------------------------- */

/**
 * Checks the declared type, the extension, and that the two agree.
 *
 * Both are declarations by the client and neither is proof; checking both
 * closes the trivial cases (`payload.php` declared as `image/png`) and the
 * agreement check closes the next one (`payload.exe` declared as
 * `application/pdf`).
 *
 * Neither proves what the file **is**. Where the server holds the bytes — the
 * public volunteer and feedback forms — `putObject` additionally sniffs them
 * against `shared/file-signature.ts` (SEC-24, FR-33.3). On the ticket path the
 * browser PUTs straight to Supabase and the server never sees the bytes, so
 * that route gets the two declaration checks and nothing more; that asymmetry
 * is deliberate and is why the anonymous forms do not use tickets.
 */
export function validateUpload(request: UploadRequest): void {
  const allowed = ALLOWED_UPLOADS.find((a) => a.mimeType === request.mimeType);
  if (!allowed) {
    throw new UploadValidationError(
      `"${request.mimeType}" is not accepted. Upload a JPG, PNG or PDF.`,
    );
  }

  const extension = path.extname(request.fileName).toLowerCase();
  if (extension === '') {
    throw new UploadValidationError('the file must have an extension');
  }
  if (!allowed.extensions.includes(extension)) {
    throw new UploadValidationError(
      `a ${request.mimeType} file must end in ${allowed.extensions.join(' or ')}, not "${extension}"`,
    );
  }

  if (!Number.isInteger(request.sizeBytes) || request.sizeBytes <= 0) {
    throw new UploadValidationError('a file size in bytes is required');
  }
  if (request.sizeBytes > MAX_UPLOAD_BYTES) {
    throw new UploadValidationError(
      `the file is ${(request.sizeBytes / 1024 / 1024).toFixed(1)} MB; the limit is 5 MB`,
    );
  }

  if (request.fileName.includes('/') || request.fileName.includes('\\')) {
    throw new UploadValidationError('the file name may not contain a path');
  }
}

/**
 * The stored key.
 *
 * A random component, not the user's filename: two tutors uploading `cnic.jpg`
 * must not collide, and a filename is user input that has no business becoming
 * a path segment.
 */
export function buildStoragePath(request: UploadRequest): string {
  const extension = path.extname(request.fileName).toLowerCase();
  const kind = request.kind.replace(/[^a-z0-9-]/gi, '').toLowerCase() || 'document';
  const storagePath = `${request.scope}/${request.ownerId}/${kind}-${randomUUID()}${extension}`;
  assertPrivateStoragePath(storagePath);
  return storagePath;
}

/* -------------------------------------------------------------------------
 * Supabase backend
 * ---------------------------------------------------------------------- */

class SupabaseDocumentStorage implements DocumentStorage {
  readonly backend = 'supabase' as const;

  constructor(
    private readonly url: string,
    private readonly serviceKey: string,
    private readonly bucket: string,
  ) {}

  async createUploadTicket(request: UploadRequest): Promise<UploadTicket> {
    validateUpload(request);
    const storagePath = buildStoragePath(request);
    const ttl = Number(process.env.SIGNED_URL_TTL_SECONDS ?? 300);

    const response = await fetch(
      `${this.url}/storage/v1/object/upload/sign/${this.bucket}/${storagePath}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.serviceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ expiresIn: ttl }),
      },
    );

    if (!response.ok) {
      // The response body may quote the service key back; never forward it.
      throw new Error(`Supabase Storage refused an upload ticket (HTTP ${response.status})`);
    }

    const body = (await response.json()) as { url?: string };
    if (!body.url) throw new Error('Supabase Storage returned no signed upload URL');

    return {
      storagePath,
      uploadUrl: `${this.url}/storage/v1${body.url}`,
      method: 'PUT',
      headers: { 'Content-Type': request.mimeType },
      expiresAt: new Date(Date.now() + ttl * 1000),
      maxBytes: MAX_UPLOAD_BYTES,
    };
  }

  async putObject(request: UploadRequest, body: Buffer): Promise<string> {
    validateUploadContent(request, body);
    const storagePath = buildStoragePath(request);

    const response = await fetch(`${this.url}/storage/v1/object/${this.bucket}/${storagePath}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.serviceKey}`,
        'Content-Type': request.mimeType,
        'x-upsert': 'false',
      },
      body: new Uint8Array(body),
    });

    if (!response.ok) {
      // The body can echo the service key back; never forward it.
      throw new Error(`Supabase Storage refused an upload (HTTP ${response.status})`);
    }
    return storagePath;
  }

  async createReadUrl(storagePath: string, ttlSeconds?: number): Promise<string> {
    assertPrivateStoragePath(storagePath);
    const ttl = ttlSeconds ?? Number(process.env.SIGNED_URL_TTL_SECONDS ?? 300);

    const response = await fetch(
      `${this.url}/storage/v1/object/sign/${this.bucket}/${storagePath}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.serviceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ expiresIn: ttl }),
      },
    );

    if (!response.ok) {
      throw new Error(`Supabase Storage refused a signed read URL (HTTP ${response.status})`);
    }

    const body = (await response.json()) as { signedURL?: string };
    if (!body.signedURL) throw new Error('Supabase Storage returned no signed URL');
    return `${this.url}/storage/v1${body.signedURL}`;
  }
}

/* -------------------------------------------------------------------------
 * Local development backend
 * ---------------------------------------------------------------------- */

export const LOCAL_UPLOAD_DIR = process.env.LOCAL_UPLOAD_DIR ?? 'uploads';

/**
 * Signs a local ticket so `PUT /api/uploads/local/:token` cannot be pointed at
 * an arbitrary path.
 *
 * Reuses `JWT_SECRET` rather than introducing a second secret to configure. The
 * token is opaque, short-lived, and carries the path it authorises.
 */
function signLocalTicket(storagePath: string, expiresAt: number): string {
  const payload = Buffer.from(JSON.stringify({ storagePath, expiresAt })).toString('base64url');
  const secret = process.env.JWT_SECRET ?? 'local-development-only';
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyLocalTicket(token: string, now: Date = new Date()): string {
  const [payload, signature] = token.split('.');
  if (!payload || !signature) throw new UploadValidationError('malformed upload ticket');

  const secret = process.env.JWT_SECRET ?? 'local-development-only';
  const expected = createHmac('sha256', secret).update(payload).digest('base64url');

  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new UploadValidationError('upload ticket signature does not verify');
  }

  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
    storagePath: string;
    expiresAt: number;
  };

  if (decoded.expiresAt <= now.getTime()) {
    throw new UploadValidationError('upload ticket has expired');
  }

  // Re-validated after decoding: the shape is checked at issue and again at use.
  assertPrivateStoragePath(decoded.storagePath);
  return decoded.storagePath;
}

class LocalDocumentStorage implements DocumentStorage {
  readonly backend = 'local' as const;

  constructor(private readonly baseUrl: string) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'The local file backend must never run in production: a serverless filesystem is ' +
          'ephemeral, so a CNIC image written to it is lost on the next deployment. ' +
          'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
      );
    }
  }

  async createUploadTicket(request: UploadRequest): Promise<UploadTicket> {
    validateUpload(request);
    const storagePath = buildStoragePath(request);
    const ttl = Number(process.env.SIGNED_URL_TTL_SECONDS ?? 300);
    const expiresAt = new Date(Date.now() + ttl * 1000);

    await fs.mkdir(path.join(LOCAL_UPLOAD_DIR, path.dirname(storagePath)), { recursive: true });

    return {
      storagePath,
      uploadUrl: `${this.baseUrl}/api/uploads/local/${signLocalTicket(storagePath, expiresAt.getTime())}`,
      method: 'PUT',
      headers: { 'Content-Type': request.mimeType },
      expiresAt,
      maxBytes: MAX_UPLOAD_BYTES,
    };
  }

  async putObject(request: UploadRequest, body: Buffer): Promise<string> {
    validateUploadContent(request, body);
    const storagePath = buildStoragePath(request);
    await writeLocalUpload(storagePath, body);
    return storagePath;
  }

  async createReadUrl(storagePath: string, ttlSeconds?: number): Promise<string> {
    assertPrivateStoragePath(storagePath);
    const ttl = ttlSeconds ?? Number(process.env.SIGNED_URL_TTL_SECONDS ?? 300);
    const token = signLocalTicket(storagePath, Date.now() + ttl * 1000);
    return `${this.baseUrl}/api/uploads/local/${token}`;
  }
}

/** Writes an uploaded body to the local directory. Used only by the dev route. */
export async function writeLocalUpload(storagePath: string, body: Buffer): Promise<void> {
  assertPrivateStoragePath(storagePath);
  if (body.byteLength > MAX_UPLOAD_BYTES) {
    throw new UploadValidationError('the file exceeds the 5 MB limit');
  }
  const target = path.join(LOCAL_UPLOAD_DIR, storagePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, body);
}

export async function readLocalUpload(storagePath: string): Promise<Buffer> {
  assertPrivateStoragePath(storagePath);
  return fs.readFile(path.join(LOCAL_UPLOAD_DIR, storagePath));
}

/* -------------------------------------------------------------------------
 * Selection
 * ---------------------------------------------------------------------- */

let cached: DocumentStorage | null = null;

export function getDocumentStorage(): DocumentStorage {
  if (cached) return cached;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? 'ustaad-private-documents';

  const configured =
    url && key && !url.includes('YOUR-PROJECT-REF') && !key.startsWith('REPLACE_');

  cached = configured
    ? new SupabaseDocumentStorage(url, key, bucket)
    : new LocalDocumentStorage(process.env.PUBLIC_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`);

  return cached;
}

/** Test seam. */
export function resetDocumentStorage(): void {
  cached = null;
}
