/**
 * Ranking narration — §6.22, FR-22.4.
 *
 * This explains a score it did not compute. `shared/ranking.ts` produces the
 * number and the per-term breakdown; the model is handed that breakdown and
 * asked to turn it into two or three sentences a family can read.
 *
 * ── Why it is a separate module from ranking ───────────────────────────────
 * Because a search request must make no AI call (§2.8, NFR-1). Ranking happens
 * in the search path, in indexed SQL, in under 500 ms. Narration happens when
 * someone opens a result and asks "why this tutor?", from cache almost always.
 *
 * ── The cache ──────────────────────────────────────────────────────────────
 * Keyed on `(tutorId, topicId, scoreHash, lang)` against the unique index on
 * `ranking_explanations`. `scoreHash` is a hash of the breakdown, so the
 * narration is regenerated exactly when the figures behind it change and never
 * otherwise (§7.4). Re-explaining an unchanged score is the single easiest way
 * to burn a free tier.
 *
 * ── The guard ──────────────────────────────────────────────────────────────
 * A narration that mentions a figure absent from the breakdown is discarded,
 * not shown. So is one containing prohibited badge wording (§2.5). Both are
 * checked in code, because the prompt asking nicely is not enforcement.
 */

import { and, eq } from 'drizzle-orm';

import { narrationResponseSchema } from '../../shared/ai-contract';
import { findForbiddenTerm } from '../../shared/badges';
import { newId, nowIso } from '../../shared/db-values';
import type { RankingBreakdown, RankingTerm } from '../../shared/ranking';
import { rankingExplanations } from '../db/schema/ai';
import type { Executor } from '../repositories/_base';
import { contentHash } from './budget';
import { callModel } from './call';
import { loadPrompt, renderPrompt } from './prompts';

export const NARRATION_PROMPT_VERSION = 'v1';

/**
 * Term names in words, for the deterministic fallback.
 *
 * Deliberately literal — `verification` becomes "the documents Ustaad.com has
 * checked", never "how trusted she is" (§2.5).
 */
const TERM_LABELS: Record<RankingTerm, string> = {
  verification: 'the documents Ustaad.com has checked',
  competency: 'her assessment result for this topic',
  reviews: 'what families have written',
  reliability: 'her booking history',
  proximity: 'how close she teaches to the area you searched',
  ratePosition: 'where her rate sits for this subject and level',
  recency: 'how recently she has been active',
};

export type NarrationLang = 'en' | 'ur';

export interface NarrationResult {
  narration: string;
  cacheHit: boolean;
  /** True when the model's text was rejected and the deterministic one used. */
  fellBack: boolean;
}

/** The cache key. Stable across key order, so it does not churn (§7.4). */
export function scoreHashOf(breakdown: RankingBreakdown): string {
  return contentHash('narration', {
    score: breakdown.score,
    algorithmVersion: breakdown.algorithmVersion,
    terms: breakdown.terms.map((t) => ({ term: t.term, value: t.value, weight: t.weight })),
  });
}

/**
 * Every figure the model is allowed to utter.
 *
 * Collected from the breakdown itself rather than from a list maintained by
 * hand, so a new ranking term cannot silently fall outside the check.
 */
function permittedFigures(breakdown: RankingBreakdown): Set<string> {
  const figures = new Set<string>();

  const add = (n: unknown) => {
    if (typeof n !== 'number' || !Number.isFinite(n)) return;
    figures.add(String(n));
    figures.add(String(Math.round(n)));
    figures.add(n.toFixed(1));
    figures.add(n.toFixed(2));
    figures.add(String(Math.round(n * 100)));
  };

  add(breakdown.score);
  for (const term of breakdown.terms) {
    add(term.value);
    add(term.weight);
    add(term.contribution);
    for (const value of Object.values(term.inputs ?? {})) add(value);
  }
  return figures;
}

/**
 * FR-22.4, checked rather than requested.
 *
 * Every numeral in the narration must appear in the breakdown. A model that
 * computes a percentage, rounds into a new figure or invents a session count
 * produces text that is discarded here. Ordinals a family reads as prose —
 * "one", "two" — are words, not numerals, so they pass; that is intended.
 */
export function narrationIntroducesFigure(
  narration: string,
  breakdown: RankingBreakdown,
): string | null {
  const permitted = permittedFigures(breakdown);
  const numerals = narration.match(/\d+(?:\.\d+)?/g) ?? [];
  return numerals.find((n) => !permitted.has(n)) ?? null;
}

/**
 * The NFR-11 fallback, and the thing shown whenever the model's text is
 * rejected. Deterministic, dull, and never wrong: it names the two terms that
 * contributed most, in the words the breakdown itself carries.
 */
export function deterministicNarration(breakdown: RankingBreakdown, lang: NarrationLang): string {
  const top = [...breakdown.terms].sort((a, b) => b.contribution - a.contribution).slice(0, 2);

  if (lang === 'ur') {
    return `Is tutor ki ranking mein sab se zyada hissa: ${top.map((t) => TERM_LABELS[t.term]).join(' aur ')}.`;
  }
  return `This tutor ranks where they do mainly because of ${top
    .map((t) => TERM_LABELS[t.term])
    .join(' and ')}.`;
}

export async function narrateRanking(
  db: Executor,
  input: {
    tutorId: string;
    topicId: string;
    breakdown: RankingBreakdown;
    lang?: NarrationLang;
    /** A stored response, replayed with no network call (§6.15). */
    replay?: string | null;
  },
): Promise<NarrationResult> {
  const lang: NarrationLang = input.lang ?? 'en';
  const scoreHash = scoreHashOf(input.breakdown);

  /* --- Cache. The common case, by design. -------------------------------- */

  const [cached] = await db
    .select()
    .from(rankingExplanations)
    .where(
      and(
        eq(rankingExplanations.tutorId, input.tutorId),
        eq(rankingExplanations.topicId, input.topicId),
        eq(rankingExplanations.scoreHash, scoreHash),
        eq(rankingExplanations.lang, lang),
      ),
    )
    .limit(1);

  if (cached) {
    return { narration: cached.narration, cacheHit: true, fellBack: false };
  }

  /* --- Generate. ---------------------------------------------------------- */

  const prompt = renderPrompt(loadPrompt('ranking-explanation', NARRATION_PROMPT_VERSION), {
    LANG: lang,
    BREAKDOWN: JSON.stringify(input.breakdown, null, 2),
  });

  let narration: string;
  let model = 'deterministic-fallback';
  let fellBack = false;

  try {
    const result = await callModel(db, {
      component: 'narration',
      prompt,
      schema: narrationResponseSchema,
      replay: input.replay,
    });

    const candidate = result.value.narration.trim();
    const stray = narrationIntroducesFigure(candidate, input.breakdown);
    const forbidden = findForbiddenTerm(candidate);

    if (stray !== null || forbidden !== null) {
      // Discarded, not repaired. Text that claims a tutor was "vetted", or
      // quotes a figure nobody computed, is worse than plain text.
      narration = deterministicNarration(input.breakdown, lang);
      fellBack = true;
    } else {
      narration = candidate;
      model = result.model;
    }
  } catch {
    // Budget spent, every provider down, or an unparseable response. A family
    // still gets an explanation (NFR-11).
    narration = deterministicNarration(input.breakdown, lang);
    fellBack = true;
  }

  await db
    .insert(rankingExplanations)
    .values({
      id: newId(),
      tutorId: input.tutorId,
      topicId: input.topicId,
      scoreHash,
      breakdownJson: JSON.stringify(input.breakdown),
      narration,
      lang,
      model,
      promptVersion: NARRATION_PROMPT_VERSION,
      createdAt: nowIso(),
    })
    .onConflictDoNothing();

  return { narration, cacheHit: false, fellBack };
}
