/**
 * The discovery surface — §6.7, §6.16, §6.18, §6.19.
 *
 * Three of these are the task's stated done-conditions, and two of them are the
 * ones that would matter most if they were wrong:
 *
 *  · the gender restriction is communicated as an **exclusion**, never as an
 *    ordering (§6.16 — the platform's market-critical constraint);
 *  · the benchmark is **suppressed entirely** below the server's cohort
 *    threshold rather than shown from a thin sample (SEC-17);
 *  · the empty state offers **both** recovery paths and never suggests giving
 *    up the gender filter.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../../i18n';
import { ComparisonTrayProvider } from '../../context/ComparisonTrayContext';
import { GenderRestrictionBanner } from './GenderRestrictionBanner';
import { NoResults } from './NoResults';
import { RateBadge, RateBenchmarkPanel, rateBand } from './RateBenchmark';
import { ResultCard } from './ResultCard';

beforeEach(() => {
  i18n.changeLanguage('en');
  globalThis.localStorage?.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ items: [] }),
      headers: new Headers(),
    })),
  );
});

function renderIn(ui) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <ComparisonTrayProvider>
          <MemoryRouter>{ui}</MemoryRouter>
        </ComparisonTrayProvider>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

/* =========================================================================
 * The hard constraint — §6.16
 * ====================================================================== */

describe('the gender restriction is shown as an exclusion, not a sort', () => {
  it('is absent when no preference is applied', () => {
    // FR-16.6 — the system never pre-sets the filter, so there is nothing to
    // announce by default.
    const { container } = renderIn(
      <GenderRestrictionBanner appliedGenderPreference="no_preference" resultCount={7} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('states that non-matching tutors were excluded by the server', () => {
    renderIn(<GenderRestrictionBanner appliedGenderPreference="female_only" resultCount={7} />);

    expect(screen.getByText(/showing female tutors only/i)).toBeInTheDocument();
    expect(screen.getByText(/excluded from these results by the server/i)).toBeInTheDocument();
    expect(screen.getByText(/this is an exclusion, not an ordering/i)).toBeInTheDocument();
  });

  it('never describes the constraint as a preference, priority or ordering', () => {
    const { container } = renderIn(
      <GenderRestrictionBanner appliedGenderPreference="female_only" resultCount={7} />,
    );

    // The vocabulary matters as much as the mechanism. A parent who reads
    // "prioritised" has to check every result themselves, and the filter has
    // bought them nothing.
    expect(container.textContent).not.toMatch(/prioritis|prioritiz|ranked (higher|first)|sorted by|preferred first/i);
  });

  it('is a landmark region, so it can be found deliberately', () => {
    renderIn(<GenderRestrictionBanner appliedGenderPreference="female_only" resultCount={7} />);
    expect(screen.getByRole('region', { name: /restriction in force/i })).toBeInTheDocument();
  });

  it('reflects the server response rather than the requested filter', () => {
    // The component takes `appliedGenderPreference` off the response. If the
    // two ever disagreed, showing the local one would be a lie in the exact
    // place a parent is trusting us.
    renderIn(<GenderRestrictionBanner appliedGenderPreference="male_only" resultCount={2} />);
    expect(screen.getByText(/showing male tutors only/i)).toBeInTheDocument();
  });
});

/* =========================================================================
 * Benchmark suppression — SEC-17
 * ====================================================================== */

describe('rate benchmarking suppresses a thin sample', () => {
  it('computes no band at all when the median is null', () => {
    // The server returns null below a cohort of four. There is nothing to
    // compare against, and inventing one from the results on screen would
    // reconstruct exactly what SEC-17 withheld.
    expect(rateBand(150000, null)).toBeNull();
    expect(rateBand(150000, undefined)).toBeNull();
  });

  it('renders nothing on a card when the benchmark is suppressed', () => {
    const { container } = renderIn(
      <RateBadge normalisedHourly={150000} benchmarkMedian={null} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('explains the absence on a panel rather than showing a thin figure', () => {
    renderIn(<RateBenchmarkPanel normalisedHourly={150000} median={null} />);

    expect(screen.getByText(/not enough tutors/i)).toBeInTheDocument();
    // "Not enough tutors" is true of the cell, not of any tutor in it.
    expect(screen.getByText(/rather show nothing than a figure drawn from two or three/i)).toBeInTheDocument();
  });

  it('bands a rate below, at and above the median', () => {
    expect(rateBand(80000, 100000)).toBe('below');
    expect(rateBand(100000, 100000)).toBe('at');
    expect(rateBand(130000, 100000)).toBe('above');
    // Within ten per cent counts as the same — tuition is negotiated in round
    // numbers and no parent treats 1,300 and 1,400 as different categories.
    expect(rateBand(105000, 100000)).toBe('at');
    expect(rateBand(95000, 100000)).toBe('at');
  });
});

/* =========================================================================
 * The result card
 * ====================================================================== */

/**
 * `tutor` is pulled out of `overrides` before the rest is spread.
 *
 * Spreading `...overrides` wholesale after composing `tutor` replaced the
 * composed object with the bare override — so a test that only meant to set
 * `volunteerFlag` silently dropped the verification artefacts, and the failure
 * looked like a component bug.
 */
/*
 * The shape `GET /api/search` actually returns: **flat**, not a nested
 * `tutor`. The fixture mirrored an object the endpoint never sent, which is
 * exactly why the card crashed in the browser while these tests passed — a
 * fixture that agrees with the component instead of with the server tests
 * nothing about the seam between them.
 */
const result = (overrides = {}) => ({
  tutorId: 't1',
  slug: 'ayesha-siddiqui',
  displayName: 'Ayesha Siddiqui',
  experienceYears: 9,
  volunteer: false,
  willingAreaIds: ['karachi-clifton'],
  verifiedArtefacts: ['cnic', 'degree'],
  competency: [{ topicId: 'quadratics', status: 'verified' }],
  reliability: { confirmationRate: 0.94, completedSessions: 48 },
  engagementTypes: ['monthly'],
  normalisedHourly: 138500,
  benchmarkMedian: 130000,
  travelMinutes: 12,
  ...overrides,
});

describe('ResultCard', () => {
  it('itemises what was checked rather than showing a single tick', () => {
    renderIn(<ResultCard result={result()} />);

    // §2.5, SEC-6 — the highest-traffic place the badge mistake could be made.
    expect(screen.getByText('CNIC')).toBeInTheDocument();
    expect(screen.getByText('Degree')).toBeInTheDocument();
  });

  it('shows an expired competency badge as expired rather than hiding it', () => {
    renderIn(
      <ResultCard
        result={result({ competency: [{ topicId: 'quadratics', status: 'expired' }] })}
      />,
    );

    // A tutor who passed and lapsed is in a different position from one who
    // never sat; hiding the difference flatters the second at the first's cost.
    expect(screen.getByText(/lapsed/i)).toBeInTheDocument();
  });

  it('shows the rate band when a benchmark exists and nothing when it does not', () => {
    const { unmount } = renderIn(<ResultCard result={result()} />);
    expect(screen.getByText(/about the local median/i)).toBeInTheDocument();
    unmount();

    renderIn(<ResultCard result={result({ benchmarkMedian: null })} />);
    expect(screen.queryByText(/local median/i)).not.toBeInTheDocument();
  });

  it('marks a volunteer without implying anything about verification', () => {
    renderIn(<ResultCard result={result({ volunteer: true })} />);

    // FR-33.10 — the flag never substitutes for verification, so the itemised
    // check list is still there beside it.
    expect(screen.getByText(/volunteer/i)).toBeInTheDocument();
    expect(screen.getByText('CNIC')).toBeInTheDocument();
  });

  it('adds and removes a tutor from the comparison tray', async () => {
    const user = userEvent.setup();
    renderIn(<ResultCard result={result()} />);

    const button = screen.getByRole('button', { name: /^compare$/i });
    expect(button).toHaveAttribute('aria-pressed', 'false');

    await user.click(button);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /in comparison/i })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    );
  });
});

/* =========================================================================
 * The empty state — the platform's hardest case
 * ====================================================================== */

describe('the empty state does real work', () => {
  const femaleOnlyQuery = {
    genderPreference: 'female_only',
    areaId: 'karachi-clifton',
    subjectId: 'mathematics',
    includeAdjacentAreas: false,
  };

  it('offers both recovery paths', async () => {
    renderIn(<NoResults query={femaleOnlyQuery} onWiden={() => {}} />);

    expect(await screen.findByText(/try neighbouring areas/i)).toBeInTheDocument();
    expect(screen.getByText(/tell us what is missing/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /post to the demand board/i })).toBeInTheDocument();
  });

  it('never suggests removing the gender filter', () => {
    const { container } = renderIn(<NoResults query={femaleOnlyQuery} onWiden={() => {}} />);

    // For the family this state exists for, that is not a compromise — it is a
    // suggestion to stop using the platform, and it would say the constraint
    // was a preference all along.
    expect(container.textContent).not.toMatch(
      /remove the gender|any gender|male tutors too|drop the female|show male/i,
    );
  });

  it('names the gap rather than shrugging, when the search was female-only', () => {
    renderIn(<NoResults query={femaleOnlyQuery} onWiden={() => {}} />);
    expect(screen.getByText(/the gap this platform exists to close/i)).toBeInTheDocument();
  });

  it('says what the demand record does and does not hold', () => {
    renderIn(<NoResults query={femaleOnlyQuery} onWiden={() => {}} />);

    // SEC-16 — a parent asked to "tell us what you need" reasonably wants to
    // know what is being kept.
    expect(screen.getByText(/nothing about you/i)).toBeInTheDocument();
    expect(screen.getByText(/no name, no contact/i)).toBeInTheDocument();
  });

  it('does not offer to widen when neighbouring areas are already included', () => {
    renderIn(
      <NoResults query={{ ...femaleOnlyQuery, includeAdjacentAreas: true }} onWiden={() => {}} />,
    );
    expect(screen.queryByText(/try neighbouring areas/i)).not.toBeInTheDocument();
  });
});
