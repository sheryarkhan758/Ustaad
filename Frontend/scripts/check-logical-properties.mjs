/**
 * Fail the build on a physical direction property.
 *
 *     npm run check:logical
 *
 * ── Why a script and not only an ESLint rule ───────────────────────────────
 * The offending strings live inside `className` template literals and arrays,
 * where an AST rule sees an opaque expression rather than a class name. A text
 * scan catches every form, including the `[dir=rtl]:` escape hatches somebody
 * will otherwise reach for at 2 a.m.
 *
 * ── The rule ──────────────────────────────────────────────────────────────
 * Use `ms-*`, `me-*`, `ps-*`, `pe-*`, `start-*`, `end-*`, `text-start`,
 * `text-end`, `border-s`, `border-e`, `rounded-s-*`, `rounded-e-*`.
 *
 * Never `ml-*`, `mr-*`, `pl-*`, `pr-*`, `left-*`, `right-*`, `text-left`,
 * `text-right`, `border-l`, `border-r`, `rounded-l-*`, `rounded-r-*`.
 *
 * Half this interface renders right-to-left. A physical property is a decision
 * that the layout is correct in one language and wrong in the other, made
 * silently — and it will not be noticed until somebody opens the Urdu view of a
 * screen written months earlier. Retrofitting that costs roughly double, which
 * is why this check exists before the feature screens do.
 *
 * ── The escape hatch, and its price ────────────────────────────────────────
 * A line carrying a `physical-ok:` block comment is allowed through. There is
 * exactly one legitimate category — a CSS property with no logical equivalent,
 * such as `background-position` — and the reason is written down where the next
 * person reads it.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOTS = ['src'];
const EXTENSIONS = /\.(jsx?|css)$/;

/** Each rule: what it matches, and what to use instead. */
const RULES = [
  [/(?<![\w-])(ml|mr)-(?=[\w[])/g, 'ms-* / me-*'],
  [/(?<![\w-])(pl|pr)-(?=[\w[])/g, 'ps-* / pe-*'],
  [/(?<![\w-])text-(left|right)(?![\w-])/g, 'text-start / text-end'],
  /**
   * Inset utilities.
   *
   * Deliberately narrower than the others: it matches only what Tailwind
   * actually accepts as a value — a number, a fraction, `auto`, `full`, `px`,
   * or an arbitrary `[…]`. The obvious `(left|right)-\w` flagged the phrases
   * "left-to-right" and "right-hand" in prose, and a check that fires on the
   * documentation explaining it is a check people switch off.
   */
  [/(?<![\w-])(left|right)-(?=(?:\d|auto\b|full\b|px\b|\[))/g, 'start-* / end-*'],
  [/(?<![\w-])border-(l|r)(?![\w-])/g, 'border-s / border-e'],
  [/(?<![\w-])rounded-(l|r|tl|tr|bl|br)-(?=[\w[])/g, 'rounded-s-* / rounded-e-*'],
  [/(?<![\w-])(float|clear)-(left|right)(?![\w-])/g, 'float-start / float-end'],
  // CSS files: the properties themselves.
  [/(?<![\w-])(margin|padding)-(left|right)\s*:/g, 'margin-inline-start / -end'],
  [/(?<![\w-])(border-(left|right))\s*:/g, 'border-inline-start / -end'],
];

const ALLOW = /\/\*\s*physical-ok:/;

/**
 * Blank out comments while preserving line numbers.
 *
 * Without this the check flags its own documentation: a comment explaining
 * *why* `border-l` is wrong contains the string `border-l`. A rule that fires
 * on the prose explaining it is a rule people delete.
 */
function stripComments(source) {
  const blank = (text) => text.replace(/[^\n]/g, ' ');

  return (
    source
      // Block comments. Each character becomes a space except newlines, so
      // every subsequent line keeps its original number.
      .replace(/\/\*[\s\S]*?\*\//g, blank)
      // Line comments — but not the `//` inside a `url(https://…)`.
      .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (match, lead) => lead + blank(match.slice(lead.length)))
  );
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return EXTENSIONS.test(entry.name) ? [full] : [];
  });
}

const findings = [];
let scanned = 0;

for (const root of ROOTS) {
  for (const file of walk(root)) {
    scanned += 1;
    const raw = fs.readFileSync(file, 'utf8');
    const rawLines = raw.split('\n');
    // Scanned with comments blanked, reported against the original text.
    const lines = stripComments(raw).split('\n');

    lines.forEach((line, index) => {
      // An explicit, reasoned exemption on the original line.
      if (ALLOW.test(rawLines[index] ?? '')) return;

      for (const [pattern, replacement] of RULES) {
        pattern.lastIndex = 0;
        const match = pattern.exec(line);
        if (match) {
          findings.push({
            file,
            line: index + 1,
            found: match[0].replace(/\s*:$/, ''),
            use: replacement,
            source: (rawLines[index] ?? '').trim().slice(0, 100),
          });
          break; // one finding per line is enough to fix it
        }
      }
    });
  }
}

if (findings.length === 0) {
  console.log(`✓ ${scanned} files use logical properties only.`);
  process.exit(0);
}

console.error(`\n✗ ${findings.length} physical direction propert${findings.length === 1 ? 'y' : 'ies'} found.\n`);
console.error('  Half this interface renders right-to-left. A physical property is correct in');
console.error('  one language and silently wrong in the other.\n');

for (const finding of findings) {
  console.error(`  ${finding.file}:${finding.line}`);
  console.error(`    found "${finding.found}" — use ${finding.use}`);
  console.error(`    ${finding.source}\n`);
}

console.error('  If a property genuinely has no logical equivalent, end the line with:');
console.error('    /* physical-ok: <the reason> */\n');

process.exit(1);
