/**
 * Motion, for the parts CSS cannot reach.
 *
 * ── Why this exists at all ─────────────────────────────────────────────────
 * `index.css` neutralises every CSS animation and transition under
 * `prefers-reduced-motion` with `!important`, which covers everything the
 * stylesheet owns. It does not cover animation driven from JavaScript: Recharts
 * draws each series on its own timer and writes the intermediate values into
 * the DOM itself, so a user who has asked their operating system for less
 * motion still gets a chart that sweeps into place.
 *
 * A vestibular disorder does not care which layer produced the movement. So
 * anything animating from JavaScript asks here first.
 *
 * ── Why it listens rather than reads once ──────────────────────────────────
 * The preference can change while the application is open — a user turning it
 * on precisely because something on screen is making them unwell. Reading the
 * value once at module load would mean they have to reload the page to be
 * listened to.
 */

import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

function prefersReduced() {
  return globalThis.matchMedia?.(QUERY).matches ?? false;
}

/**
 * `true` when the user has asked for less motion.
 *
 * @example
 *   const reduced = useReducedMotion();
 *   <Line isAnimationActive={!reduced} … />
 */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(prefersReduced);

  useEffect(() => {
    const media = globalThis.matchMedia?.(QUERY);
    if (!media) return undefined;

    const onChange = (event) => setReduced(event.matches);

    // `addEventListener` is the current API; Safari below 14 only has
    // `addListener`, and the audience for this product is not all on new
    // hardware. Both are wired, and both are cleaned up.
    if (media.addEventListener) media.addEventListener('change', onChange);
    else media.addListener?.(onChange);

    return () => {
      if (media.removeEventListener) media.removeEventListener('change', onChange);
      else media.removeListener?.(onChange);
    };
  }, []);

  return reduced;
}
