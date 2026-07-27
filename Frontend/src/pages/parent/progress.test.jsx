/**
 * The progress ledger, in both languages — §6.12, §6.27.
 *
 * The stated done-condition is that the chart renders correctly in both
 * languages **including the axis direction**, and that is worth a test rather
 * than a look, because it is the failure most likely to survive a visual check:
 * `dir="rtl"` on the page flips the layout convincingly while leaving the plot
 * inside a chart running the wrong way. A reviewer glancing at an Urdu page
 * sees a right-to-left screen and moves on.
 *
 * So the direction rule is tested as a rule — both axis props, in both
 * languages — rather than against rendered geometry that jsdom measures as
 * zero and would therefore agree with either answer. Alongside it: the page
 * renders in both languages, and the two properties that make it evidence
 * rather than analytics — the tutor's note appears verbatim, and a stalled
 * topic is named rather than left to be noticed.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../../i18n';
import Progress, { chartAxes } from './Progress';

/*
 * `ResponsiveContainer` sizes itself from a measured parent, and jsdom measures
 * everything as zero — so the charts would render as empty wrappers and every
 * assertion around them would be vacuous. Substituting a fixed box lets the
 * page render as a page. The direction rule itself is tested separately and
 * directly, precisely because this environment cannot show which way a chart
 * actually points.
 */
vi.mock('recharts', async () => {
  const actual = await vi.importActual('recharts');
  const react = await vi.importActual('react');
  return {
    ...actual,
    ResponsiveContainer: ({ children }) =>
      react.cloneElement(children, { width: 640, height: 256 }),
  };
});

/** One student, two topics, one of them stalled. */
const LEDGER = {
  studentProfileId: 'student-1',
  studentName: 'Zara Khalid',
  levelId: 'matric',
  boardId: 'sindh-board',
  entries: [
    {
      bookingId: 'b1',
      tutorId: 't1',
      subjectId: 'mathematics',
      createdAt: '2026-05-04T10:00:00.000Z',
      topicsCovered: ['math-matric-sindh-quadratic-equations'],
      masteryRatings: { 'math-matric-sindh-quadratic-equations': 2 },
      note: 'Ratta se nahi, samajh ke saath. Signed numbers pe kaam karna hai.',
      tutorVerification: { verifiedOn: '2026-01-10T00:00:00.000Z', artefactsChecked: ['cnic'] },
    },
  ],
  topics: [
    {
      topicId: 'math-matric-sindh-quadratic-equations',
      points: [
        { at: '2026-05-04T10:00:00.000Z', rating: 2, bookingId: 'b1' },
        { at: '2026-05-11T10:00:00.000Z', rating: 4, bookingId: 'b2' },
      ],
      firstRating: 2,
      latestRating: 4,
      change: 2,
      best: 4,
      sessions: 2,
      sessionsSinceImprovement: 0,
    },
    {
      topicId: 'math-matric-sindh-factorisation',
      points: [
        { at: '2026-05-04T10:00:00.000Z', rating: 3, bookingId: 'b1' },
        { at: '2026-05-11T10:00:00.000Z', rating: 3, bookingId: 'b2' },
        { at: '2026-05-18T10:00:00.000Z', rating: 3, bookingId: 'b3' },
      ],
      firstRating: 3,
      latestRating: 3,
      change: 0,
      best: 3,
      sessions: 3,
      sessionsSinceImprovement: 3,
    },
  ],
  gapCoverage: [],
  stagnantTopicIds: ['math-matric-sindh-factorisation'],
  summary: {
    sessionsRecorded: 3,
    topicsTaught: 2,
    gapsDiagnosed: 0,
    gapsAddressed: 0,
    hasDiagnostic: false,
  },
};

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () =>
        String(url).includes('/progress') ? { ledger: LEDGER } : { items: [] },
    })),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  i18n.changeLanguage('en');
});

function renderLedger() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={['/my/students/student-1/progress']}>
          <Routes>
            <Route path="/my/students/:studentProfileId/progress" element={<Progress />} />
          </Routes>
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

describe('the axis direction rule', () => {
  /*
   * Asserted as a rule rather than against rendered SVG on purpose. Recharts
   * positions its axes from a measured layout, and jsdom measures everything as
   * zero — so a geometry assertion there would pass whether or not the chart
   * had been turned around, which is worse than not testing it. This tests the
   * decision the page actually makes; the drawing is Recharts' own contract.
   */
  it('leaves both axes in reading order for English', () => {
    expect(chartAxes('ltr')).toEqual({ reversed: false, orientation: 'left' });
  });

  it('turns both axes around for Urdu', () => {
    // Both, not one. A chart with `reversed` and no `orientation` is half
    // turned around, which is the specific bug this guards.
    expect(chartAxes('rtl')).toEqual({ reversed: true, orientation: 'right' });
  });
});

describe('the progress ledger', () => {
  it('renders the figures in English, chart and table alike', async () => {
    await i18n.changeLanguage('en');
    renderLedger();

    await waitFor(() => expect(screen.getByText('Zara Khalid')).toBeInTheDocument());

    // The chart's own data, reachable without an SVG — for a screen reader, and
    // for anyone whose connection dropped the chart.
    const table = screen.getByRole('table', { hidden: true });
    expect(within(table).getByText('Latest')).toBeInTheDocument();
  });

  it('renders the same page in Urdu', async () => {
    await i18n.changeLanguage('ur');
    renderLedger();

    await waitFor(() => expect(screen.getByText('Zara Khalid')).toBeInTheDocument());

    // The Urdu dictionary is reached, not the English fallback.
    expect(screen.getByText('پیش رفت')).toBeInTheDocument();
    const table = screen.getByRole('table', { hidden: true });
    expect(within(table).getByText('تازہ ترین')).toBeInTheDocument();
  });

  it("shows the tutor's note verbatim and names a stalled topic", async () => {
    await i18n.changeLanguage('en');
    renderLedger();

    await waitFor(() =>
      expect(
        screen.getByText(/Ratta se nahi, samajh ke saath\. Signed numbers pe kaam karna hai\./),
      ).toBeInTheDocument(),
    );

    // FR-12.4 — three sessions with no increase is said, not left to be noticed.
    expect(screen.getByText(/No increase in three or more sessions/)).toBeInTheDocument();
  });
});
