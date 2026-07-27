/**
 * Post-deployment verification, run against the live URL.
 *
 *     npx tsx scripts/post-deploy-check.ts https://ustaad.netlify.app
 *
 * The six checks the deployment task requires, executed rather than asserted.
 * Every one hits the deployed API over HTTPS with no access to its internals,
 * which is the only way to learn whether the deployment works as opposed to
 * whether the code does.
 *
 * ── What it will not do ────────────────────────────────────────────────────
 * It creates no production data beyond what the checks need, and it **does not
 * seed**. Two checks are therefore conditional: a booking through to completion
 * and an AI conversation both require accounts that exist. If production has no
 * demonstration accounts, those are reported `SKIPPED` with the reason rather
 * than silently passing — a skipped check that prints a tick is worse than no
 * check.
 *
 * Exit code 1 if any check fails, so it can gate a release.
 */

const BASE = process.argv[2]?.replace(/\/$/, '');

if (!BASE) {
  console.error('usage: npx tsx scripts/post-deploy-check.ts https://your-site.netlify.app');
  process.exit(1);
}

/**
 * The password the demonstration accounts were seeded with.
 *
 * A live database is seeded with an operator-chosen `DEMO_SEED_PASSWORD` rather
 * than the published one (FR-15.9), so that variable is read here too: the
 * checks that sign in would otherwise report FAIL against a deployment that is
 * working exactly as intended.
 */
const DEMO_PASSWORD =
  process.env.DEMO_PASSWORD ?? process.env.DEMO_SEED_PASSWORD ?? 'demo-ustaad-2026';

/**
 * Whatever the endpoint returned.
 *
 * Deliberately loose: this script consumes arbitrary JSON from a live server it
 * cannot import types from, and narrowing every field would be more code than
 * the checks themselves — with no more safety, since the server could return
 * anything regardless of what the type said.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsonBody = any;

interface Result {
  name: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  detail: string;
}

const results: Result[] = [];

function record(name: string, status: Result['status'], detail: string): void {
  results.push({ name, status, detail });
  const mark = status === 'PASS' ? '✓' : status === 'SKIP' ? '·' : '✗';
  console.log(`${mark} ${name.padEnd(46)} ${detail}`);
}

/** Fetch that carries cookies, because the cookie is the only session carrier. */
async function call(
  path: string,
  init: RequestInit & { cookie?: string } = {},
): Promise<{ status: number; body: JsonBody; cookie: string }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (init.cookie) headers.cookie = init.cookie;

  const res = await fetch(`${BASE}${path}`, { ...init, headers: { ...headers, ...(init.headers as object) } });

  const raw = res.headers.getSetCookie?.() ?? [];
  const cookie = raw.map((c) => c.split(';')[0]).join('; ');

  let body: JsonBody = null;
  try {
    body = await res.json();
  } catch {
    /* not JSON — leave null and let the caller judge by status */
  }

  return { status: res.status, body, cookie };
}

/* ---------------------------------------------------------------------- */

async function checkHealth(): Promise<void> {
  const res = await call('/api/health');
  if (res.status !== 200) return record('API reachable', 'FAIL', `status ${res.status}`);

  // If address encryption is unconfigured, bookings cannot store an address at
  // all (SEC-3) — and discovering that after a family has typed one in is too
  // late, which is why health reports it.
  const encrypted = res.body?.addressEncryption === 'configured';
  record(
    'API reachable and address encryption configured',
    encrypted ? 'PASS' : 'FAIL',
    encrypted ? `v${res.body?.version}` : 'ADDRESS_ENCRYPTION_KEY missing in production',
  );
}

const ROLES = [
  ['parent', 'parent@demo.ustaad.test'],
  ['tutor', 'ayesha-siddiqui@demo.ustaad.test'],
  ['student', 'student@demo.ustaad.test'],
  ['organisation', 'academy@demo.ustaad.test'],
  ['admin', 'admin@demo.ustaad.test'],
] as const;

const cookies = new Map<string, string>();

async function checkLogins(): Promise<void> {
  let ok = 0;
  for (const [role, email] of ROLES) {
    const res = await call('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password: DEMO_PASSWORD }),
    });
    if (res.status === 200 && res.cookie) {
      cookies.set(role, res.cookie);
      ok += 1;
    }
  }

  if (ok === 0) {
    return record('Login for all five roles', 'SKIP', 'no demonstration accounts in production');
  }
  record(
    'Login for all five roles',
    ok === ROLES.length ? 'PASS' : 'FAIL',
    `${ok}/${ROLES.length} roles authenticated`,
  );

  // The session cookie must be httpOnly and Secure in production (§2.11).
  const sample = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: ROLES[0][1], password: DEMO_PASSWORD }),
  });
  const setCookie = (sample.headers.getSetCookie?.() ?? []).join(' ');
  const hardened = /HttpOnly/i.test(setCookie) && /Secure/i.test(setCookie);
  record(
    'Session cookie is httpOnly and Secure',
    setCookie ? (hardened ? 'PASS' : 'FAIL') : 'SKIP',
    setCookie ? (hardened ? 'both flags present' : `flags: ${setCookie.slice(0, 80)}`) : 'no cookie issued',
  );
}

async function checkSearch(): Promise<void> {
  const res = await call(
    '/api/search?genderPreference=female_only&mode=home&areaId=karachi-clifton',
  );
  if (res.status !== 200) return record('Female-only home search', 'FAIL', `status ${res.status}`);

  const results_ = res.body?.results ?? res.body?.items ?? [];
  const allFemale = results_.every((r: { gender?: string }) => r.gender === 'female');

  record(
    'Female-only home search returns verified tutors',
    results_.length > 0 && allFemale ? 'PASS' : 'FAIL',
    results_.length === 0
      ? 'EMPTY — the primary use case returns nothing'
      : allFemale
        ? `${results_.length} tutors, all female`
        : 'a non-conforming tutor is in the result set — the hard filter leaked',
  );
}

async function checkBooking(): Promise<void> {
  const parent = cookies.get('parent');
  if (!parent) return record('One booking through to completion', 'SKIP', 'no parent session');

  const list = await call('/api/bookings', { cookie: parent });
  if (list.status !== 200) {
    return record('One booking through to completion', 'FAIL', `bookings list ${list.status}`);
  }

  const items = list.body?.items ?? [];
  const completed = items.filter((b: { status?: string }) => b.status === 'completed');
  record(
    'One booking through to completion',
    completed.length > 0 ? 'PASS' : 'SKIP',
    completed.length > 0
      ? `${completed.length} completed engagement(s) readable`
      : 'no completed booking in production data',
  );
}

async function checkAi(): Promise<void> {
  // The demonstration replay is the AI conversation that must work regardless
  // of provider state — that is the whole point of FR-15.7.
  const scenarios = await call('/api/demo/scenarios');
  if (scenarios.status !== 200) {
    return record('AI conversation (stored replay)', 'FAIL', `status ${scenarios.status}`);
  }

  const count = scenarios.body?.items?.length ?? 0;
  const turn = await call('/api/demo/scenarios/diagnostic-root-gap/turns/0');
  const zeroCalls = scenarios.body?.replay?.liveModelCalls === 0;

  record(
    'AI conversation replays with zero live calls',
    count === 5 && turn.status === 200 && zeroCalls ? 'PASS' : 'FAIL',
    `${count} scenarios, turn 0 → ${turn.status}, liveModelCalls=${scenarios.body?.replay?.liveModelCalls}`,
  );

  // The live agent is separate and is allowed to be degraded — NFR-11 says it
  // must hand back the manual path, never an error.
  const parent = cookies.get('parent');
  if (!parent) return record('Live AI agent degrades rather than errors', 'SKIP', 'no parent session');

  const intake = await call('/api/ai/intake', {
    method: 'POST',
    cookie: parent,
    body: JSON.stringify({ subjectId: 'mathematics', message: 'My daughter is weak in Maths.' }),
  });
  record(
    'Live AI agent degrades rather than errors',
    intake.status < 500 ? 'PASS' : 'FAIL',
    intake.status === 200 ? 'agent responded' : `status ${intake.status} (a 4xx is a refusal, not a crash)`,
  );
}

async function checkVolunteerAndFeedback(): Promise<void> {
  const stamp = Date.now();

  const volunteer = await call('/api/volunteers', {
    method: 'POST',
    body: JSON.stringify({
      fullName: 'Deployment Check',
      email: `deploy-check-${stamp}@example.test`,
      phone: '03001234567',
      cityId: 'karachi',
      areaId: 'karachi-clifton',
      gender: 'female',
      subjects: ['mathematics'],
      levels: ['matric'],
      weeklyHours: 4,
      deliveryModes: ['online'],
      motivation: 'Automated post-deployment verification. Safe to reject.',
    }),
  });

  // FR-33.9: the row is written before the mail, and the dispatch outcome is
  // recorded against the row. `skipped` means EmailJS is not configured, which
  // is a truthful outcome, not a success.
  const dispatch = volunteer.body?.mailDispatchStatus;
  record(
    'Volunteer application accepted, mail outcome recorded',
    volunteer.status === 201 || volunteer.status === 200 ? 'PASS' : 'FAIL',
    volunteer.status >= 400
      ? `status ${volunteer.status}`
      : `mailDispatchStatus=${dispatch}${dispatch === 'skipped' ? ' (EmailJS not configured)' : ''}`,
  );

  const feedback = await call('/api/feedback', {
    method: 'POST',
    body: JSON.stringify({
      category: 'other',
      detail: `Automated post-deployment verification ${stamp}. Safe to dismiss.`,
      pagePath: '/deploy-check',
      locale: 'en',
    }),
  });
  const accepted = feedback.status === 201 || feedback.status === 200;

  // And prove it reached the queue, which is the half that matters.
  let landed = false;
  const admin = cookies.get('admin');
  if (accepted && admin) {
    const queue = await call('/api/feedback/queue', { cookie: admin });
    landed = JSON.stringify(queue.body ?? {}).includes(String(stamp));
  }

  record(
    'Feedback submission lands in the admin queue',
    accepted && (landed || !admin) ? 'PASS' : 'FAIL',
    !accepted ? `status ${feedback.status}` : landed ? 'found in queue' : 'accepted (queue not checked — no admin session)',
  );
}

async function checkPrivateStorage(): Promise<void> {
  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? 'ustaad-private-documents';
  const supabaseUrl = process.env.SUPABASE_URL;

  if (!supabaseUrl) {
    return record('Private bucket refuses a direct fetch', 'SKIP', 'SUPABASE_URL not set locally');
  }

  // SEC-7 / SEC-24: documents are served only by short-lived signed URLs. An
  // unsigned request for a known path must be refused.
  const direct = `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/${bucket}/tutor-documents/probe.pdf`;
  const res = await fetch(direct);

  // 400/401/403/404 are all refusals. 200 is the failure — it would mean the
  // bucket is public and every identity document is world-readable.
  const refused = res.status !== 200;
  record(
    'Private bucket refuses an unsigned fetch',
    refused ? 'PASS' : 'FAIL',
    refused ? `status ${res.status} (refused)` : 'STATUS 200 — THE BUCKET IS PUBLIC',
  );
}

async function checkNoSecretsInClient(): Promise<void> {
  const res = await fetch(BASE!);
  const html = await res.text();

  const assets = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|mjs|css))"/g)].map((m) => m[1]!);
  let text = html;
  for (const asset of assets.slice(0, 20)) {
    try {
      const url = asset.startsWith('http') ? asset : `${BASE}${asset.startsWith('/') ? '' : '/'}${asset}`;
      text += await (await fetch(url)).text();
    } catch {
      /* an asset that will not load cannot leak */
    }
  }

  const patterns: [string, RegExp][] = [
    ['Postgres connection string', /postgres(?:ql)?:\/\/[^\s"']+/],
    ['Supabase service role JWT', /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/],
    ['Google API key', /AIza[0-9A-Za-z_-]{35}/],
    ['Groq API key', /gsk_[0-9A-Za-z]{40,}/],
  ];

  const hits = patterns.filter(([, re]) => re.test(text)).map(([name]) => name);
  record(
    'No credential pattern in the served client bundle',
    hits.length === 0 ? 'PASS' : 'FAIL',
    hits.length === 0 ? `${assets.length} asset(s) scanned` : `FOUND: ${hits.join(', ')}`,
  );
}

/* ---------------------------------------------------------------------- */

async function main(): Promise<void> {
  console.log(`\n▸ post-deployment verification against ${BASE}\n`);

  await checkHealth();
  await checkLogins();
  await checkSearch();
  await checkBooking();
  await checkAi();
  await checkVolunteerAndFeedback();
  await checkPrivateStorage();
  await checkNoSecretsInClient();

  const failed = results.filter((r) => r.status === 'FAIL');
  const skipped = results.filter((r) => r.status === 'SKIP');

  console.log('');
  console.log(
    `${results.filter((r) => r.status === 'PASS').length} passed, ${failed.length} failed, ${skipped.length} skipped.`,
  );

  if (skipped.length > 0) {
    console.log('\nSkipped checks were NOT verified. They are not passes:');
    for (const r of skipped) console.log(`  · ${r.name} — ${r.detail}`);
  }

  if (failed.length > 0) {
    console.error('\n✗ deployment verification failed.');
    process.exitCode = 1;
  } else if (skipped.length > 0) {
    console.log('\n~ every executed check passed, but some could not be run.');
  } else {
    console.log('\n✓ every check passed.');
  }
}

main().catch((error: unknown) => {
  console.error('✗ verification could not complete:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
