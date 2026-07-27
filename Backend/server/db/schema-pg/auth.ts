// ─────────────────────────────────────────────────────────────────────────────
// GENERATED FILE — DO NOT EDIT.
// Produced from ../schema/auth.ts by scripts/generate-pg-schema.ts.
// Edit the SQLite schema and re-run:  npx tsx scripts/generate-pg-schema.ts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Refresh tokens — FR-1.2.
 *
 * ── Why this table exists, reversing an earlier decision ───────────────────
 * `identity.ts` originally documented a stateless JWT with no session table,
 * on the grounds that a serverless deployment cannot afford a database round
 * trip on every authenticated request against a 500 ms search budget (NFR-1).
 * That reasoning still holds and is preserved here: **the access token is
 * still stateless and still verified without touching the database.**
 *
 * What changed is that rotation was required, and rotation without storage is
 * not rotation — you cannot detect that a token has been replayed if you never
 * recorded issuing it. So this table is consulted on one endpoint only,
 * `POST /api/auth/refresh`, roughly once per access-token lifetime rather than
 * once per request. The cost the earlier note was avoiding is not incurred.
 *
 * ── What is stored ─────────────────────────────────────────────────────────
 * Never the token. A SHA-256 hash of it, so that a leaked database dump does
 * not hand an attacker a set of working sessions. The comparison is a lookup on
 * the hash, so it needs no secret.
 *
 * ── Reuse detection ────────────────────────────────────────────────────────
 * Tokens are grouped into a `family_id` — one family per login. Rotation
 * revokes the presented token and issues its successor in the same family.
 * If an **already revoked** token is presented, that means one of two things:
 * the legitimate client replayed an old token, or someone stole one. Neither is
 * distinguishable from the server, so the whole family is revoked and the user
 * must log in again. Erring towards logging someone out is the correct
 * direction on a platform that arranges adults visiting homes with children in
 * them.
 *
 * ── The child-safety property ──────────────────────────────────────────────
 * `user_id` references `users`, and `users` has no row for a minor (SEC-1).
 * There is deliberately no foreign key from this table to `student_profiles`
 * and no nullable alternative owner: a session cannot be created for a learner
 * who has no account, because there is no column in which to record one.
 */

import { index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

import { createdAt, pk, timestampCol } from './_common';
import { users } from './identity';

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: pk(),
    /**
     * The account this session belongs to. Not nullable, and there is no
     * second owner column — see the child-safety note above.
     */
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** SHA-256 of the token, hex. The token itself is never stored. */
    tokenHash: text('token_hash').notNull(),
    /** One family per login. Rotation stays inside it; reuse revokes all of it. */
    familyId: text('family_id').notNull(),
    /** ISO-8601 UTC text, like every timestamp here (PORTABILITY.md rule 1). */
    expiresAt: text('expires_at').notNull(),
    /** Set when rotated away from, or when the family is revoked. */
    revokedAt: timestampCol('revoked_at'),
    /** The token issued in its place, for tracing a rotation chain. */
    replacedById: text('replaced_by_id'),
    createdAt: createdAt(),
  },
  (t) => [
    // The refresh lookup: one row, by hash.
    uniqueIndex('idx_refresh_tokens_hash').on(t.tokenHash),
    // Revoking a family on reuse detection.
    index('idx_refresh_tokens_family').on(t.familyId),
    // "Log me out everywhere", and the expiry sweep.
    index('idx_refresh_tokens_user').on(t.userId, t.revokedAt),
  ],
);

export type RefreshToken = typeof refreshTokens.$inferSelect;
