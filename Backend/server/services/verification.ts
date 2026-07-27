/**
 * Verification — §6.6, §6.28. The platform's anti-fraud claim, in code.
 *
 * Ustaad.com's substantive answer to a market with no identity verification is
 * not that fraud is impossible. It is that **every approval is attributable,
 * timestamped, itemised and appealable**. That only means something if the
 * record cannot be rewritten afterwards, so:
 *
 *  · every decision appends a `verification_records` row and never updates one;
 *  · every decision appends to `admin_actions`, which has no update or delete
 *    path anywhere in the codebase (NFR-19, SEC-13);
 *  · every decision, including approval, carries a written reason (FR-6.6);
 *  · every document view is logged with actor, tutor, doc type and time
 *    (SEC-7, NFR-9) — and never the CNIC number itself.
 *
 * ── What this module will not do ───────────────────────────────────────────
 * It will not store a CNIC number. It will not auto-reject a duplicate. It will
 * not make an automated verdict final. Each of those is a deliberate refusal
 * with its reasoning at the relevant function.
 */

import { createHash, timingSafeEqual } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { buildBadges, type BadgeResult } from '../../shared/badges';
import type { VerifiableArtefact } from '../../shared/badges';
import { newId, nowIso } from '../../shared/db-values';
import { normaliseCnic } from '../../shared/verification';
import type { Executor } from '../repositories/_base';
import { flags } from '../db/schema/admin';
import {
  APPEAL_COOLING_DAYS,
  COMPETENCY_BADGE_MONTHS,
  cnicRegistrations,
  notifications,
  verificationAppeals,
  verificationRecords,
} from '../db/schema/verification';
import type {
  NotificationKind,
  VerificationDecision,
  VerificationTrack,
} from '../db/schema/verification';
import { SEARCHABLE_PROFILE_STATUS } from '../db/schema/tutor';
import { getTutorProfileOrThrow, updateTutorProfileFields } from '../repositories/tutors';
import { listTutorDocuments } from '../repositories/tutors';
import { appendAdminAction } from './audit';
import { getDocumentStorage } from './storage';

export class VerificationError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'VerificationError';
    this.status = status;
    this.code = code;
  }
}

/* =========================================================================
 * Dates — ISO YYYY-MM-DD, computed in TypeScript (PORTABILITY.md rule 1)
 * ====================================================================== */

export function isoDate(at: Date): string {
  return at.toISOString().slice(0, 10);
}

export function addMonths(at: Date, months: number): Date {
  const out = new Date(at.getTime());
  out.setUTCMonth(out.getUTCMonth() + months);
  return out;
}

export function addDays(at: Date, days: number): Date {
  return new Date(at.getTime() + days * 24 * 60 * 60 * 1000);
}

/* =========================================================================
 * CNIC hashing — SEC-8, NFR-10, FR-28.7
 * ====================================================================== */

const SALT_VERSION = 'v1';

function cnicSalt(): string {
  const salt = process.env.CNIC_HASH_SALT;
  if (!salt || salt.trim() === '' || salt.startsWith('REPLACE_')) {
    throw new VerificationError(
      500,
      'cnic_salt_missing',
      'CNIC_HASH_SALT is not configured. CNIC numbers are stored only as a salted hash, and ' +
        'the application will not compute one without a salt (SEC-8, NFR-10).',
    );
  }
  return salt;
}

/**
 * Salted SHA-256 of the digits.
 *
 * The plaintext exists only as a local variable inside this function and its
 * caller's request body. **It is never written to a column, never returned, and
 * never logged** — a CNIC in an error message or a debug line is the same
 * disclosure as a CNIC in a column, and this codebase treats it that way.
 *
 * A salt rather than a bare digest because the space of valid CNICs is small
 * enough to enumerate: 13 digits is 10^13, which a GPU walks through in
 * minutes. Unsalted, the "hash" would be a reversible encoding of the number.
 */
export function hashCnic(cnic: string): string {
  const digits = normaliseCnic(cnic);
  if (digits.length !== 13) {
    throw new VerificationError(400, 'cnic_invalid', 'A CNIC is 13 digits.');
  }
  return createHash('sha256').update(`${cnicSalt()}:${digits}`).digest('hex');
}

/** Constant-time, because a hash comparison is still a secret comparison. */
export function cnicHashesMatch(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'hex');
  const bufferB = Buffer.from(b, 'hex');
  if (bufferA.length !== bufferB.length || bufferA.length === 0) return false;
  return timingSafeEqual(bufferA, bufferB);
}

export interface CnicRegistrationResult {
  duplicate: boolean;
  /** Other tutors already registered against the same hash. */
  collidingTutorIds: string[];
  flagId: string | null;
}

/**
 * Record a tutor's CNIC hash and detect reuse across accounts.
 *
 * **A collision is flagged to an administrator; it is never auto-rejected**
 * (FR-28.7). Two accounts sharing an identity document is usually fraud and
 * occasionally something innocent — a failed first signup, a sibling using a
 * parent's phone to register. A machine cannot tell those apart, and getting it
 * wrong in the auto-reject direction locks somebody out of earning with no
 * recourse and no explanation. So the platform surfaces it to a person.
 */
export async function registerCnic(
  db: Executor,
  tutorId: string,
  cnic: string,
): Promise<CnicRegistrationResult> {
  const hash = hashCnic(cnic);

  const existing = await db.select().from(cnicRegistrations);
  const colliding = existing
    .filter((row) => row.tutorId !== tutorId && cnicHashesMatch(row.cnicHash, hash))
    .map((row) => row.tutorId);

  const alreadyMine = existing.find((row) => row.tutorId === tutorId);
  if (!alreadyMine) {
    await db.insert(cnicRegistrations).values({
      id: newId(),
      tutorId,
      cnicHash: hash,
      saltVersion: SALT_VERSION,
      createdAt: nowIso(),
    });
  }

  if (colliding.length === 0) {
    return { duplicate: false, collidingTutorIds: [], flagId: null };
  }

  // Into the administrator flag queue (FR-14.2), where a person decides.
  const flagId = newId();
  await db.insert(flags).values({
    id: flagId,
    targetType: 'tutor_profile',
    targetId: tutorId,
    reporterUserId: null,
    reason: 'duplicate_cnic',
    // The colliding profile ids, never the number or the hash.
    detail: `The same identity document is registered against ${colliding.length} other ` +
      `profile(s): ${colliding.join(', ')}. Review before approving.`,
    status: 'open',
    createdAt: nowIso(),
  });

  return { duplicate: true, collidingTutorIds: colliding, flagId };
}

/* =========================================================================
 * Document viewing — SEC-7, NFR-9
 * ====================================================================== */

export interface DocumentViewResult {
  url: string;
  expiresInSeconds: number;
  docType: string;
}

/**
 * Issue a short-lived signed URL for one document, and log the access.
 *
 * The audit entry is written **before** the URL is minted, so a failure to log
 * is a failure to disclose. It records the administrator, the tutor, the
 * document type and the time — and nothing about the document's contents. A
 * CNIC number is not in the entry because it is not anywhere in the system:
 * only a salted hash is stored, and the image lives in the private bucket
 * (SEC-8, NFR-10).
 */
export async function viewDocument(
  db: Executor,
  input: {
    adminUserId: string;
    tutorId: string;
    documentId: string;
    purpose: string;
  },
): Promise<DocumentViewResult> {
  const documents = await listTutorDocuments(db, input.tutorId);
  const document = documents.find((d) => d.id === input.documentId);

  if (!document) {
    throw new VerificationError(404, 'document_not_found', 'No such document.');
  }

  await appendAdminAction(db, {
    adminUserId: input.adminUserId,
    action: 'tutor.document_viewed',
    targetType: 'tutor_profile',
    targetId: input.tutorId,
    detailJson: {
      documentId: document.id,
      docType: document.docType,
      purpose: input.purpose,
      // Deliberately absent: the storage path, any signed URL, and of course
      // any CNIC number. The log records that a view happened, not its content.
    },
  });

  const ttl = Number(process.env.SIGNED_URL_TTL_SECONDS ?? 300);
  const url = await getDocumentStorage().createReadUrl(document.storagePath, ttl);

  return { url, expiresInSeconds: ttl, docType: document.docType };
}

/* =========================================================================
 * Identity decisions — §6.6
 * ====================================================================== */

export interface DecisionResult {
  recordId: string;
  decision: VerificationDecision;
  searchable: boolean;
}

async function appendRecord(
  db: Executor,
  input: {
    tutorId: string;
    track: VerificationTrack;
    decision: VerificationDecision;
    artefactsChecked: readonly VerifiableArtefact[];
    decidedBy: string;
    reason: string;
    expiresOn?: string | null;
    claimId?: string | null;
    supersedesId?: string | null;
    at: Date;
  },
): Promise<string> {
  const id = newId();
  await db.insert(verificationRecords).values({
    id,
    tutorId: input.tutorId,
    track: input.track,
    decision: input.decision,
    artefactsCheckedJson: JSON.stringify([...input.artefactsChecked]),
    decidedBy: input.decidedBy,
    decidedAt: input.at.toISOString(),
    reason: input.reason,
    expiresOn: input.expiresOn ?? null,
    claimId: input.claimId ?? null,
    supersedesId: input.supersedesId ?? null,
    createdAt: nowIso(),
  });
  return id;
}

async function notify(
  db: Executor,
  userId: string,
  kind: NotificationKind,
  title: string,
  body: string,
  linkPath?: string,
): Promise<void> {
  await db.insert(notifications).values({
    id: newId(),
    userId,
    kind,
    title,
    body,
    linkPath: linkPath ?? null,
    createdAt: nowIso(),
  });
}

/**
 * Approve an identity verification.
 *
 * Records **which artefacts were checked, individually**. The public badge is
 * generated from that list and nothing else, so a profile can never claim more
 * than the administrator actually looked at (FR-6.5, FR-6.9). Approval is what
 * makes the profile searchable (FR-6.3), and this is the only function in the
 * codebase that writes `approved`.
 */
export async function approveIdentity(
  db: Executor,
  input: {
    tutorId: string;
    adminUserId: string;
    artefactsChecked: readonly VerifiableArtefact[];
    reason: string;
    at?: Date;
  },
): Promise<DecisionResult> {
  const at = input.at ?? new Date();
  const profile = await getTutorProfileOrThrow(db, input.tutorId);

  if (input.artefactsChecked.length === 0) {
    throw new VerificationError(
      400,
      'no_artefacts_checked',
      'Record at least one artefact you checked. The public badge is generated from this list.',
    );
  }

  const recordId = await appendRecord(db, {
    tutorId: input.tutorId,
    track: 'identity',
    decision: 'approved',
    artefactsChecked: input.artefactsChecked,
    decidedBy: input.adminUserId,
    reason: input.reason,
    at,
  });

  await updateTutorProfileFields(db, input.tutorId, { profileStatus: SEARCHABLE_PROFILE_STATUS });

  await appendAdminAction(db, {
    adminUserId: input.adminUserId,
    action: 'tutor.identity_approved',
    targetType: 'tutor_profile',
    targetId: input.tutorId,
    detailJson: {
      recordId,
      artefactsChecked: [...input.artefactsChecked],
      reason: input.reason,
    },
  });

  await notify(
    db,
    profile.userId,
    'verification_approved',
    'Your profile is now verified and searchable',
    `Ustaad.com checked: ${input.artefactsChecked.join(', ')}. Families can now find you in ` +
      'search.',
    '/tutor/profile',
  );

  return { recordId, decision: 'approved', searchable: true };
}

/** Reject. The reason is surfaced to the tutor verbatim (FR-6.7). */
export async function rejectIdentity(
  db: Executor,
  input: {
    tutorId: string;
    adminUserId: string;
    artefactsChecked: readonly VerifiableArtefact[];
    reason: string;
    at?: Date;
  },
): Promise<DecisionResult> {
  const at = input.at ?? new Date();
  const profile = await getTutorProfileOrThrow(db, input.tutorId);

  const recordId = await appendRecord(db, {
    tutorId: input.tutorId,
    track: 'identity',
    decision: 'rejected',
    artefactsChecked: input.artefactsChecked,
    decidedBy: input.adminUserId,
    reason: input.reason,
    at,
  });

  await updateTutorProfileFields(db, input.tutorId, { profileStatus: 'rejected' });

  await appendAdminAction(db, {
    adminUserId: input.adminUserId,
    action: 'tutor.identity_rejected',
    targetType: 'tutor_profile',
    targetId: input.tutorId,
    detailJson: { recordId, reason: input.reason },
  });

  await notify(
    db,
    profile.userId,
    'verification_rejected',
    'Your verification was not approved',
    `${input.reason}\n\nYou may appeal this decision after ${APPEAL_COOLING_DAYS} days.`,
    '/tutor/verification',
  );

  return { recordId, decision: 'rejected', searchable: false };
}

export async function requestMoreInformation(
  db: Executor,
  input: {
    tutorId: string;
    adminUserId: string;
    missingArtefacts: readonly VerifiableArtefact[];
    reason: string;
    at?: Date;
  },
): Promise<DecisionResult> {
  const at = input.at ?? new Date();
  const profile = await getTutorProfileOrThrow(db, input.tutorId);

  const recordId = await appendRecord(db, {
    tutorId: input.tutorId,
    track: 'identity',
    decision: 'more_info_needed',
    artefactsChecked: [],
    decidedBy: input.adminUserId,
    reason: input.reason,
    at,
  });

  await updateTutorProfileFields(db, input.tutorId, { profileStatus: 'more_info_needed' });

  await appendAdminAction(db, {
    adminUserId: input.adminUserId,
    action: 'tutor.more_information_requested',
    targetType: 'tutor_profile',
    targetId: input.tutorId,
    detailJson: {
      recordId,
      missingArtefacts: [...input.missingArtefacts],
      reason: input.reason,
    },
  });

  await notify(
    db,
    profile.userId,
    'verification_more_info',
    'More information is needed to verify your profile',
    input.reason,
    '/tutor/documents',
  );

  return { recordId, decision: 'more_info_needed', searchable: false };
}

/* =========================================================================
 * The public verification record — FR-6.9, FR-28.9
 * ====================================================================== */

export interface PublicVerification {
  verifiedOn: string | null;
  verifiedBy: 'Ustaad.com' | null;
  artefactsChecked: VerifiableArtefact[];
  badges: BadgeResult;
  appealOccurred: boolean;
}

/**
 * What a family sees on a profile.
 *
 * The **verifying party is named as the platform**, not as an individual
 * administrator — the administrator's identity is in the audit log where it
 * belongs, and publishing a staff member's name on every profile they touch
 * serves nobody. Outcomes only, never attempt content (FR-28.9).
 */
export async function buildPublicVerification(
  db: Executor,
  tutorId: string,
  verifiedTopics: readonly { name: string; expiresOn?: string }[] = [],
): Promise<PublicVerification> {
  const records = await db
    .select()
    .from(verificationRecords)
    .where(eq(verificationRecords.tutorId, tutorId))
    .orderBy(verificationRecords.decidedAt);

  const identityApprovals = records.filter(
    (r) => r.track === 'identity' && r.decision === 'approved',
  );
  const latest = identityApprovals[identityApprovals.length - 1];

  const artefacts = latest
    ? (JSON.parse(latest.artefactsCheckedJson) as VerifiableArtefact[])
    : [];

  const appeals = await db
    .select()
    .from(verificationAppeals)
    .where(eq(verificationAppeals.tutorId, tutorId));

  return {
    verifiedOn: latest ? latest.decidedAt.slice(0, 10) : null,
    verifiedBy: latest ? 'Ustaad.com' : null,
    artefactsChecked: artefacts,
    badges: buildBadges({ artefactsChecked: artefacts, verifiedTopics }),
    appealOccurred: appeals.length > 0,
  };
}

/* =========================================================================
 * Competency — issue and expiry are in verification-expiry.ts
 * ====================================================================== */

/** Twelve months from issue (FR-28.1). */
export function competencyExpiryDate(issuedAt: Date): string {
  return isoDate(addMonths(issuedAt, COMPETENCY_BADGE_MONTHS));
}
