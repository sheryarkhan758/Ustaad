/**
 * The comparison tray — §6.18.
 *
 * A parent shortlists tutors while browsing and compares them side by side.
 * The tray is the shortlist.
 *
 * ── Why it persists to localStorage ────────────────────────────────────────
 * The decision this tray supports — who comes into the house to teach my
 * daughter — is not made in one sitting. It is made over days, discussed with a
 * spouse, returned to. A shortlist that evaporates when the tab closes forces
 * the work to be redone, and on a metered connection redoing it costs money.
 *
 * ── What it stores, and what it deliberately does not ──────────────────────
 * Enough to render a chip and rebuild the comparison: id, slug, display name,
 * area. **No rate, no verification state, no review score.** Those change, and
 * a tray showing a price from four days ago would be quietly wrong about the
 * one number the parent is comparing on. The comparison view refetches.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'ustaad.comparison.v1';

/**
 * Three — §6.18.
 *
 * Not a technical limit. Three is what fits side by side on a phone without
 * either shrinking the columns past readability or forcing a horizontal scroll
 * through the one view whose entire purpose is seeing things next to each
 * other. It is also about where a shortlist stops narrowing a choice and starts
 * postponing it.
 */
export const MAX_TRAY = 3;

const ComparisonTrayContext = createContext(null);

function read() {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.slice(0, MAX_TRAY) : [];
  } catch {
    // Corrupt or unavailable storage (private mode, quota) must not take the
    // page down. An empty tray is a correct state; a crash is not.
    return [];
  }
}

export function ComparisonTrayProvider({ children }) {
  const [items, setItems] = useState(read);

  useEffect(() => {
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // Storage full or blocked. The tray still works for this session.
    }
  }, [items]);

  const has = useCallback((tutorId) => items.some((item) => item.tutorId === tutorId), [items]);

  const add = useCallback((tutor) => {
    setItems((current) => {
      if (current.some((item) => item.tutorId === tutor.tutorId)) return current;
      if (current.length >= MAX_TRAY) return current;
      return [
        ...current,
        {
          tutorId: tutor.tutorId,
          slug: tutor.slug,
          displayName: tutor.displayName,
          areaId: tutor.areaId ?? null,
        },
      ];
    });
  }, []);

  const remove = useCallback((tutorId) => {
    setItems((current) => current.filter((item) => item.tutorId !== tutorId));
  }, []);

  const toggle = useCallback(
    (tutor) => (has(tutor.tutorId) ? remove(tutor.tutorId) : add(tutor)),
    [has, add, remove],
  );

  const clear = useCallback(() => setItems([]), []);

  const value = useMemo(
    () => ({
      items,
      count: items.length,
      isFull: items.length >= MAX_TRAY,
      max: MAX_TRAY,
      has,
      add,
      remove,
      toggle,
      clear,
    }),
    [items, has, add, remove, toggle, clear],
  );

  return (
    <ComparisonTrayContext.Provider value={value}>{children}</ComparisonTrayContext.Provider>
  );
}

export function useComparisonTray() {
  const context = useContext(ComparisonTrayContext);
  if (!context) throw new Error('useComparisonTray must be used inside <ComparisonTrayProvider>.');
  return context;
}
