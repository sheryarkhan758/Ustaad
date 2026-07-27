/**
 * The Verification Record — the signature element of this product.
 *
 * ── Why this is not a badge ────────────────────────────────────────────────
 * A tick beside a name says "trust this person" and takes responsibility for
 * nothing. This platform's actual claim is narrower and far more useful: *an
 * administrator looked at these specific documents, on this date, and here is
 * who they were.* That is a record, and it should look like one — squarer
 * corners than the rest of the interface, tabular figures, an itemised list,
 * and a seal.
 *
 * Five things make it an institutional artefact rather than a decorated badge:
 *
 *  1. **Itemised.** One row per artefact — CNIC, degree, transcript — each
 *     carrying its own date. The backend stores exactly this list (FR-6.5) and
 *     the badge is generated from it, so the card can never claim more than an
 *     administrator actually checked.
 *  2. **Attributed.** The approving administrator is named. A decision nobody
 *     is accountable for is not a decision (FR-6.6).
 *  3. **It states what was NOT done.** `NOT_CHECKED` below is printed on the
 *     card itself, not hidden in a footnote. This is the part that matters: a
 *     parent deciding who enters their home needs to know the platform did not
 *     run a police check, and a product that only advertises its strengths has
 *     told them the less useful half. SEC-6 and FR-6.8 require it; the design
 *     treats it as the most trustworthy thing on the card rather than a
 *     liability to bury.
 *  4. **Two tracks, never merged.** Identity is a person checking documents;
 *     competency is a per-topic assessment that expires at twelve months. They
 *     are displayed as separate records because merging them into one score
 *     would let a strong assessment paper over a weak identity check (FR-6.2).
 *  5. **The seal.** `seal` ochre appears here and in no other component in the
 *     product. Scarcity is what makes it read as a stamp.
 *
 * ── The forbidden vocabulary ───────────────────────────────────────────────
 * `Trusted`, `Safe`, `Vetted`, `Background checked`, `Police verified`,
 * `Screened`, `Certified safe` are prohibited **anywhere in the product**
 * (§2.5, SEC-6) — including here, including in an alt text, including in a
 * tooltip. `assertPermittedBadgeText` fails loudly in development if one
 * appears, because the backend guards its own generated strings and this is the
 * matching guard on the surface that renders them.
 */

import { Badge } from '../ui/Card';

/**
 * Printed on every identity record. Not a disclaimer — the point.
 */
const NOT_CHECKED = 'No police or background check is performed.';

/** §2.5. Never rendered; only ever tested for. */
const PROHIBITED = [
  'trusted',
  'safe',
  'vetted',
  'background check',
  'police verified',
  'screened',
  'certified safe',
];

/**
 * Fails in development if copy drifts into a claim the platform cannot make.
 *
 * A silent no-op in production: a thrown error on a live profile would be a
 * worse outcome than the wrong word, and the backend's `shared/badges.ts`
 * already guards what it generates.
 */
function assertPermittedBadgeText(text) {
  if (!import.meta.env?.DEV || !text) return;
  const lower = String(text).toLowerCase();
  const hit = PROHIBITED.find(
    (word) => lower.includes(word) && !lower.includes(`no ${word}`) && !lower.includes(`not ${word}`),
  );
  if (hit) {
    throw new Error(
      `Verification copy contains the prohibited word "${hit}": "${text}". ` +
        'Badge wording must state the artefact checked and never imply a check that was not performed (SEC-6, FR-6.8).',
    );
  }
}

const ARTEFACT_LABELS = {
  cnic: 'CNIC (national identity card)',
  degree: 'Academic degree certificate',
  transcript: 'Academic transcript',
};

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  // Western-Arabic numerals in both language views (FR-27.6): an amount or a
  // date that changes numeral system between views is a date somebody misreads.
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

/** The wax seal. The only place `seal` colour appears in the product. */
function Seal({ label }) {
  return (
    <div
      className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2 border-seal/50 bg-seal-soft"
      role="img"
      aria-label={label}
    >
      <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden="true">
        <circle cx="16" cy="16" r="13" fill="none" stroke="#A8763E" strokeWidth="1" opacity="0.55" />
        <circle cx="16" cy="16" r="10" fill="none" stroke="#A8763E" strokeWidth="0.75" opacity="0.4" />
        <path
          d="M11 16.5l3.4 3.4L21 13"
          fill="none"
          stroke="#7A5429"
          strokeWidth="2.25"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

/**
 * The identity record — §6.6.
 *
 * @param {object} props
 * @param {{artefact: string, checkedOn: string}[]} props.artefacts What was checked, itemised
 * @param {string} props.decidedBy Administrator display name or id (FR-6.6)
 * @param {string} props.decidedAt ISO timestamp
 */
export function IdentityRecord({ artefacts = [], decidedBy, decidedAt, className = '' }) {
  const heading = 'CNIC verified by Ustaad.com';
  assertPermittedBadgeText(heading);

  return (
    <section
      aria-labelledby="identity-record-heading"
      className={[
        // Squarer than every other surface. It is a document, not a card.
        'rounded-record border border-seal/35 bg-white',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <header className="flex items-start gap-4 border-b border-slate-line p-4">
        <Seal label="Verification seal" />
        <div className="min-w-0 flex-1">
          <p className="text-caption font-semibold uppercase tracking-wide text-seal-deep">
            Verification record
          </p>
          <h3 id="identity-record-heading" className="mt-0.5 font-display text-subtitle text-ink">
            {heading}
          </h3>
          <p className="mt-1 text-caption text-slate">
            Identity track · checked by an administrator
          </p>
        </div>
      </header>

      {/* Itemised. One row per artefact, each with its own date. */}
      <dl className="divide-y divide-slate-line">
        {artefacts.length === 0 ? (
          <p className="p-4 text-small text-slate">No artefacts recorded.</p>
        ) : (
          artefacts.map((item) => (
            <div key={item.artefact} className="flex items-baseline justify-between gap-4 px-4 py-3">
              <dt className="text-small text-ink">
                {ARTEFACT_LABELS[item.artefact] ?? item.artefact}
              </dt>
              <dd className="shrink-0 font-mono text-caption tnum text-slate">
                {formatDate(item.checkedOn ?? decidedAt)}
              </dd>
            </div>
          ))
        )}
      </dl>

      <footer className="space-y-2 border-t border-slate-line bg-paper px-4 py-3">
        <p className="text-caption text-slate">
          Approved by <span className="font-medium text-ink">{decidedBy ?? 'an administrator'}</span>{' '}
          on <span className="font-mono tnum">{formatDate(decidedAt)}</span>
        </p>
        {/*
          The limit of the claim, stated on the artefact itself. Deliberately
          the same size as the attribution above it — not smaller, not greyer.
        */}
        <p className="border-t border-slate-line/70 pt-2 text-caption font-medium text-ink">
          {NOT_CHECKED}
        </p>
      </footer>
    </section>
  );
}

/**
 * The competency record — §6.11, §6.28.
 *
 * Separate from identity, and never merged with it (FR-6.2). A competency badge
 * lapses at twelve months, which is why the expiry is stated rather than
 * implied: an expired assessment leaves a tutor searchable and unbadged, and a
 * parent should be able to see which of the two happened.
 */
export function CompetencyRecord({ topic, outcome = 'passed', assessedAt, expiresOn, className = '' }) {
  const passed = outcome === 'passed';
  const heading = passed ? `Passed assessment: ${topic}` : `Assessment not passed: ${topic}`;
  assertPermittedBadgeText(heading);

  const expired = expiresOn ? new Date(expiresOn) < new Date() : false;

  return (
    <section
      aria-labelledby={`competency-${topic}`}
      className={['rounded-record border border-slate-line bg-white', className]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="flex items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="text-caption font-semibold uppercase tracking-wide text-slate">
            Competency track · assessed per topic
          </p>
          <h3 id={`competency-${topic}`} className="mt-0.5 font-display text-subtitle text-ink">
            {heading}
          </h3>
        </div>
        <Badge tone={expired ? 'warning' : passed ? 'info' : 'neutral'}>
          {expired ? 'Lapsed' : passed ? 'Current' : 'Not passed'}
        </Badge>
      </div>

      <dl className="divide-y divide-slate-line border-t border-slate-line">
        <div className="flex items-baseline justify-between gap-4 px-4 py-2.5">
          <dt className="text-small text-slate">Assessed</dt>
          <dd className="font-mono text-caption tnum text-ink">{formatDate(assessedAt)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4 px-4 py-2.5">
          <dt className="text-small text-slate">{expired ? 'Lapsed on' : 'Valid until'}</dt>
          <dd className="font-mono text-caption tnum text-ink">{formatDate(expiresOn)}</dd>
        </div>
      </dl>

      {expired ? (
        <p className="border-t border-slate-line bg-paper px-4 py-3 text-caption text-slate">
          This assessment has lapsed. The tutor remains listed; the badge is withheld until it is
          re-sat.
        </p>
      ) : null}
    </section>
  );
}
