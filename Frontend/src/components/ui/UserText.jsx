/**
 * User-generated content, rendered exactly as written.
 *
 * ── The rule this component exists to make impossible to break ─────────────
 * **User-generated content is NEVER machine-translated** (decision 13,
 * FR-27.5). Reviews, biographies, session notes, feedback and volunteer
 * motivations render byte-for-byte as their author typed them, in whatever
 * script or mixture of scripts they chose.
 *
 * The reason is not technical. A parent who wrote *"waqt par aati hain, lekin
 * pace thora tez hai"* did not write *"she arrives on time, but the pace is a
 * little fast"* — and a platform that silently rewrites what people said about
 * each other has replaced testimony with paraphrase. On a product whose entire
 * claim is that its records are trustworthy, that would be the most expensive
 * possible thing to get wrong.
 *
 * So: **interface strings come from i18next; user text comes from here.** The
 * two never mix. `src/i18n/ugc.test.js` fails the build if a user-content field
 * is passed through `t()`.
 *
 * ── Why direction is detected rather than inherited ────────────────────────
 * A review written in Urdu inside an English page must still render
 * right-to-left, and an English biography inside an Urdu page must render
 * left-to-right. Inheriting the page direction gets both backwards.
 *
 * `dir="auto"` asks the browser to decide from the first strong directional
 * character, which is exactly the right heuristic and is what it was designed
 * for. Roman Urdu — *"waqt par aati hain"* — has no strong RTL character, so it
 * correctly renders LTR: the words are Urdu but the script is Latin, and the
 * script is what direction follows.
 *
 * `lang` is set only when a caller genuinely knows it. Guessing wrong makes a
 * screen reader pronounce Roman Urdu with Urdu phonemes, which is worse than
 * leaving it unset.
 */

const BASE = 'whitespace-pre-wrap break-words';

/**
 * @param {object} props
 * @param {string} props.children The author's text. Never transformed.
 * @param {string} [props.lang] BCP-47 tag, only if actually known.
 * @param {string} [props.as] Element to render. Defaults to `<p>`.
 */
export function UserText({ children, lang, as: As = 'p', className = '', ...props }) {
  if (children === null || children === undefined || children === '') return null;

  return (
    <As
      // The browser decides direction from the content itself.
      dir="auto"
      lang={lang}
      className={[BASE, className].filter(Boolean).join(' ')}
      {...props}
    >
      {/*
        Rendered as a plain child, so React escapes it. There is deliberately no
        `dangerouslySetInnerHTML` path here and there must never be one: this is
        the component that renders text typed by strangers.
      */}
      {children}
    </As>
  );
}

/**
 * A quotation from a review, with the same guarantees.
 *
 * Separate from `UserText` only so the citation is marked up as one — a
 * `<blockquote>` tells a screen reader this is somebody else speaking, which is
 * the distinction the whole review-credibility feature rests on.
 */
export function UserQuote({ children, lang, cite, className = '' }) {
  if (!children) return null;

  return (
    <blockquote
      dir="auto"
      lang={lang}
      className={[
        BASE,
        // Logical border: the rule sits on the reading-start edge in both
        // directions. `border-l` would strand it on the wrong side in Urdu.
        'border-s-2 border-slate-line ps-3 text-ink',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
      {cite ? <cite className="mt-1 block text-caption not-italic text-slate">{cite}</cite> : null}
    </blockquote>
  );
}
