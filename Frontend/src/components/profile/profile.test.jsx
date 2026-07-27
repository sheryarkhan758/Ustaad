/**
 * The public tutor profile — §6.4, §6.9, §6.17, §6.21, §6.22.
 *
 * These are the task's stated done-conditions, and each of them fails silently
 * if it is wrong:
 *
 *  · a **safety-flagged review is absent** — and the way to keep it absent is to
 *    have no branch that could render one, so the test asserts on the shape of
 *    the component rather than on a prop;
 *  · a **low-signal review is marked, not removed** — the two failure modes are
 *    opposite and a lazy implementation picks the wrong one;
 *  · the **QR resolves to `/t/:slug`** and that route actually exists, which is
 *    the half that a component test alone would miss;
 *  · the **single session reads as a product**, not a downgrade.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../../i18n';
import { BookingOptions } from './BookingOptions';
import { ReliabilityChart } from './ReliabilityChart';
import { ReviewList } from './ReviewList';
import { ShareProfile, profileUrl } from './ShareProfile';

vi.mock('qrcode', () => ({
  default: { toCanvas: vi.fn(async () => undefined) },
}));

beforeEach(() => {
  i18n.changeLanguage('en');
});

function renderIn(ui) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>{ui}</MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

const REVIEW = {
  id: 'rv-detailed',
  rating: 5,
  text: 'Bohat achi teacher hain, quadratics ka pura chapter dobara samjhaya.',
  createdAt: '2026-05-02T09:00:00.000Z',
  lowSignal: false,
  credibilityWeight: 1,
  completedSessions: 12,
  contradiction: null,
  analysisStatus: 'analysed',
  dimensions: [
    { key: 'teaching_quality', score: 5, evidence: 'quadratics ka pura chapter dobara samjhaya' },
    { key: 'punctuality', score: 4, evidence: 'hamesha waqt par' },
  ],
};

/* =========================================================================
 * FR-9.6 — down-weighted, never hidden
 * ====================================================================== */

describe('a low-signal review is marked rather than removed', () => {
  const generic = {
    ...REVIEW,
    id: 'rv-generic',
    text: 'Good teacher.',
    lowSignal: true,
    credibilityWeight: 0.3,
    completedSessions: 1,
    dimensions: [],
  };

  it('renders the reviewer’s words in full', () => {
    renderIn(<ReviewList reviews={[REVIEW, generic]} />);

    // The whole point: it is still on the page, verbatim.
    expect(screen.getByText('Good teacher.')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('marks it, and says what the marking means', () => {
    renderIn(<ReviewList reviews={[REVIEW, generic]} />);

    // The badge on the card, plus the note above the list. Both are wanted.
    expect(screen.getAllByText(/little detail/i).length).toBeGreaterThan(0);
    // A badge alone is a label nobody can interpret. The explanation has to
    // say "counts for less", not "is suspect".
    expect(screen.getByText(/counts for less in ranking/i)).toBeInTheDocument();
    expect(screen.getByText(/shown in full/i)).toBeInTheDocument();
  });

  it('says above the list that marked reviews are shown, not hidden', () => {
    renderIn(<ReviewList reviews={[REVIEW, generic]} />);
    expect(screen.getByText(/shown, not hidden/i)).toBeInTheDocument();
  });
});

/* =========================================================================
 * SEC-9 — a safety-flagged review is absent
 * ====================================================================== */

describe('a safety-flagged review never reaches this page', () => {
  it('has no branch that could render one', () => {
    // The server excludes flagged reviews from the public listing, so the
    // correct implementation is one with **no** handling for the case. A
    // component that rendered "under review" or a redacted placeholder would
    // tell the tutor a report exists — which SEC-9 forbids. Asserting on the
    // absence of the branch is the only way to test that; a props-based test
    // would pass on an implementation that quietly renders a placeholder.
    const source = readFileSync(
      join(process.cwd(), 'src/components/profile/ReviewList.jsx'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');

    expect(source).not.toMatch(/safetyFlag|safety_flag|underReview|redact/i);
  });

  it('renders nothing extra when the server sent an empty list', () => {
    renderIn(<ReviewList reviews={[]} />);
    expect(screen.getByText(/No reviews yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).toBeNull();
  });
});

/* =========================================================================
 * FR-9.7 — the contradiction is surfaced, the rating untouched
 * ====================================================================== */

describe('a contradiction between stars and words is surfaced', () => {
  const contradictory = {
    ...REVIEW,
    id: 'rv-contradiction',
    rating: 5,
    text: 'Aksar late aati thin aur do baar cancel kiya.',
    contradiction: 'rating_text_mismatch',
  };

  it('shows the flag and leaves the five stars as the reviewer left them', () => {
    renderIn(<ReviewList reviews={[contradictory]} />);

    expect(screen.getByText(/Rating and words differ/i)).toBeInTheDocument();
    expect(screen.getByText(/we have not changed the rating/i)).toBeInTheDocument();
    // The rating is still 5 — flagged, not corrected.
    expect(screen.getByLabelText('5 out of 5')).toBeInTheDocument();
  });
});

/* =========================================================================
 * §6.9 — quoted evidence, per dimension
 * ====================================================================== */

describe('the dimensions carry the reviewer’s own words', () => {
  it('quotes the sentence a score was drawn from', async () => {
    const user = userEvent.setup();
    renderIn(<ReviewList reviews={[REVIEW]} />);

    await user.click(screen.getByRole('button', { name: /dimension by dimension/i }));

    expect(screen.getByText('Teaching quality')).toBeInTheDocument();
    // The model's score is checkable only because the evidence is verbatim.
    // Quoted, in a blockquote of its own — not paraphrased by the model.
    const quote = screen.getByText(
      (_, node) =>
        node?.tagName === 'BLOCKQUOTE' &&
        node.textContent === 'quadratics ka pura chapter dobara samjhaya',
    );
    expect(quote).toBeInTheDocument();
  });
});

/* =========================================================================
 * §6.21 — the share path
 * ====================================================================== */

describe('the shareable profile', () => {
  it('resolves to the canonical /t/:slug URL', () => {
    expect(profileUrl('ayesha-siddiqui')).toMatch(/\/t\/ayesha-siddiqui$/);
  });

  it('is a route the application actually serves', () => {
    // The half a component test misses: `profileUrl` can be perfect while the
    // router has no `t/:slug` entry, and then every printed QR is a 404.
    const routes = readFileSync(join(process.cwd(), 'src/routes/index.jsx'), 'utf8');
    expect(routes).toMatch(/path:\s*'t\/:slug'/);
  });

  it('prints the URL beside the code, so a photograph still works', () => {
    renderIn(<ShareProfile slug="ayesha-siddiqui" displayName="Ayesha Siddiqui" />);
    expect(screen.getByText(/\/t\/ayesha-siddiqui$/)).toBeInTheDocument();
  });

  it('offers WhatsApp as a one-tap link carrying the URL', () => {
    renderIn(<ShareProfile slug="ayesha-siddiqui" displayName="Ayesha Siddiqui" />);

    const link = screen.getByRole('link', { name: /WhatsApp/i });
    expect(link).toHaveAttribute('href', expect.stringContaining('wa.me'));
    expect(decodeURIComponent(link.getAttribute('href'))).toContain('/t/ayesha-siddiqui');
  });
});

/* =========================================================================
 * §6.30 — the single session is a product
 * ====================================================================== */

describe('booking entry points', () => {
  const tutor = { id: 'tutor-1', slug: 'ayesha-siddiqui' };
  const rates = [
    { id: 'r1', rateType: 'single_session', mode: 'home', amount: 150000 },
    { id: 'r2', rateType: 'monthly', mode: 'home', amount: 1200000 },
  ];

  it('lists the single session first and at the same weight as the others', () => {
    renderIn(<BookingOptions tutor={tutor} rates={rates} />);

    const headings = screen.getAllByRole('heading', { level: 3 });
    expect(headings[0]).toHaveTextContent(/One session/i);
    // Same element, same classes — no smaller type for the "lesser" option.
    const classes = headings.map((heading) => heading.className);
    expect(new Set(classes).size).toBe(1);
  });

  it('names what a single session is for, rather than what it lacks', () => {
    renderIn(<BookingOptions tutor={tutor} rates={rates} />);

    expect(screen.getByText(/One hour on a specific topic/i)).toBeInTheDocument();
    // A downgrade framing would read "just", "only", "trial", "instead of".
    expect(screen.queryByText(/\b(trial|just a|only a)\b/i)).toBeNull();
  });

  it('states that the platform does not take the payment', () => {
    // SEC-23 / FR-31.10, at the point money appears.
    renderIn(<BookingOptions tutor={tutor} rates={rates} />);
    expect(screen.getByText(/does not take the payment/i)).toBeInTheDocument();
  });
});

/* =========================================================================
 * §6.17, SEC-21 — reliability
 * ====================================================================== */

describe('reliability statistics', () => {
  const reliability = {
    completedSessions: 24,
    confirmationRate: 0.92,
    onTimeRate: 0.88,
    completionRate: 1,
  };

  it('states the safety-constraint exclusion beside the figures', () => {
    renderIn(<ReliabilityChart reliability={reliability} />);
    // The fairness property, at normal size. Without it the confirmation rate
    // invites exactly the inference SEC-21 exists to prevent.
    expect(screen.getByText(/declared safety conditions are excluded/i)).toBeInTheDocument();
  });

  it('offers the figures as a table, not only as an SVG', () => {
    renderIn(<ReliabilityChart reliability={reliability} />);

    const table = screen.getByRole('table', { hidden: true });
    expect(within(table).getByText('92%')).toBeInTheDocument();
    expect(within(table).getByText('100%')).toBeInTheDocument();
  });

  it('suppresses the percentages below the minimum sample', () => {
    // Three sessions and one decline is 75%, which reads as a judgement about
    // a person and is a judgement about a small number.
    renderIn(<ReliabilityChart reliability={{ ...reliability, completedSessions: 3 }} />);

    expect(screen.getByText(/Not enough completed engagements/i)).toBeInTheDocument();
    expect(screen.queryByRole('table', { hidden: true })).toBeNull();
  });
});

/* =========================================================================
 * §2.10 — nothing on this page is machine-translated
 * ====================================================================== */

describe('user text is unchanged in both languages', () => {
  it('renders a Roman Urdu review identically in Urdu mode', async () => {
    const { unmount } = renderIn(<ReviewList reviews={[REVIEW]} />);
    const inEnglish = screen.getByText(REVIEW.text).textContent;
    unmount();

    await i18n.changeLanguage('ur');
    renderIn(<ReviewList reviews={[REVIEW]} />);

    expect(screen.getByText(REVIEW.text).textContent).toBe(inEnglish);
    // The chrome around it did change — proving the comparison is meaningful.
    expect(screen.getByText(/ہر تبصرہ/)).toBeInTheDocument();
  });
});
