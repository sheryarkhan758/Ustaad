/**
 * Design tokens — Ustaad.com.
 *
 * **Every colour, size and radius the product uses is declared here.** No
 * component may write an arbitrary hex value in JSX. That is not tidiness: an
 * interface whose job is to make trust legible cannot have three slightly
 * different navies, because the inconsistency reads as carelessness in exactly
 * the place where carelessness is most expensive.
 *
 * ── The palette, and why it is this one ────────────────────────────────────
 * Anchored on the specification's own identity — deep navy #1B3A57 and teal
 * #0F7B8A — and built outward toward the visual language of a *record*: a
 * matriculation certificate, a bank passbook, a NADRA card. Cool blue-grey
 * paper rather than warm cream, brass rather than terracotta, a restrained
 * brick for alarm rather than a bright alert red.
 *
 * ── The contrast problem, stated ───────────────────────────────────────────
 * `verdigris` (#0F7B8A) measures roughly 4.1:1 on white — it **fails** WCAG AA
 * for body text, which needs 4.5:1. It is kept for fills, borders and large
 * display type, and `verdigris-deep` (#0A5D69, ~6.4:1) carries teal text.
 * Two tokens instead of one, because the alternative is a brand colour that
 * quietly fails the accessibility floor everywhere it is used as a link.
 *
 * ── `seal` is scarce by rule ───────────────────────────────────────────────
 * The brass ochre appears in exactly one component — the Verification Record —
 * and nowhere else in the product. Scarcity is what makes it read as a stamp
 * rather than as decoration. It never carries text on a light ground (≈3.5:1);
 * border and fill only.
 */

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        /** Spec navy. Primary text, primary actions, the institutional voice. */
        ink: {
          DEFAULT: '#1B3A57',
          deep: '#12293D',
          soft: '#2C5478',
        },
        /** Spec teal. Verification, links, accents. */
        verdigris: {
          DEFAULT: '#0F7B8A',
          /** AA-safe teal for text. #0F7B8A alone is ~4.1:1 on white. */
          deep: '#0A5D69',
          soft: '#E3F1F3',
        },
        /** Secondary text, borders, table rules. */
        slate: {
          DEFAULT: '#5A6E7F',
          light: '#8A9BA8',
          line: '#D8E0E6',
        },
        /** Page ground. Cool blue-grey — deliberately not warm cream. */
        paper: {
          DEFAULT: '#F1F4F7',
          sunk: '#E7ECF1',
        },
        /**
         * Brass. **Verification Record only.** See the header note.
         */
        seal: {
          DEFAULT: '#A8763E',
          soft: '#F5EDE1',
          /** The one variant dark enough for text, ~4.8:1. Used on the seal. */
          deep: '#7A5429',
        },
        /** Restrained brick. Errors, safety flags. Never a bright alert red. */
        flag: {
          DEFAULT: '#A32F27',
          soft: '#FBEBEA',
        },
        /** Confirmation. Muted, because this product does not celebrate. */
        settled: {
          DEFAULT: '#1F6F4A',
          soft: '#E6F2EC',
        },
      },

      fontFamily: {
        /**
         * Display — Latin. An institutional serif, not a marketing one.
         */
        display: ['"Source Serif 4"', 'Georgia', 'serif'],
        /**
         * Body and UI — Latin. IBM Plex Sans and IBM Plex Sans Arabic are one
         * designed family, which is why they are chosen together: the Urdu
         * interface should not look bolted onto the English one.
         */
        body: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        /**
         * Urdu body and UI — Naskh.
         *
         * Naskh rather than Nastaliq for anything small or interactive.
         * Nastaliq is the more beautiful script and the wrong tool for a form
         * label: it is slower to read at size, needs enormous leading, and its
         * cascading baseline makes a 44px tap target look cramped.
         */
        urdu: ['"IBM Plex Sans Arabic"', '"Noto Naskh Arabic"', 'serif'],
        /**
         * Urdu display — Nastaliq. Headings and the brand only.
         */
        nastaliq: ['"Noto Nastaliq Urdu"', 'serif'],
        /** Amounts and dates. Tabular figures matter on a record. */
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },

      fontSize: {
        // [size, { lineHeight, letterSpacing }]
        'display-lg': ['2.25rem', { lineHeight: '1.15', letterSpacing: '-0.02em' }],
        'display': ['1.75rem', { lineHeight: '1.2', letterSpacing: '-0.015em' }],
        'title': ['1.375rem', { lineHeight: '1.3' }],
        'subtitle': ['1.125rem', { lineHeight: '1.4' }],
        'body': ['1rem', { lineHeight: '1.5' }],
        'small': ['0.875rem', { lineHeight: '1.5' }],
        'caption': ['0.75rem', { lineHeight: '1.45', letterSpacing: '0.01em' }],
        /**
         * Urdu needs materially more leading than Latin at the same size.
         * These are separate tokens rather than a global override because a
         * bilingual page renders both at once.
         */
        'urdu-body': ['1.0625rem', { lineHeight: '1.9' }],
        'urdu-small': ['0.9375rem', { lineHeight: '1.85' }],
        /** Nastaliq. 2.4 is not generous — it is the minimum that does not clip. */
        'nastaliq-display': ['1.875rem', { lineHeight: '2.4' }],
        'nastaliq-title': ['1.375rem', { lineHeight: '2.3' }],
      },

      spacing: {
        /** WCAG 2.5.5 floor for a touch target. */
        tap: '2.75rem', // 44px
        /** Primary actions get more, because they are hit under pressure. */
        'tap-lg': '3rem', // 48px
        /** Height of the bottom action bar, for scroll padding. */
        'action-bar': '4.5rem',
      },

      borderRadius: {
        card: '0.625rem',
        control: '0.5rem',
        /** The record card is squarer than everything else. It is a document. */
        record: '0.25rem',
      },

      boxShadow: {
        card: '0 1px 2px rgba(27, 58, 87, 0.06), 0 1px 3px rgba(27, 58, 87, 0.04)',
        raised: '0 4px 12px rgba(27, 58, 87, 0.10)',
        /** The bottom action bar lifts off the page rather than floating. */
        'action-bar': '0 -2px 12px rgba(27, 58, 87, 0.08)',
      },

      maxWidth: {
        /** Reading and flows. */
        prose: '38rem',
        /** Admin tables and dashboards. */
        wide: '70rem',
      },

      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      animation: {
        shimmer: 'shimmer 1.6s linear infinite',
      },
    },
  },
  plugins: [],
};
