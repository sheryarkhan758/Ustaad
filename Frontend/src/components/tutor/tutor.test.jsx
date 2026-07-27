/**
 * The tutor's own screens — §6.4, §6.5, §6.29.2.
 *
 * Two of these tests are the task's stated done-conditions:
 *
 *  · **an untested claim is never presented as verified** — the platform's
 *    whole argument (§2.2), and the one thing on these screens that would
 *    matter if it were wrong;
 *  · **the normalised hourly figure is live and correct** — computed by the
 *    server's own function, so the preview cannot drift from the stored value.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { normaliseHourlyAmount, rupeesToPaisa } from '@shared/rates';

import i18n from '../../i18n';
import { ClaimList } from './ClaimList';
import { RateBuilder } from './RateBuilder';
import { SafetyPanel } from './SafetyPanel';
import { AvailabilityGrid } from './AvailabilityGrid';
import { computeCompleteness, CompletenessPanel } from './VerificationStatus';

const SUBJECTS = [{ id: 'mathematics', name: 'Mathematics', nameUr: 'ریاضی' }];
const LEVELS = [{ id: 'matric', name: 'Matric', nameUr: null }];
const BOARDS = [{ id: 'sindh-board', name: 'Sindh Board', nameUr: 'سندھ بورڈ' }];

beforeEach(() => {
  i18n.changeLanguage('en');
  // The reference lists the pickers inside these components reach for.
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

function renderWithProviders(ui) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        {/* Several of these components link to the screen that fixes a gap —
            naming the missing thing is only useful if it is reachable. */}
        <MemoryRouter>{ui}</MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

/* =========================================================================
 * Claims — the platform's whole argument
 * ====================================================================== */

const claim = (overrides) => ({
  id: 'c1',
  subjectId: 'mathematics',
  levelId: 'matric',
  boardId: 'sindh-board',
  topicIds: [],
  claimStatus: 'asserted',
  ...overrides,
});

describe('an untested claim is never presented as verified', () => {
  const lists = { subjects: SUBJECTS, levels: LEVELS, boards: BOARDS, topics: [] };

  it('says "not yet tested" in words, not only in colour', () => {
    renderWithProviders(<ClaimList claims={[claim()]} {...lists} />);

    expect(screen.getByText(/asserted — not yet tested/i)).toBeInTheDocument();
    // The sentence that stops a parent reading a claim as a credential.
    expect(screen.getByText(/nobody has tested it yet/i)).toBeInTheDocument();
  });

  it('never uses the word "verified" on an untested claim', () => {
    const { container } = renderWithProviders(<ClaimList claims={[claim()]} {...lists} />);

    // §2.5 and SEC-6: the badge vocabulary is what the platform actually
    // checked, and an assertion is not a check.
    expect(container.textContent).not.toMatch(/\bverified\b/i);
    expect(container.textContent).not.toMatch(/\btrusted\b|\bvetted\b|\bscreened\b/i);
  });

  it('carries a non-colour signal, so it survives greyscale', () => {
    const { container: asserted } = renderWithProviders(
      <ClaimList claims={[claim()]} {...lists} />,
    );
    const assertedCard = asserted.querySelector('li > div');

    const { container: verified } = renderWithProviders(
      <ClaimList
        claims={[claim({ id: 'c2', claimStatus: 'verified', verifiedAt: '2026-01-01', expiresOn: '2027-01-01' })]}
        {...lists}
      />,
    );
    const verifiedCard = verified.querySelector('li > div');

    // Colour alone fails a colour-blind reader. The dashed edge is the signal
    // that survives greyscale, a cheap screen and a printed page.
    expect(assertedCard.className).toMatch(/border-dashed/);
    expect(verifiedCard.className).not.toMatch(/border-dashed/);
  });

  it('describes a verified claim as an assessment that was passed', () => {
    renderWithProviders(
      <ClaimList
        claims={[claim({ claimStatus: 'verified', verifiedAt: '2026-01-01', expiresOn: '2027-01-01' })]}
        {...lists}
      />,
    );

    expect(screen.getByText(/passed assessment/i)).toBeInTheDocument();
    // Named per topic, never as a general claim about the subject (FR-11.6).
    expect(screen.getByText(/never a general claim about the subject/i)).toBeInTheDocument();
  });

  it('tells the tutor plainly what an untested claim means', () => {
    renderWithProviders(<ClaimList claims={[claim()]} {...lists} />);

    expect(screen.getByText(/one claim has not been tested/i)).toBeInTheDocument();
    expect(
      screen.getByText(/not as something we checked/i),
    ).toBeInTheDocument();
  });
});

/* =========================================================================
 * Rates — the live normalisation
 * ====================================================================== */

describe('RateBuilder', () => {
  it('shows the hourly equivalent the server would compute', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RateBuilder rates={[]} />);

    // 18,000 a month for three 90-minute sessions a week.
    await user.clear(screen.getByLabelText(/^amount/i));
    await user.type(screen.getByLabelText(/^amount/i), '18000');

    const expected = normaliseHourlyAmount({
      rateType: 'monthly',
      amount: rupeesToPaisa(18000),
      sessionsPerWeek: 3,
      minutesPerSession: 90,
    });

    // The preview is computed by the same function the repository calls on
    // write — so the tutor is shown the figure she will actually be ranked on.
    const preview = await screen.findByText(/what a parent compares/i);
    const panel = preview.closest('div');
    await waitFor(() =>
      expect(within(panel).getByText(new RegExp(String(Math.round(expected / 100))))).toBeInTheDocument(),
    );
  });

  it('says nothing rather than complaining while the form is incomplete', () => {
    renderWithProviders(<RateBuilder rates={[]} />);

    // A tutor halfway through typing has not made a mistake.
    expect(screen.getByText(/we will show you the hourly equivalent/i)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('asks for the inputs each rate type actually needs', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RateBuilder rates={[]} />);

    // Hourly needs neither sessions-per-week nor minutes-per-session.
    await user.selectOptions(screen.getByLabelText(/how you charge/i), 'hourly');
    expect(screen.queryByLabelText(/sessions a week/i)).not.toBeInTheDocument();

    // A group rate needs the per-head figure and the group size.
    await user.selectOptions(screen.getByLabelText(/how you charge/i), 'group_monthly');
    expect(await screen.findByLabelText(/per student, each month/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/most students in the group/i)).toBeInTheDocument();
  });

  it('explains why the normalisation exists, with a worked example', () => {
    renderWithProviders(<RateBuilder rates={[]} />);

    expect(screen.getByText(/why we show an hourly figure/i)).toBeInTheDocument();
    // A worked example beats a definition.
    expect(screen.getByText(/works out at about/i)).toBeInTheDocument();
  });

  it('announces the figure politely, so a screen reader hears it change', () => {
    const { container } = renderWithProviders(<RateBuilder rates={[]} />);
    expect(container.querySelector('[aria-live="polite"]')).toBeInTheDocument();
  });
});

/* =========================================================================
 * Safety — the copy is the feature
 * ====================================================================== */

describe('SafetyPanel', () => {
  it('says the constraints are enforced, not preferences', () => {
    renderWithProviders(<SafetyPanel value={{}} />);

    expect(screen.getByText(/enforced, not preferences/i)).toBeInTheDocument();
    expect(screen.getByText(/the system refuses any booking that breaks it/i)).toBeInTheDocument();
  });

  it('states that declines do not affect her statistics', () => {
    renderWithProviders(<SafetyPanel value={{}} />);

    // SEC-21. This is the belief that stops tutors using these controls, so it
    // is addressed before the checkboxes rather than after them.
    expect(
      screen.getByText(/excluded from your confirmation rate/i),
    ).toBeInTheDocument();
  });

  it('summarises what is currently in force', () => {
    renderWithProviders(
      <SafetyPanel value={{ femaleStudentsOnly: true, guardianPresenceRequired: true }} />,
    );

    expect(screen.getByText(/only female students may book you/i)).toBeInTheDocument();
    expect(screen.getByText(/requires a guardian to be present/i)).toBeInTheDocument();
  });
});

/* =========================================================================
 * Availability — a grid, and an accessible one
 * ====================================================================== */

describe('AvailabilityGrid', () => {
  it('renders a real table with weekday and time headers', () => {
    renderWithProviders(<AvailabilityGrid slots={[]} onChange={() => {}} />);

    // A screen reader announces "Monday, 18:00 to 20:00" from the headers with
    // no extra ARIA, which a div grid would have to reconstruct by hand.
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /mon/i })).toBeInTheDocument();
  });

  it('gives every cell a full label, since position carries the meaning', () => {
    renderWithProviders(<AvailabilityGrid slots={[]} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: /Mon, 18:00 to 20:00/i })).toBeInTheDocument();
  });

  it('toggles a slot on and back off', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = renderWithProviders(
      <AvailabilityGrid slots={[]} onChange={onChange} />,
    );

    await user.click(screen.getByRole('button', { name: /Mon, 18:00 to 20:00/i }));
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ weekday: 1, startTime: '18:00', endTime: '20:00', mode: 'home' }),
    ]);

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    rerender(
      <QueryClientProvider client={client}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter>
            <AvailabilityGrid
              slots={[{ weekday: 1, startTime: '18:00', endTime: '20:00', mode: 'home' }]}
              onChange={onChange}
            />
          </MemoryRouter>
        </I18nextProvider>
      </QueryClientProvider>,
    );

    const cell = screen.getByRole('button', { name: /Mon, 18:00 to 20:00/i });
    expect(cell).toHaveAttribute('aria-pressed', 'true');
    await user.click(cell);
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});

/* =========================================================================
 * Completeness — naming the missing thing
 * ====================================================================== */

describe('completeness', () => {
  it('blocks submission on the required items only', () => {
    const result = computeCompleteness({ profile: {}, claims: [], rates: [], documents: [] });

    expect(result.canSubmit).toBe(false);
    // A biography is advice, not a gate — demanding one would stall exactly the
    // tutors who are good at teaching and indifferent to writing about it.
    expect(result.blocking.map((item) => item.key)).not.toContain('bio');
    expect(result.blocking.map((item) => item.key)).toContain('claims');
  });

  it('does not count a missing rate against a volunteer', () => {
    const paid = computeCompleteness({ profile: {}, rates: [] });
    const volunteer = computeCompleteness({ profile: { volunteerFlag: true }, rates: [] });

    expect(paid.items.find((item) => item.key === 'rates').done).toBe(false);
    expect(volunteer.items.find((item) => item.key === 'rates').done).toBe(true);
  });

  it('names the missing item rather than only counting it', () => {
    const completeness = computeCompleteness({ profile: {}, claims: [], documents: [] });
    renderWithProviders(<CompletenessPanel completeness={completeness} />);

    // "80% complete" tells a tutor she is nearly there and nothing about what
    // to do next.
    expect(screen.getByText(/at least one subject claim/i)).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });
});
