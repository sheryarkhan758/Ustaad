/**
 * One page frame, so every screen starts in the same place.
 *
 * ── The problem this fixes ─────────────────────────────────────────────────
 * Thirty-five screens had each chosen their own container, padding and heading
 * size: `py-6` on most, `py-8` on six, `py-12` on one, `py-16` on another, and
 * the page title split between `text-display` and `text-title` depending on
 * which screen you were on. None of it was visible in isolation and all of it
 * was visible in sequence — moving between two screens shifted the first line
 * of content by eight pixels and changed the size of the heading above it.
 *
 * Alignment is not a property of a screen. It is a property of the set, and it
 * only holds if the set is generated from one definition.
 *
 * ── Two widths, chosen rather than drifted into ────────────────────────────
 * `prose` for anything read or filled in — a form, a conversation, a record.
 * Bounded because a 90-character line is hard to read and a full-width form is
 * a form nobody can scan.
 *
 * `wide` for anything compared — search results, a queue, a dashboard. These
 * are scanned in columns, and a column that is bounded to prose width wastes
 * the half of a laptop screen that would have shown the next four rows.
 *
 * Everything else about the frame is identical, which is the point.
 */

const WIDTHS = {
  prose: 'max-w-prose',
  wide: 'max-w-wide',
};

/**
 * @param {'prose'|'wide'} [width]
 * @param {string} title Rendered as the page's one `<h1>`.
 * @param {React.ReactNode} [intro] One line under the title. Optional.
 * @param {React.ReactNode} [actions] Controls that belong to the page itself,
 *   aligned to the end edge of the heading row.
 */
export function Page({ width = 'prose', title, intro = null, actions = null, children }) {
  return (
    <div className={`mx-auto ${WIDTHS[width] ?? WIDTHS.prose} space-y-5 px-4 py-6`}>
      {title ? (
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {/*
              One scale for every page title in the product. A heading that is
              `display` here and `title` on the next screen makes the second
              screen read as a subsection of the first.
            */}
            <h1 className="font-display text-display text-ink">{title}</h1>
            {intro ? <p className="mt-1 max-w-prose text-body text-slate">{intro}</p> : null}
          </div>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </header>
      ) : null}

      {children}
    </div>
  );
}

/**
 * A section within a page.
 *
 * Exists so that the gap between a section heading and its content is one
 * number rather than thirty-five, and so section headings sit one step below
 * the page title on every screen.
 */
export function Section({ title = null, description = null, actions = null, children }) {
  return (
    <section className="space-y-3">
      {title ? (
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="min-w-0">
            <h2 className="font-display text-subtitle text-ink">{title}</h2>
            {description ? <p className="mt-0.5 text-small text-slate">{description}</p> : null}
          </div>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
