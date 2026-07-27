/**
 * Attachments that arrive as bytes in a request body — SEC-24, FR-32.5, FR-33.3.
 *
 * The tutor document flow issues a signed ticket and the browser PUTs straight
 * to Supabase, which is right for a logged-in tutor uploading a CNIC: the bytes
 * never pass through the API and there is nothing to hold.
 *
 * The two public forms cannot work that way. Issuing an upload ticket to an
 * anonymous caller hands a stranger a write credential for the private bucket
 * before anything of theirs has been validated, and it means the server never
 * sees the content — so it cannot sniff it, and FR-33.3 requires that it does.
 *
 * So these come in base64, are decoded here, and are checked three ways —
 * declared type, extension, and **leading bytes** — before anything is written.
 */

import { attachmentSchema } from '../../shared/feedback';
import { UploadValidationError, getDocumentStorage, type UploadRequest } from './storage';

/** 5 MB of bytes, expressed as the base64 that carries them, plus slack. */
const MAX_BASE64_LENGTH = Math.ceil((5 * 1024 * 1024 * 4) / 3) + 1024;

export interface StoreSubmittedFileInput {
  scope: UploadRequest['scope'];
  ownerId: string;
  kind: string;
  file: { fileName: string; mimeType: string; contentBase64: string };
}

/**
 * Decode, validate, store. Returns the bucket key — never a URL.
 *
 * The length is checked **before** decoding: a 40 MB base64 string decoded into
 * a Buffer to discover it is too large has already cost the 40 MB, on an
 * endpoint anyone can call.
 */
export async function storeSubmittedFile(input: StoreSubmittedFileInput): Promise<string> {
  const parsed = attachmentSchema.safeParse(input.file);
  if (!parsed.success) {
    throw new UploadValidationError('The attachment is not a PNG, JPG or PDF.');
  }

  if (input.file.contentBase64.length > MAX_BASE64_LENGTH) {
    throw new UploadValidationError('The attachment is larger than 5 MB.');
  }

  const body = Buffer.from(input.file.contentBase64, 'base64');
  if (body.byteLength === 0) {
    throw new UploadValidationError('The attachment is empty.');
  }

  // `putObject` runs `validateUploadContent`: declaration, extension, size, and
  // then the magic bytes. A .exe renamed to .pdf dies there, not here.
  return getDocumentStorage().putObject(
    {
      scope: input.scope,
      ownerId: input.ownerId,
      kind: input.kind,
      fileName: input.file.fileName,
      mimeType: input.file.mimeType,
      sizeBytes: body.byteLength,
    },
    body,
  );
}
