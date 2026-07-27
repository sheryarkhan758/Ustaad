/**
 * Content sniffing — SEC-24, FR-33.3.
 *
 * An extension is a naming convention and a `Content-Type` header is a claim
 * the client makes about itself. Neither is evidence. `payload.exe` renamed to
 * `cv.pdf` and posted as `application/pdf` satisfies both checks and is still
 * an executable sitting in the private bucket, waiting for an administrator to
 * open it.
 *
 * So the bytes are read. A file is accepted only when its **declared type, its
 * extension and its leading bytes all agree** — the volunteer application form
 * is publicly reachable with no account, which makes it the one upload path in
 * this system a stranger can use, and it is where the weakest check would hurt
 * most.
 *
 * Pure and dependency-free on purpose: no `file-type` package, no libmagic, no
 * network. The three formats this platform accepts have short, unambiguous,
 * well-documented signatures, and a table of three is easier to audit than a
 * dependency that handles four hundred.
 */

export type SniffedType = 'application/pdf' | 'image/png' | 'image/jpeg';

interface Signature {
  mimeType: SniffedType;
  /** Byte prefix. `null` matches any byte at that position. */
  magic: (number | null)[];
  /** Extra structural check beyond the prefix, where one is cheap and useful. */
  verify?: (bytes: Uint8Array) => boolean;
}

const SIGNATURES: Signature[] = [
  {
    // "%PDF-"
    mimeType: 'application/pdf',
    magic: [0x25, 0x50, 0x44, 0x46, 0x2d],
  },
  {
    // \x89 P N G \r \n \x1a \n — the eight-byte header, which is deliberately
    // designed to detect a file mangled by a text-mode transfer.
    mimeType: 'image/png',
    magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  },
  {
    // SOI marker, then any APPn/Q-table marker.
    mimeType: 'image/jpeg',
    magic: [0xff, 0xd8, 0xff],
  },
];

/**
 * What the bytes actually are, or `null` for anything not on the list.
 *
 * Only the prefix is read, so this is cheap enough to run on every upload and
 * does not care how large the file is.
 */
export function sniffMimeType(bytes: Uint8Array): SniffedType | null {
  for (const signature of SIGNATURES) {
    if (bytes.length < signature.magic.length) continue;

    const matches = signature.magic.every(
      (expected, index) => expected === null || bytes[index] === expected,
    );

    if (matches && (signature.verify?.(bytes) ?? true)) return signature.mimeType;
  }
  return null;
}

export class FileSignatureError extends Error {
  readonly status = 400;
  readonly code = 'file_content_mismatch';

  constructor(message: string) {
    super(message);
    this.name = 'FileSignatureError';
  }
}

/**
 * Assert that the bytes are what the caller says they are.
 *
 * The error message names the declared type and refuses to name the sniffed
 * one. Telling an anonymous submitter "that is actually a ZIP archive" turns a
 * public form into a free file-type oracle, and it helps nobody who made an
 * honest mistake — they know what they attached.
 */
export function assertContentMatchesDeclaration(
  bytes: Uint8Array,
  declaredMimeType: string,
): SniffedType {
  const sniffed = sniffMimeType(bytes);

  if (sniffed === null) {
    throw new FileSignatureError(
      'That file is not a PDF, PNG or JPG. Please attach one of those.',
    );
  }

  if (sniffed !== declaredMimeType) {
    throw new FileSignatureError(
      `The file's contents do not match a ${declaredMimeType}. Please attach a genuine PDF, PNG or JPG.`,
    );
  }

  return sniffed;
}
