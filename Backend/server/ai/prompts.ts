/**
 * Prompt loading — §7.3.
 *
 * Prompts are **versioned Markdown files loaded at runtime, never inlined in
 * source**. Every AI output row records the prompt version that produced it, so
 * a revision can be evaluated against prior output and the README's disclosure
 * of the instructions is verifiable rather than asserted.
 *
 * ── On the directory ───────────────────────────────────────────────────────
 * The brief asked for `/server/ai/prompts/`. They live in `/prompts` instead,
 * because CLAUDE.md §2.9 and specification §7.3 both name that path and the
 * directory already exists in the repository. The substance of the invariant —
 * versioned Markdown, loaded at runtime, never a string literal — is unchanged,
 * and `PROMPTS_DIR` below moves it in one line if you would rather it sat under
 * `server/ai/`.
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * Where the prompt files are, in whichever layout the process is running under.
 *
 * `'prompts'` is relative to the working directory, and that directory is not
 * the same in the two places this code runs. Locally the process starts in
 * `Backend/`, so `prompts/` resolves. In a Netlify Function the working
 * directory is `/var/task` and the repository sits below it, so the same
 * relative path resolves to nothing — every agent call then threw ENOENT
 * *before* reaching the fallback that exists to keep AI failures from
 * surfacing as errors (NFR-11), and the user got a 500 instead of the manual
 * search path.
 *
 * The candidates are tried in order and the first that exists wins.
 * `PROMPTS_DIR` still overrides everything, so the directory is one variable
 * away from moving. Bundling is the other half of this: esbuild ships
 * JavaScript, so `netlify.toml` has to declare the `.md` files as
 * `included_files` or there is nothing here to find.
 */
function resolvePromptsDir(): string {
  const explicit = process.env.PROMPTS_DIR?.trim();
  if (explicit) return explicit;

  const candidates = ['prompts', 'Backend/prompts', path.join(process.cwd(), 'Backend', 'prompts')];
  return candidates.find((dir) => fs.existsSync(dir)) ?? 'prompts';
}

export const PROMPTS_DIR = resolvePromptsDir();

export interface LoadedPrompt {
  id: string;
  version: string;
  /** The body, with the YAML front matter stripped. */
  template: string;
}

const cache = new Map<string, LoadedPrompt>();

export class PromptNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PromptNotFoundError';
  }
}

/**
 * Load `<id>.<version>.md`.
 *
 * Cached after the first read: a prompt file does not change while the process
 * is running, and re-reading it per request would put a filesystem call in the
 * path of every model call.
 */
export function loadPrompt(id: string, version: string): LoadedPrompt {
  const key = `${id}.${version}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const file = path.join(PROMPTS_DIR, `${key}.md`);
  if (!fs.existsSync(file)) {
    throw new PromptNotFoundError(
      `prompt "${key}" not found at ${file}. Prompts are versioned Markdown loaded at ` +
        'runtime and are never inlined in source (§7.3).',
    );
  }

  const raw = fs.readFileSync(file, 'utf8');
  // Strip YAML front matter; it documents the prompt, it is not sent to a model.
  const template = raw.replace(/^---\n[\s\S]*?\n---\n/, '').trim();

  const loaded: LoadedPrompt = { id, version, template };
  cache.set(key, loaded);
  return loaded;
}

/**
 * Substitute `{{PLACEHOLDER}}` values.
 *
 * User text is inserted **only** into a placeholder the prompt already fenced
 * with explicit start and end markers, and the prompt tells the model that
 * everything between them is data (SEC-11). This function does not attempt to
 * sanitise the text — stripping or rewriting a reviewer's words would breach
 * §2.10, and the defence belongs in the instructions, not in a filter that
 * quietly edits what someone wrote.
 */
export function renderPrompt(prompt: LoadedPrompt, values: Record<string, string>): string {
  let out = prompt.template;
  for (const [key, value] of Object.entries(values)) {
    out = out.split(`{{${key}}}`).join(value);
  }
  return out;
}

/** Test seam. */
export function clearPromptCache(): void {
  cache.clear();
}
