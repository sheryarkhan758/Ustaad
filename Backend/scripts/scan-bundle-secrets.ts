/**
 * Prove no secret reached the client bundle — NFR-5, SEC-12, SEC-25, §2.2.
 *
 *     npx tsx scripts/scan-bundle-secrets.ts [--dir client/dist]
 *
 * Deployment step: after `npm run build:client`, grep the built output for the
 * **actual value** of every secret in the environment. Not the variable name —
 * the value. A build that inlined `JWT_SECRET` would not contain the string
 * "JWT_SECRET"; it would contain the secret itself, which is exactly what a
 * name-based check misses.
 *
 * ── Why a build-time check and not a code review ───────────────────────────
 * Vite inlines anything prefixed `VITE_` into the bundle, by design. That is a
 * one-character mistake — `VITE_GEMINI_API_KEY` instead of `GEMINI_API_KEY` —
 * between a server-side key and a key published to every visitor. Code review
 * catches that on a good day. This catches it on every day.
 *
 * ── What is deliberately allowed ───────────────────────────────────────────
 * EmailJS's *public* identifiers (service id, template id, public key) are
 * designed to be in client code and are listed as permitted (SEC-25). The
 * private key is not, and is checked for like any other secret.
 *
 * Exit code 1 on any hit, so this can gate a deploy.
 */

import 'dotenv/config';

import fs from 'node:fs';
import path from 'node:path';

/**
 * Variables whose **values** must never appear in the client bundle.
 *
 * Anything not listed as permitted below is treated as a secret if it is set.
 */
const SECRET_VARS = [
  'SUPABASE_DB_URL',
  'DATABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'JWT_SECRET',
  'CNIC_HASH_SALT',
  'ADDRESS_ENCRYPTION_KEY',
  'GEMINI_API_KEY',
  'GROQ_API_KEY',
  'EMAILJS_PRIVATE_KEY',
  'EMAILJS_SERVICE_ID',
  'EMAILJS_TEMPLATE_ID',
  'EMAILJS_PUBLIC_KEY',
] as const;

/**
 * SEC-25 permits exactly these three in client code — they identify a template,
 * they do not authorise anything. Everything else on the list above is a hit.
 *
 * They are still *scanned*, and reported as `permitted` when found, because
 * "we did not find it" and "we found it and it is allowed" are different
 * results and only one of them is evidence.
 */
const PERMITTED_IN_CLIENT = new Set([
  'EMAILJS_SERVICE_ID',
  'EMAILJS_TEMPLATE_ID',
  'EMAILJS_PUBLIC_KEY',
]);

/** A value too short or too common to search for without false positives. */
function isSearchable(value: string): boolean {
  return value.length >= 12 && !/^(true|false|development|production|localhost)$/i.test(value);
}

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    // Source maps are shipped or not, but if they are shipped they are as
    // public as the bundle, so they are scanned too.
    return /\.(js|mjs|cjs|css|html|json|map|txt)$/i.test(entry.name) ? [full] : [];
  });
}

function main(): void {
  const dirArg = process.argv.indexOf('--dir');
  const dir = dirArg >= 0 ? process.argv[dirArg + 1]! : 'client/dist';

  if (!fs.existsSync(dir)) {
    console.error(`✗ "${dir}" does not exist. Build the client first, then re-run.`);
    process.exitCode = 1;
    return;
  }

  const files = walk(dir);
  if (files.length === 0) {
    console.error(`✗ "${dir}" contains no scannable files. Refusing to report a pass.`);
    process.exitCode = 1;
    return;
  }

  console.log(`▸ scanning ${files.length} built file(s) in ${dir}\n`);

  const contents = files.map((file) => ({ file, text: fs.readFileSync(file, 'utf8') }));

  let leaked = 0;
  let scanned = 0;
  let skipped = 0;

  for (const name of SECRET_VARS) {
    const value = process.env[name];

    if (!value || !isSearchable(value)) {
      console.log(`  ${'—'.padEnd(4)} ${name.padEnd(28)} not set locally — NOT VERIFIED`);
      skipped += 1;
      continue;
    }

    scanned += 1;
    const hits = contents.filter((f) => f.text.includes(value)).map((f) => f.file);
    const permitted = PERMITTED_IN_CLIENT.has(name);

    if (hits.length === 0) {
      console.log(`  ${'ok'.padEnd(4)} ${name.padEnd(28)} absent from the bundle`);
    } else if (permitted) {
      console.log(`  ${'ok'.padEnd(4)} ${name.padEnd(28)} present, permitted by SEC-25 (${hits.length} file(s))`);
    } else {
      console.log(`  ${'LEAK'.padEnd(4)} ${name.padEnd(28)} FOUND IN: ${hits.join(', ')}`);
      leaked += 1;
    }
  }

  // Independently of the named list: nothing VITE_-prefixed should carry a
  // credential-shaped value. This catches a variable nobody thought to list.
  const suspiciousVite = Object.entries(process.env)
    .filter(([key]) => key.startsWith('VITE_'))
    .filter(([key]) => /KEY|SECRET|TOKEN|PASSWORD|SALT|DSN|URL/i.test(key))
    .filter(([key]) => !PERMITTED_IN_CLIENT.has(key.replace(/^VITE_/, '')));

  console.log('');
  if (suspiciousVite.length > 0) {
    console.log('  Credential-shaped VITE_ variables (these are inlined into the bundle by design):');
    for (const [key] of suspiciousVite) console.log(`    ! ${key}`);
    leaked += suspiciousVite.length;
  } else {
    console.log('  No credential-shaped VITE_ variable is set.');
  }

  console.log('');
  console.log(`${scanned} secret(s) verified, ${skipped} not set locally, ${leaked} leak(s).`);

  if (skipped > 0) {
    // Honesty matters more than a green tick: a value that is not in this
    // environment was not checked, and saying otherwise would be a lie the
    // next person relies on.
    console.log('');
    console.log('  NOTE: variables marked NOT VERIFIED were absent from this environment.');
    console.log('  Run this again with the production values loaded to check them.');
  }

  if (leaked > 0) {
    console.error('\n✗ a secret reached the client bundle. Do not deploy this build.');
    process.exitCode = 1;
  } else {
    console.log('\n✓ no scanned secret appears in the client bundle.');
  }
}

main();
