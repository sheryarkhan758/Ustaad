/**
 * The AI provider adapter — §7.5, NFR-5, NFR-11.
 *
 * One interface, three implementations:
 *
 *  · **Gemini Flash** — primary (§7.5).
 *  · **Groq Llama 3.3** — fallback, used when the primary rate-limits or fails.
 *    "A rate limit on one provider is not an outage" (§7.4).
 *  · **A heuristic classifier** — used when no key is configured.
 *
 * The third is not a mock. NFR-11 requires **every AI-dependent path to have a
 * working non-AI fallback**, and this is review analysis's: it produces a valid,
 * conservative classification from the text without a network call, so a review
 * is never left unanalysed merely because inference was unavailable. It is also
 * what makes the test suite deterministic and free.
 *
 * ── Credentials ────────────────────────────────────────────────────────────
 * Keys are read from the environment on the server and never leave it (NFR-5,
 * SEC-12). No provider response is logged, because a response quotes the review
 * and a review is user content.
 */

import {
  REVIEW_DIMENSIONS,
  type ReviewAnalysisResponse,
  type Sentiment,
} from '../../shared/review-analysis';

export interface CompletionRequest {
  prompt: string;
  /** Sent to the provider and recorded on the output row. */
  maxOutputTokens?: number;
}

export interface CompletionResult {
  text: string;
  /** Recorded on every AI output row for audit (§7.3). */
  model: string;
  /** Which link in the chain answered. Recorded in the usage log. */
  provider?: string;
  /** True when the primary failed and a later link answered (§7.4). */
  failedOver?: boolean;
}

/**
 * A rate limit is not an outage (§7.4).
 *
 * Classified so the failover chain can tell "try the next provider" from "this
 * request was malformed", and so the log records which happened.
 */
export class ProviderError extends Error {
  constructor(
    readonly provider: string,
    readonly kind: 'rate_limited' | 'timeout' | 'server_error' | 'bad_response',
    message: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

function classify(provider: string, status: number): ProviderError['kind'] {
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server_error';
  void provider;
  return 'bad_response';
}

export interface AiProvider {
  readonly name: string;
  complete(request: CompletionRequest): Promise<CompletionResult>;
}

/* -------------------------------------------------------------------------
 * Gemini
 * ---------------------------------------------------------------------- */

class GeminiProvider implements AiProvider {
  readonly name = 'gemini';

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: request.prompt }] }],
          generationConfig: {
            // Zero, because the same review must classify the same way twice —
            // otherwise the content-hash cache would return a different answer
            // from a fresh call and the audit trail would not reproduce.
            temperature: 0,
            maxOutputTokens: request.maxOutputTokens ?? 2048,
            responseMimeType: 'application/json',
          },
        }),
        signal: AbortSignal.timeout(Number(process.env.AI_REQUEST_TIMEOUT_MS ?? 15_000)),
      },
    );

    if (!response.ok) {
      // Never forward the body: it can echo the prompt, which contains user
      // content (CLAUDE.md §2.2).
      throw new ProviderError(
        this.name,
        classify(this.name, response.status),
        `gemini responded ${response.status}`,
      );
    }

    const body = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new ProviderError(this.name, 'bad_response', 'gemini returned no content');

    return { text, model: this.model, provider: this.name };
  }
}

/* -------------------------------------------------------------------------
 * Groq
 * ---------------------------------------------------------------------- */

class GroqProvider implements AiProvider {
  readonly name = 'groq';

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        max_tokens: request.maxOutputTokens ?? 2048,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: request.prompt }],
      }),
      signal: AbortSignal.timeout(Number(process.env.AI_REQUEST_TIMEOUT_MS ?? 15_000)),
    });

    if (!response.ok) {
      throw new ProviderError(
        this.name,
        classify(this.name, response.status),
        `groq responded ${response.status}`,
      );
    }

    const body = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const text = body.choices?.[0]?.message?.content;
    if (!text) throw new ProviderError(this.name, 'bad_response', 'groq returned no content');

    return { text, model: this.model, provider: this.name };
  }
}

/* -------------------------------------------------------------------------
 * The non-AI fallback — NFR-11
 * ---------------------------------------------------------------------- */

/**
 * Cue words per dimension, in English and Roman Urdu.
 *
 * Roman Urdu is included because a large share of reviews on this platform will
 * be written in it, and a fallback that only understood English would degrade
 * worst for exactly the families the platform is for.
 */
const CUES: Record<(typeof REVIEW_DIMENSIONS)[number], string[]> = {
  punctuality: ['on time', 'late', 'punctual', 'time pe', 'der se', 'waqt', 'time par'],
  teaching_quality: ['taught', 'teaching', 'explain', 'concept', 'parhaya', 'samjhaya', 'homework'],
  syllabus_command: ['syllabus', 'board', 'paper', 'past paper', 'nisab', 'course', 'pattern'],
  confidence_change: ['confidence', 'confident', 'improved', 'better', 'behtar', 'aitmaad', 'himmat'],
  communication: ['communicat', 'updates', 'told us', 'batata', 'rabta', 'reply'],
  pace: ['pace', 'fast', 'slow', 'rushed', 'tez', 'ahista', 'jaldi'],
  consistency: ['every week', 'regular', 'missed', 'cancel', 'roz', 'hamesha', 'nagha'],
  value_for_money: ['worth', 'fee', 'expensive', 'cheap', 'price', 'paisay', 'mehnga', 'zaya'],
};

const POSITIVE = ['good', 'great', 'excellent', 'improved', 'clear', 'acha', 'achi', 'bohat', 'behtar', 'shukriya'];
const NEGATIVE = ['bad', 'poor', 'late', 'rude', 'waste', 'never', 'not', 'nahi', 'kharab', 'zaya', 'bura'];
const SAFETY = ['alone', 'uncomfortable', 'inappropriate', 'touch', 'threat', 'whatsapp me directly', 'cash only', 'off the platform'];

class HeuristicProvider implements AiProvider {
  readonly name = 'heuristic';

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    // The review sits between the markers the prompt fences it with.
    const match = /<<<REVIEW_START>>>([\s\S]*?)<<<REVIEW_END>>>/.exec(request.prompt);
    const text = (match?.[1] ?? '').trim();
    const lower = text.toLowerCase();

    const sentences = text.split(/(?<=[.!?۔])\s+|\n+/).filter((s) => s.trim().length > 0);
    const scoreOf = (haystack: string): Sentiment => {
      const positive = POSITIVE.filter((w) => haystack.includes(w)).length;
      const negative = NEGATIVE.filter((w) => haystack.includes(w)).length;
      if (positive > 0 && negative > 0) return 'mixed';
      if (positive > 0) return 'positive';
      if (negative > 0) return 'negative';
      return 'mixed';
    };

    const dimensions = Object.fromEntries(
      REVIEW_DIMENSIONS.map((dimension) => {
        const cues = CUES[dimension];
        const hit = cues.find((cue) => lower.includes(cue));
        if (!hit) {
          return [dimension, { sentiment: 'not_mentioned' as Sentiment, evidence: '', specificity: 0 }];
        }

        // Quote the reviewer's own sentence, never a paraphrase.
        const evidence =
          sentences.find((s) => s.toLowerCase().includes(hit))?.trim().slice(0, 400) ?? '';

        return [
          dimension,
          {
            sentiment: scoreOf(evidence.toLowerCase()),
            evidence,
            // Longer, more concrete sentences read as more specific. Crude, and
            // deliberately conservative: the fallback should not manufacture
            // confidence it has not earned.
            specificity: Math.min(0.6, Math.round((evidence.length / 200) * 100) / 100),
          },
        ];
      }),
    );

    const safety = SAFETY.some((cue) => lower.includes(cue));

    const response: ReviewAnalysisResponse = {
      dimensions: dimensions as ReviewAnalysisResponse['dimensions'],
      topicsMentioned: [],
      safetyConcern: safety,
      safetyConcernReason: safety ? 'Matched a safety cue word; needs a person to read it.' : '',
      overallSentiment: scoreOf(lower),
    };

    return {
      text: JSON.stringify(response),
      model: 'heuristic-fallback-v1',
      provider: this.name,
    };
  }
}

/* -------------------------------------------------------------------------
 * Selection and failover
 * ---------------------------------------------------------------------- */

function configured(value: string | undefined): value is string {
  return !!value && value.trim() !== '' && !value.startsWith('REPLACE_');
}

/**
 * Try the primary, fall back to the secondary, then to the heuristic.
 *
 * A rate limit on one provider is not an outage (§7.4), and an outage on both
 * is still not a lost review (NFR-11).
 */
export class FailoverProvider implements AiProvider {
  readonly name = 'failover';

  constructor(private readonly chain: AiProvider[]) {}

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    let lastError: unknown;

    for (const [index, provider] of this.chain.entries()) {
      try {
        const result = await provider.complete(request);
        // Recorded so the usage log shows when the primary was unavailable —
        // "a rate limit on one provider is not an outage" is only checkable if
        // the failover is visible afterwards (§7.4).
        return { ...result, provider: result.provider ?? provider.name, failedOver: index > 0 };
      } catch (error) {
        lastError = error;
        // The provider, the kind of failure, and nothing else. Never the prompt
        // or the response — both quote user content (CLAUDE.md §2.2).
        const kind = error instanceof ProviderError ? error.kind : 'unknown';
        console.warn(`[ai] ${provider.name} failed (${kind}), trying the next provider`);
      }
    }

    throw lastError instanceof Error ? lastError : new Error('every AI provider failed');
  }
}

let cached: AiProvider | null = null;

export function getAiProvider(): AiProvider {
  if (cached) return cached;

  const chain: AiProvider[] = [];
  const geminiKey = process.env.GEMINI_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;

  if (configured(geminiKey)) {
    chain.push(new GeminiProvider(geminiKey, process.env.GEMINI_MODEL ?? 'gemini-2.0-flash'));
  }
  if (configured(groqKey)) {
    chain.push(new GroqProvider(groqKey, process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile'));
  }

  // Always last. With no keys configured it is the only link, which is how
  // development and the test suite run with no account and no network.
  chain.push(new HeuristicProvider());

  cached = new FailoverProvider(chain);
  return cached;
}

/** Test seam. */
export function setAiProvider(provider: AiProvider | null): void {
  cached = provider;
}
