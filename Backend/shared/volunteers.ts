/**
 * Volunteer tutor programme — §6.33.
 *
 * University students, retired teachers and working professionals who will give
 * a few hours without charge. The informal market has no way to find them, no
 * way to verify them, and no standard to hold them to.
 *
 * ── The rule the module is built around ─────────────────────────────────────
 *
 * **A volunteer is verified on exactly the same basis as a paid tutor.** The
 * fee is what differs, not the standard (FR-33.10). The volunteer flag never
 * substitutes for verification, and a converted volunteer enters the §6.6 queue
 * as `pending_verification` like anyone else — goodwill is not a background
 * check, and the person is entering a family's home.
 *
 * ── Publicly reachable, and what follows from that ──────────────────────────
 *
 * No account is required (FR-33.1). That makes this the one write endpoint in
 * the system a stranger can reach that also sends mail, so it carries the
 * honeypot and time-on-form checks from `shared/anti-abuse.ts` and an IP rate
 * limit, and its attachment is sniffed rather than trusted (SEC-24).
 */

import { z } from 'zod';

import { antiAbuseFieldsSchema } from './anti-abuse';
import { TEACHING_MODES } from './rates';

export const VOLUNTEER_STATUSES = [
  'received',
  'contacted',
  'verified',
  'active',
  'declined',
  'withdrawn',
] as const;

export type VolunteerStatus = (typeof VOLUNTEER_STATUSES)[number];

/** Statuses an administrator may set directly. `active` follows conversion. */
export const REVIEWABLE_VOLUNTEER_STATUSES = [
  'contacted',
  'verified',
  'declined',
  'withdrawn',
] as const;

/**
 * Pakistani mobile and landline shapes, permissively.
 *
 * `03001234567`, `+923001234567`, `0300-1234567`, `021 35678901` all pass. The
 * point is to catch a typo, not to be a validator: a form that rejects a real
 * number a volunteer actually answers has cost the platform a tutor to prevent
 * nothing. Separators are accepted and **stored as typed** — never normalised,
 * for the same reason no user text is (§2.10).
 */
const phoneSchema = z
  .string()
  .trim()
  .min(10)
  .max(20)
  .regex(/^\+?[\d\s-]+$/, 'enter a contact number using digits, spaces or dashes');

/**
 * A CV, degree or transcript. **PDF only** (FR-33.3).
 *
 * Narrower than the feedback attachment on purpose: a supporting document is
 * read by an administrator making a decision about someone, and a PDF is the
 * one format among the three that reliably carries a multi-page document.
 */
export const volunteerDocumentSchema = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.literal('application/pdf'),
  /** Base64, no data-URI prefix. The bytes are sniffed after decoding. */
  contentBase64: z.string().min(1),
});

export const submitVolunteerApplicationSchema = antiAbuseFieldsSchema.extend({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(200),
  phone: phoneSchema,
  cityId: z.string().min(1),
  areaId: z.string().min(1),
  subjectIds: z.array(z.string().min(1)).min(1).max(10),
  levelIds: z.array(z.string().min(1)).min(1).max(10),
  /**
   * The cap enforced at booking (FR-33.11), not a preference displayed.
   *
   * Twenty is the ceiling because past that a person is not volunteering, they
   * are working unpaid, and the platform should not be the thing that arranges
   * it.
   */
  weeklyHours: z.number().int().min(1).max(20),
  deliveryModes: z.array(z.enum(TEACHING_MODES)).min(1),
  gender: z.enum(['male', 'female']),
  /**
   * Any script, stored unchanged, never translated (§2.10). Optional: someone
   * who writes nothing here may still be exactly the tutor §6.29 is short of.
   */
  motivation: z.string().trim().max(2_000).optional(),
  document: volunteerDocumentSchema.nullable().optional(),
});

export type SubmitVolunteerApplicationInput = z.infer<typeof submitVolunteerApplicationSchema>;

export const reviewVolunteerSchema = z.object({
  status: z.enum(REVIEWABLE_VOLUNTEER_STATUSES),
  reviewNote: z.string().trim().min(3).max(2_000),
});

export type ReviewVolunteerInput = z.infer<typeof reviewVolunteerSchema>;

/**
 * Approval — FR-33.10.
 *
 * Creates a tutor account carrying the volunteer flag and routes it into the
 * §6.6 queue. There is **no field here for a verification decision**, because
 * approving a volunteer application and verifying a tutor are different acts by
 * different evidence: this one says "we want this person", and only an
 * administrator checking a CNIC against academic documents says "this person is
 * who they say they are".
 */
export const approveVolunteerSchema = z.object({
  /** The account the volunteer will sign in with. */
  password: z.string().min(12).max(200),
  reviewNote: z.string().trim().min(3).max(2_000),
});

export type ApproveVolunteerInput = z.infer<typeof approveVolunteerSchema>;
