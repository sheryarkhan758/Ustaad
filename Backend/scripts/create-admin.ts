/**
 * Create an administrator account — §5.1, FR-1.5.
 *
 * ── Why this is a script and not an endpoint ──────────────────────────────
 * `REGISTERABLE_ROLES` in `shared/auth.ts` is `parent | student | tutor |
 * organisation`. `admin` is absent **by construction**, not by a check that
 * could be forgotten, so there is no request anybody can send that produces an
 * administrator. That is the property this script preserves rather than works
 * around: creating one requires access to the database, which means access to
 * the deployment, which is the correct bar for an account that can approve
 * verifications and read disclosed addresses.
 *
 * ── The password never enters this repository ─────────────────────────────
 * It is read from `ADMIN_PASSWORD` in the environment. Not a CLI argument —
 * arguments land in shell history and in the process list, where any other
 * user on the machine can read them. Not a constant in this file — the
 * repository is public (§2.2), and a committed administrator password is a
 * committed administrator password whether or not anybody has deployed yet.
 *
 * The script never prints the password back, at any log level.
 *
 * ── Usage ─────────────────────────────────────────────────────────────────
 *   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='...' \
 *   SUPABASE_DB_URL='postgresql://...' npx tsx scripts/create-admin.ts
 *
 * Omit `SUPABASE_DB_URL` to create one in the local SQLite database instead.
 * Re-running with an existing email **resets that account's password** and
 * bumps `tokenVersion`, which invalidates every session it had — the right
 * behaviour for a forgotten credential, and stated here so it is not a
 * surprise.
 */

import 'dotenv/config';
import { eq } from 'drizzle-orm';

import { newId, nowIso } from '../shared/db-values';
import { db } from '../server/db';
import { users } from '../server/db/schema/identity';
import { hashPassword } from '../server/services/auth';

/**
 * The floor a human-chosen administrator password must clear.
 *
 * Twelve characters rather than eight. This account approves identity
 * verifications, resolves payment disputes and can request the disclosure of a
 * family's address; it is the highest-value credential in the system and the
 * one most worth guessing.
 */
const MIN_PASSWORD_LENGTH = 12;

/**
 * Passwords that must never reach a deployment.
 *
 * The demonstration password is on this list deliberately: it is published in
 * the README, which is the entire reason it is safe for synthetic local data
 * and the entire reason it is not safe for anything else.
 */
const FORBIDDEN = new Set(['demo-ustaad-2026', 'password', 'admin', 'changeme', 'ustaad']);

function fail(message: string): never {
  // The message names what is wrong and never echoes the value.
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const displayName = process.env.ADMIN_NAME?.trim() || 'Platform Administrator';

  if (!email) fail('ADMIN_EMAIL is not set.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail('ADMIN_EMAIL is not an email address.');
  if (!password) fail('ADMIN_PASSWORD is not set. Pass it in the environment, never as an argument.');

  if (password.length < MIN_PASSWORD_LENGTH) {
    fail(`ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (FORBIDDEN.has(password.toLowerCase())) {
    fail(
      'That password is published in this repository or is a common default. ' +
        'An administrator can approve verifications and request address disclosure; ' +
        'choose something nobody can read off GitHub.',
    );
  }

  const target = process.env.SUPABASE_DB_URL ? 'Supabase Postgres' : 'the local SQLite database';
  const passwordHash = await hashPassword(password);
  const now = nowIso();

  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);

  if (existing) {
    if (existing.role !== 'admin') {
      fail(
        `${email} already exists with the role "${existing.role}". ` +
          'An account never changes role — create the administrator under its own address.',
      );
    }

    /*
     * Bumping `tokenVersion` invalidates every outstanding session for this
     * account at once (see the session note in `schema/identity.ts`). Anybody
     * resetting an administrator password is doing it because the old one may
     * be compromised, so leaving existing sessions alive would defeat the
     * point.
     */
    await db
      .update(users)
      .set({
        passwordHash,
        status: 'active',
        tokenVersion: existing.tokenVersion + 1,
        updatedAt: now,
      })
      .where(eq(users.id, existing.id));

    console.log(`\n✓ Password reset for the existing administrator in ${target}.`);
    console.log(`  ${email}`);
    console.log('  Every session this account had is now signed out.\n');
    return;
  }

  await db.insert(users).values({
    id: newId(),
    email,
    passwordHash,
    role: 'admin',
    displayName,
    // Active immediately. An administrator has nothing to verify against —
    // the account is created by somebody who already holds the database.
    status: 'active',
    preferredLang: 'en',
    updatedAt: now,
  });

  console.log(`\n✓ Administrator created in ${target}.`);
  console.log(`  ${email}`);
  console.log('  Sign in at /login. The password is the one you supplied; it was not stored');
  console.log('  anywhere but as a bcrypt hash, and is not printed here.\n');
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    // Never let a driver error carry a connection string into a CI log.
    console.error('\n✗ Could not create the administrator.');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
