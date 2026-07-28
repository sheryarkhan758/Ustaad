/**
 * The motion contract.
 *
 * Two properties, both of which fail silently if they regress — nothing throws,
 * a test suite stays green, and the only person who notices is somebody who
 * gets a headache from the interface:
 *
 *  1. **CSS motion is neutralised** by the `prefers-reduced-motion` block in
 *     `index.css`. That is a stylesheet rule jsdom does not apply, so what is
 *     asserted here is that the rule is present and covers everything — if
 *     somebody narrows the selector to a class list, this fails.
 *  2. **JavaScript-driven motion asks.** `useReducedMotion` is what Recharts
 *     reads, because a stylesheet cannot stop a library writing intermediate
 *     values into the DOM on its own timer.
 */

import fs from 'node:fs';
import path from 'node:path';

import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useReducedMotion } from './motion';

/** A `matchMedia` that can be flipped, the way an operating system setting is. */
function stubMatchMedia(initial) {
  let matches = initial;
  const listeners = new Set();

  vi.stubGlobal('matchMedia', (query) => ({
    media: query,
    get matches() {
      return matches;
    },
    addEventListener: (_event, handler) => listeners.add(handler),
    removeEventListener: (_event, handler) => listeners.delete(handler),
  }));

  return {
    set(next) {
      matches = next;
      for (const handler of listeners) handler({ matches: next });
    },
    get listenerCount() {
      return listeners.size;
    },
  };
}

describe('the reduced-motion stylesheet rule', () => {
  const css = fs.readFileSync(path.join(process.cwd(), 'src/index.css'), 'utf8');

  it('covers every element rather than an opt-in list', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    // The universal selector with pseudo-elements. A class-based version would
    // silently miss every animation added after it was written.
    expect(css).toMatch(/\*,\s*\*::before,\s*\*::after/);
  });

  it('neutralises animation and transition with a priority nothing overrides', () => {
    const block = css.slice(css.indexOf('prefers-reduced-motion'));
    expect(block).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
    expect(block).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
    // A looping animation left running at 0.01ms would still loop forever.
    expect(block).toMatch(/animation-iteration-count:\s*1\s*!important/);
  });
});

describe('useReducedMotion', () => {
  it('reports the preference at mount', () => {
    stubMatchMedia(true);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);
  });

  it('follows a change made while the page is open', () => {
    /*
     * The case this exists for: somebody turns the setting on *because*
     * something on screen is making them unwell. Reading once at mount would
     * make them reload the page to be listened to.
     */
    const media = stubMatchMedia(false);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);

    act(() => media.set(true));
    expect(result.current).toBe(true);
  });

  it('removes its listener on unmount', () => {
    const media = stubMatchMedia(false);
    const { unmount } = renderHook(() => useReducedMotion());
    expect(media.listenerCount).toBe(1);

    unmount();
    expect(media.listenerCount).toBe(0);
  });

  it('defaults to allowing motion where matchMedia does not exist', () => {
    vi.stubGlobal('matchMedia', undefined);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
  });
});
