/**
 * Icons, with direction handled once.
 *
 * ── The distinction that matters ───────────────────────────────────────────
 * Some icons must mirror in RTL and some must not, and getting the second group
 * wrong is the tell that a layout was flipped mechanically rather than
 * designed.
 *
 * **Mirror** — anything that encodes *sequence* or *reading direction*: back
 * and forward arrows, chevrons in a disclosure or breadcrumb, progress arrows,
 * a "next step" caret. In Urdu, "next" points left. A back arrow still pointing
 * left in RTL sends the user forwards.
 *
 * **Do not mirror** — anything that encodes a real-world object or an absolute
 * direction: a tick, a cross, a clock (clocks run clockwise in every locale), a
 * search lens, an upward trend line, a warning triangle. Mirroring a tick
 * produces a tick that looks wrong to everyone and means nothing new.
 *
 * The mechanism is `rtl:-scale-x-100`, applied only to the directional set.
 */

const SIZES = { sm: 'h-4 w-4', md: 'h-5 w-5', lg: 'h-6 w-6' };

function Svg({ children, size = 'md', mirror = false, className = '', title, ...props }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      // Decorative unless given a title — an icon beside its own label read
      // aloud twice is noise.
      aria-hidden={title ? undefined : 'true'}
      role={title ? 'img' : undefined}
      className={[
        SIZES[size] ?? SIZES.md,
        'shrink-0',
        // The one line that makes direction work.
        mirror ? 'rtl:-scale-x-100' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...props}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

/* -------------------------------------------------------------------------
 * Directional — these mirror
 * ---------------------------------------------------------------------- */

/** Points toward the previous item, whichever side that is. */
export function ArrowBack(props) {
  return (
    <Svg mirror {...props}>
      <path d="M19 12H5" />
      <path d="M12 19l-7-7 7-7" />
    </Svg>
  );
}

/** Points toward the next item. */
export function ArrowForward(props) {
  return (
    <Svg mirror {...props}>
      <path d="M5 12h14" />
      <path d="M12 5l7 7-7 7" />
    </Svg>
  );
}

/** Disclosure and breadcrumb chevron. */
export function ChevronEnd(props) {
  return (
    <Svg mirror {...props}>
      <path d="M9 18l6-6-6-6" />
    </Svg>
  );
}

export function ChevronStart(props) {
  return (
    <Svg mirror {...props}>
      <path d="M15 18l-6-6 6-6" />
    </Svg>
  );
}

/** External link. The arrow's diagonal reads as "away", so it mirrors. */
export function ExternalLink(props) {
  return (
    <Svg mirror {...props}>
      <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
      <path d="M15 3h6v6" />
      <path d="M10 14L21 3" />
    </Svg>
  );
}

/* -------------------------------------------------------------------------
 * Non-directional — these must NOT mirror
 * ---------------------------------------------------------------------- */

/** A tick is a tick in every locale. */
export function Check(props) {
  return (
    <Svg {...props}>
      <path d="M20 6L9 17l-5-5" />
    </Svg>
  );
}

export function Close(props) {
  return (
    <Svg {...props}>
      <path d="M18 6L6 18" />
      <path d="M6 6l12 12" />
    </Svg>
  );
}

/**
 * A search lens.
 *
 * Deliberately not mirrored, though it is asymmetric. The handle's position is
 * a property of the object, not of reading order — and RTL users are as
 * accustomed to this shape as anyone else.
 */
export function Search(props) {
  return (
    <Svg {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </Svg>
  );
}

/** Chronology runs clockwise everywhere. Mirroring this would be wrong. */
export function Clock(props) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Svg>
  );
}

export function Warning(props) {
  return (
    <Svg {...props}>
      <path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </Svg>
  );
}

export function Menu(props) {
  return (
    <Svg {...props}>
      <path d="M3 6h18" />
      <path d="M3 12h18" />
      <path d="M3 18h18" />
    </Svg>
  );
}

/** Downward caret for a select. Vertical, so direction does not apply. */
export function ChevronDown(props) {
  return (
    <Svg {...props}>
      <path d="M6 9l6 6 6-6" />
    </Svg>
  );
}
