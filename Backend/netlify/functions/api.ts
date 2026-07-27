/**
 * The Express application, wrapped as a single Netlify Function — §10.2, §12.
 *
 * Every `/api/*` request the client makes is redirected here by `netlify.toml`
 * and handed to the same `createApp` the local server and the integration suite
 * use. There is exactly one handler rather than one per route, because the
 * routing already exists inside Express and duplicating it in `netlify.toml`
 * would be a second route table to keep in step with the first.
 *
 * ── Cold-start discipline ──────────────────────────────────────────────────
 * A serverless function is constructed on a cold start and then reused for as
 * many invocations as the platform decides. So **nothing expensive or
 * stateful happens at module scope**, and in particular:
 *
 *  · **No migration.** `db:migrate` is a deployment step run once by a person
 *    against a known database. A function that migrated on boot would race
 *    itself the moment two cold starts overlapped, and there is no lock to
 *    arbitrate that.
 *  · **No seeding.** `db:seed` is idempotent; `db:seed:demo` writes invented
 *    people and, against a live database, demands a password the operator
 *    chose. Neither belongs in a request path.
 *  · **No job scheduling.** `server/jobs/` are the only writers of the
 *    materialised tables (§2.8). A `setInterval` here would run once per warm
 *    container — that is N uncoordinated writers, not one scheduled job. They
 *    run from a Netlify scheduled function or a cron, deliberately elsewhere.
 *
 * What *does* happen at module scope is the two things that must: importing
 * `db`, which opens the postgres-js pool, and building the Express app. Both
 * are then reused across every invocation the container serves, which is the
 * whole point of doing them once.
 *
 * ── On the connection pool ─────────────────────────────────────────────────
 * `server/db/index.ts` opens postgres-js with `prepare: false` and a small
 * `max`. Both matter here: Supabase's transaction-mode pooler does not hold a
 * session across statements, so prepared statements break, and a serverless
 * platform opens containers unpredictably — a large per-container pool
 * multiplied by the number of warm containers is how a free-tier database runs
 * out of connections.
 */

import serverless from 'serverless-http';

import { createApp } from '../../server/app';
import { db } from '../../server/db/index';

/**
 * Built once per container, reused for every invocation it serves.
 *
 * `createApp` takes the database handle as a parameter rather than importing
 * it, which is what lets the integration suite mount this same application
 * over an in-memory database. Production passes the real one.
 */
const app = createApp(db);

/**
 * `basePath` strips the function mount point before Express sees the URL.
 *
 * Netlify invokes this at `/.netlify/functions/api/...`, but every route in
 * `server/app.ts` is declared under `/api/...`. Without this the router would
 * see the wrapper's path and 404 everything. The redirect in `netlify.toml`
 * means callers only ever use `/api/*`; this handles the direct form as well,
 * so the function is reachable for debugging without the redirect in play.
 */
export const handler = serverless(app, {
  basePath: '/.netlify/functions/api',
  // Cookies are the only session carrier (§2.11), so they must survive the
  // Lambda-shaped request and response translation intact.
  request: (request: { headers?: Record<string, string> }) => {
    // Netlify terminates TLS at the edge, so Express sees http. `secure`
    // cookies would be dropped without this, and `trust proxy` is already set
    // in the app factory.
    if (request.headers) request.headers['x-forwarded-proto'] ??= 'https';
  },
});
