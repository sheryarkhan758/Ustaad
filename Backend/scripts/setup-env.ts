/**
 * Create a local `.env` from `.env.example`, with real random secrets.
 *
 *     npm run setup:env
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * Three variables cannot have a useful placeholder: `JWT_SECRET`,
 * `CNIC_HASH_SALT` and `ADDRESS_ENCRYPTION_KEY`. Without them the API starts
 * and then fails at the first login with `jwt_secret_missing`, which is a
 * confusing first five minutes for someone who has just cloned the repository.
 *
 * The alternative — shipping a default secret in `.env.example` — is worse.
 * A committed default is the secret everybody deploys with, and this repository
 * is public (§2.2). So the values are generated here, on the machine that will
 * use them, and written to a file `.gitignore` already excludes.
 *
 * ── What it will not do ────────────────────────────────────────────────────
 * It never overwrites an existing `.env`. Regenerating `ADDRESS_ENCRYPTION_KEY`
 * would make every booking address already encrypted with the old key
 * permanently unreadable (SEC-3), and doing that silently because someone ran a
 * setup script twice is not acceptable. Pass `--force` only if you understand
 * that.
 *
 * It writes no AI key. Every AI path has a working non-AI fallback (NFR-11) and
 * the demonstration path makes no model call at all (FR-15.7), so the project
 * runs fully without one.
 */

import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ENV_PATH = path.resolve('.env');
const EXAMPLE_PATH = path.resolve('.env.example');

/** URL-safe, 48 bytes of entropy. */
function secret(): string {
  return randomBytes(48).toString('base64url');
}

/** AES-256 needs exactly 32 bytes, expressed as 64 hex characters. */
function aesKeyHex(): string {
  return randomBytes(32).toString('hex');
}

function main(): void {
  const force = process.argv.includes('--force');

  if (fs.existsSync(ENV_PATH) && !force) {
    console.log('▸ .env already exists — leaving it alone.');
    console.log('  Rotating ADDRESS_ENCRYPTION_KEY would make existing encrypted');
    console.log('  booking addresses unreadable (SEC-3). Pass --force if you mean it.');
    return;
  }

  if (!fs.existsSync(EXAMPLE_PATH)) {
    console.error('✗ .env.example not found. Run this from the repository root.');
    process.exitCode = 1;
    return;
  }

  const generated: Record<string, string> = {
    JWT_SECRET: secret(),
    CNIC_HASH_SALT: secret(),
    ADDRESS_ENCRYPTION_KEY: aesKeyHex(),
  };

  const output = fs
    .readFileSync(EXAMPLE_PATH, 'utf8')
    .split('\n')
    .map((line) => {
      const match = /^([A-Z0-9_]+)=/.exec(line);
      if (!match) return line;
      const key = match[1]!;
      const value = generated[key];
      if (!value) return line;

      // Keep the trailing comment: it is where the requirement reference lives.
      const comment = line.includes('#') ? `   # ${line.slice(line.indexOf('#') + 1).trim()}` : '';
      return `${key}=${value}${comment}`;
    })
    .join('\n');

  fs.writeFileSync(ENV_PATH, output, 'utf8');

  console.log('✓ wrote .env with freshly generated secrets:');
  for (const key of Object.keys(generated)) console.log(`    ${key}`);
  console.log('  .env is gitignored and must never be committed (§2.2).');
  console.log('  No AI key was written — every AI path has a non-AI fallback (NFR-11),');
  console.log('  and the demonstration path makes no model call at all (FR-15.7).');
}

main();
