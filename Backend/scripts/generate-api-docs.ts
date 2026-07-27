/**
 * Generate `docs/API.md` — §14.6.
 *
 *     npm run docs:api
 *     npm run docs:api -- --check     # fail if the committed file is stale
 *
 * ── Why this is generated rather than written ──────────────────────────────
 * Hand-written API documentation is wrong within a fortnight. Every request
 * shape in this project is already a Zod schema in `/shared`, used on both
 * sides of the wire (§4), so the schemas are the only description of the API
 * that cannot drift from it — they *are* it. This walks them.
 *
 * ── What is derived and what is declared ───────────────────────────────────
 * **Derived from code:** every request body and query shape, field by field,
 * with types, optionality, bounds and enum members read out of the Zod schema
 * at runtime. Change `min(15)` to `min(20)` on a resolution reason and this
 * file says 20 the next time it runs.
 *
 * **Declared in the table below:** method, path, auth requirement and a
 * one-line purpose. Express does not expose a typed route table, and parsing
 * the routers with a regular expression to recover paths would be a second
 * source of truth that fails silently. So the route list is written down, and
 * `--check` fails the build when it drifts from the mounted application —
 * every route the app serves must appear here, and every route here must exist.
 *
 * Response shapes are described rather than generated: handlers build them
 * inline and there is no response schema to read. That is a real limitation and
 * it is stated in the output rather than papered over.
 */

import fs from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import * as moderationSchemas from '../shared/moderation';

/* =========================================================================
 * Zod introspection
 * ====================================================================== */

interface FieldDoc {
  name: string;
  type: string;
  required: boolean;
  notes: string[];
}

/** Unwrap the wrappers that change cardinality but not shape. */
function unwrap(schema: z.ZodTypeAny): { inner: z.ZodTypeAny; optional: boolean; notes: string[] } {
  let inner = schema;
  let optional = false;
  const notes: string[] = [];

  // Bounded rather than `while (true)`: a self-referential schema would
  // otherwise hang the build, and a documentation script must never do that.
  for (let depth = 0; depth < 12; depth += 1) {
    const def = inner._def as { typeName?: string; innerType?: z.ZodTypeAny; defaultValue?: unknown };

    if (def.typeName === 'ZodOptional' || def.typeName === 'ZodNullable') {
      optional = true;
      if (def.typeName === 'ZodNullable') notes.push('nullable');
      inner = def.innerType!;
      continue;
    }
    if (def.typeName === 'ZodDefault') {
      optional = true;
      const value = typeof def.defaultValue === 'function' ? (def.defaultValue as () => unknown)() : undefined;
      if (value !== undefined && typeof value !== 'object') notes.push(`default \`${String(value)}\``);
      inner = def.innerType!;
      continue;
    }
    if (def.typeName === 'ZodEffects' || def.typeName === 'ZodBranded' || def.typeName === 'ZodReadonly') {
      inner = (inner._def as { schema?: z.ZodTypeAny; type?: z.ZodTypeAny }).schema
        ?? (inner._def as { type?: z.ZodTypeAny }).type
        ?? inner;
      continue;
    }
    break;
  }

  return { inner, optional, notes };
}

function describeType(schema: z.ZodTypeAny, depth = 0): { type: string; notes: string[] } {
  const { inner, notes } = unwrap(schema);
  const def = inner._def as Record<string, unknown>;
  const typeName = def.typeName as string | undefined;

  switch (typeName) {
    case 'ZodString': {
      const checks = (def.checks ?? []) as { kind: string; value?: number }[];
      for (const check of checks) {
        if (check.kind === 'min') notes.push(`min length ${check.value}`);
        if (check.kind === 'max') notes.push(`max length ${check.value}`);
        if (check.kind === 'email') notes.push('email');
        if (check.kind === 'url') notes.push('URL');
        if (check.kind === 'uuid') notes.push('UUID');
      }
      return { type: 'string', notes };
    }
    case 'ZodNumber': {
      const checks = (def.checks ?? []) as { kind: string; value?: number }[];
      let type = 'number';
      for (const check of checks) {
        if (check.kind === 'int') type = 'integer';
        if (check.kind === 'min') notes.push(`min ${check.value}`);
        if (check.kind === 'max') notes.push(`max ${check.value}`);
      }
      return { type, notes };
    }
    case 'ZodBoolean':
      return { type: 'boolean', notes };
    case 'ZodEnum': {
      const values = (def.values ?? []) as string[];
      return { type: values.map((v) => `\`${v}\``).join(' \\| '), notes };
    }
    case 'ZodLiteral':
      return { type: `\`${String(def.value)}\``, notes };
    case 'ZodArray': {
      if (depth > 3) return { type: 'array', notes };
      const element = describeType(def.type as z.ZodTypeAny, depth + 1);
      const checks = def as { minLength?: { value: number }; maxLength?: { value: number } };
      if (checks.minLength) notes.push(`min ${checks.minLength.value} items`);
      if (checks.maxLength) notes.push(`max ${checks.maxLength.value} items`);
      return { type: `${element.type}[]`, notes: [...notes, ...element.notes] };
    }
    case 'ZodObject': {
      if (depth > 2) return { type: 'object', notes };
      const shape = (inner as z.ZodObject<z.ZodRawShape>).shape;
      const keys = Object.keys(shape);
      return { type: `object { ${keys.join(', ')} }`, notes };
    }
    case 'ZodRecord':
      return { type: 'object (map)', notes };
    case 'ZodUnion': {
      const options = (def.options ?? []) as z.ZodTypeAny[];
      return { type: options.map((o) => describeType(o, depth + 1).type).join(' \\| '), notes };
    }
    case 'ZodPipeline': {
      // `z.coerce.number()` and friends. The output side is what the handler
      // sees, so that is what the caller needs to know about.
      const out = (def.out ?? def.in) as z.ZodTypeAny | undefined;
      if (!out || depth > 3) return { type: 'string (coerced)', notes };
      const described = describeType(out, depth + 1);
      return { type: described.type, notes: [...notes, ...described.notes, 'coerced from string'] };
    }
    case 'ZodAny':
    case 'ZodUnknown':
      return { type: 'any', notes };
    default:
      return { type: typeName?.replace(/^Zod/, '').toLowerCase() ?? 'unknown', notes };
  }
}

function documentSchema(schema: z.ZodTypeAny): FieldDoc[] {
  const { inner } = unwrap(schema);
  if ((inner._def as { typeName?: string }).typeName !== 'ZodObject') return [];

  const shape = (inner as z.ZodObject<z.ZodRawShape>).shape;
  return Object.entries(shape).map(([name, field]) => {
    const { optional, notes: wrapNotes } = unwrap(field as z.ZodTypeAny);
    const { type, notes } = describeType(field as z.ZodTypeAny);
    return {
      name,
      type,
      required: !optional,
      notes: [...new Set([...wrapNotes, ...notes])],
    };
  });
}

/* =========================================================================
 * The route table
 * ====================================================================== */

import { SECTIONS, type RouteDoc } from './api-routes';

/* =========================================================================
 * Rendering
 * ====================================================================== */

function renderFields(fields: FieldDoc[]): string {
  if (fields.length === 0) return '_No fields — the empty object is the request._\n';

  const lines = ['| Field | Type | Required | Constraints |', '|---|---|---|---|'];
  for (const field of fields) {
    lines.push(
      `| \`${field.name}\` | ${field.type} | ${field.required ? 'yes' : 'no'} | ${field.notes.join(', ') || '—'} |`,
    );
  }
  return `${lines.join('\n')}\n`;
}

function renderRoute(route: RouteDoc): string {
  const parts: string[] = [];
  parts.push(`#### \`${route.method} ${route.path}\`\n`);
  parts.push(`${route.purpose}\n`);
  parts.push(`**Auth:** ${route.auth}\n`);

  if (route.schema && route.schemaName) {
    const where = route.schemaIn === 'query' ? 'Query' : 'Request body';
    parts.push(`**${where}** — \`${route.schemaName}\`, generated from the Zod schema:\n`);
    parts.push(renderFields(documentSchema(route.schema)));
  }

  parts.push(`**Response:** ${route.response}\n`);

  const errors = ['400 `validation_failed` where a body or query is validated', ...(route.errors ?? [])];
  const unique = [...new Set(route.errors ?? [])];
  parts.push(`**Errors:** ${(unique.length ? unique : [errors[0]!]).join(', ')}\n`);

  if (route.note) parts.push(`> ${route.note}\n`);

  return parts.join('\n');
}

function render(): string {
  const totalRoutes = SECTIONS.reduce((n, section) => n + section.routes.length, 0);

  const out: string[] = [];
  out.push('# API Reference\n');
  out.push(
    '> **Generated file — do not edit by hand.** Produced by `scripts/generate-api-docs.ts`.\n' +
      '> Regenerate with `npm run docs:api`; `npm run docs:api -- --check` fails if it is stale.\n',
  );
  out.push(
    'Every request shape below is read out of the Zod schema in `/shared` that validates it, ' +
      'field by field, at generation time — types, optionality, bounds and enum members included. ' +
      'Those schemas are used on both sides of the wire, so they cannot drift from the API they describe.\n',
  );
  out.push(
    '**Response shapes are described rather than generated.** Handlers build them inline and there is ' +
      'no response schema to introspect, so those columns are maintained by hand and may lag. ' +
      'Request shapes, error codes and auth requirements are the parts to trust.\n',
  );

  out.push('## Conventions\n');
  out.push(
    '**Authentication.** A short-lived JWT access token (15 min) in an httpOnly, `sameSite=lax`, ' +
      '`secure`-in-production cookie, plus a rotating opaque refresh token (7 days) scoped to `/api/auth`. ' +
      '**The cookie is the only accepted carrier** — there is deliberately no `Authorization` header path, ' +
      'and no token appears in a URL, a log line or `localStorage` (§2.11). Revocation takes effect within ' +
      'one access-token lifetime; that bound is stated rather than hidden.\n',
  );
  out.push(
    '**Errors.** Every failure is `{ "error": { "code", "message" } }`. `message` is written for a person ' +
      'and is safe to display. Unexpected failures return a bare `500 internal_error` and never echo the ' +
      'submitted payload — an error can carry a query fragment, a file path or a value from a row, and none ' +
      'of those belong in a response.\n',
  );
  out.push(
    '**Ownership.** A resource that does not exist and one belonging to somebody else both return **404**, ' +
      'never 403. Returning different codes would turn the endpoint into an existence oracle: a parent could ' +
      "enumerate other families' booking ids by watching which status came back.\n",
  );
  out.push(
    '**Money is integer paisa.** 1 PKR = 100 paisa, everywhere, with no exceptions — never a float, never a ' +
      'decimal string (§2.1). `2_500_000` is PKR 25,000.\n',
  );
  out.push(
    '**Text is stored unchanged.** User-generated text may be Urdu script, Roman Urdu, English or a mix ' +
      'within one sentence. It is stored byte for byte and **never machine-translated** (§2.10). No endpoint ' +
      'validates user text against a Latin-only character class.\n',
  );
  out.push(
    '**Rate limiting.** A general limiter applies to every route; the authentication and public-form routes ' +
      'carry tighter ones. Exceeding it returns `429 rate_limited`.\n',
  );

  out.push('## Contents\n');
  for (const section of SECTIONS) {
    const anchor = section.title.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/ /g, '-');
    out.push(`- [${section.title}](#${anchor}) — ${section.spec}, ${section.routes.length} routes`);
  }
  out.push('');

  for (const section of SECTIONS) {
    out.push(`## ${section.title}\n`);
    out.push(`*Specification ${section.spec}.*\n`);
    out.push(`${section.blurb}\n`);
    for (const route of section.routes) out.push(renderRoute(route));
  }

  /* The dashboard contract is a response shape that *does* have a schema. */
  out.push('## Appendix — the administrator dashboard contract\n');
  out.push(
    'Unusually, this response has a Zod schema (`adminDashboardCountsSchema`), so it is generated like a ' +
      'request shape. FR-14.3 names each count.\n',
  );
  out.push(renderFields(documentSchema(moderationSchemas.adminDashboardCountsSchema)));

  out.push('---\n');
  out.push(
    `${totalRoutes} routes across ${SECTIONS.length} sections. Generated by \`npm run docs:api\` from the ` +
      'Zod schemas in `/shared` and the route table in `scripts/generate-api-docs.ts`.\n',
  );

  return out.join('\n');
}

/* =========================================================================
 * CLI
 * ====================================================================== */

const OUTPUT = path.resolve('docs/API.md');

/* -------------------------------------------------------------------------
 * Drift check against the mounted application
 * ---------------------------------------------------------------------- */

interface MountedRoute {
  method: string;
  path: string;
}

/**
 * Walk the Express router tree of the real application.
 *
 * This is what keeps the hand-written route table above honest. Express offers
 * no typed route table, so the alternative to walking its internals is trusting
 * a list nobody updates — and undocumented endpoints are how a client ends up
 * calling something that was renamed a month ago.
 *
 * It reads private structure (`_router`, `regexp`) and could break on an Express
 * upgrade. That is an acceptable trade for a check that fails loudly: if the
 * shape changes, this throws and gets fixed, rather than quietly passing.
 */
function listMountedRoutes(app: unknown): MountedRoute[] {
  const found: MountedRoute[] = [];

  const layerPath = (layer: { regexp?: RegExp; path?: string }): string => {
    if (layer.path) return layer.path;
    const source = layer.regexp?.source ?? '';
    // Express compiles `/api/auth` to `^\/api\/auth\/?(?=\/|$)`.
    const match = /^\^\\\/(.*?)\\\/\?/.exec(source);
    if (!match) return '';
    return `/${match[1]!.replace(/\\\//g, '/')}`;
  };

  const walk = (stack: unknown[], prefix: string): void => {
    for (const entry of stack) {
      const layer = entry as {
        route?: { path: string; methods: Record<string, boolean> };
        name?: string;
        handle?: { stack?: unknown[] };
        regexp?: RegExp;
        path?: string;
      };

      if (layer.route) {
        for (const [method, on] of Object.entries(layer.route.methods)) {
          if (!on || method === '_all') continue;
          const full = `${prefix}${layer.route.path}`.replace(/\/$/, '') || '/';
          found.push({ method: method.toUpperCase(), path: full });
        }
        continue;
      }

      if (layer.name === 'router' && layer.handle?.stack) {
        walk(layer.handle.stack, `${prefix}${layerPath(layer)}`);
      }
    }
  };

  const router = (app as { _router?: { stack?: unknown[] }; router?: { stack?: unknown[] } });
  const stack = router._router?.stack ?? router.router?.stack;
  if (!stack) throw new Error('could not read the Express router stack — has Express changed shape?');
  walk(stack, '');
  return found;
}

/** `:id` and `:tutorId` are the same shape for comparison purposes. */
function normalisePath(p: string): string {
  return p.replace(/:[A-Za-z0-9_]+/g, ':param').replace(/\/$/, '') || '/';
}

async function checkRouteDrift(): Promise<string[]> {
  const problems: string[] = [];

  // Imported lazily: generating the documentation must not require a database
  // handle, and `createApp` takes one.
  const { createApp } = await import('../server/app');
  const app = createApp({} as never);

  const mounted = new Set(
    listMountedRoutes(app)
      // The catch-all 404 handler and the dev-only upload router are not API.
      .filter((r) => !r.path.startsWith('/api/uploads'))
      .map((r) => `${r.method} ${normalisePath(r.path)}`),
  );

  const documented = new Set(
    SECTIONS.flatMap((section) =>
      section.routes.map((route) => `${route.method} ${normalisePath(route.path)}`),
    ),
  );

  for (const route of mounted) {
    if (!documented.has(route)) problems.push(`undocumented endpoint: ${route}`);
  }
  for (const route of documented) {
    if (!mounted.has(route)) problems.push(`documented but not mounted: ${route}`);
  }

  return problems.sort();
}

async function main(): Promise<void> {
  const content = render();
  const check = process.argv.includes('--check');

  if (check) {
    let failed = false;

    const existing = fs.existsSync(OUTPUT) ? fs.readFileSync(OUTPUT, 'utf8') : '';
    if (existing.trim() !== content.trim()) {
      console.error('✗ docs/API.md is stale. Run `npm run docs:api`.');
      failed = true;
    }

    const drift = await checkRouteDrift();
    if (drift.length > 0) {
      console.error('✗ the route table and the mounted application disagree:');
      for (const problem of drift) console.error(`    ${problem}`);
      failed = true;
    }

    if (failed) {
      process.exitCode = 1;
      return;
    }
    console.log('✓ docs/API.md is up to date and matches every mounted route');
    return;
  }

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, content, 'utf8');

  const routes = SECTIONS.reduce((n, section) => n + section.routes.length, 0);
  console.log(`✓ wrote docs/API.md — ${routes} routes across ${SECTIONS.length} sections`);
}

void main();

export { documentSchema };
