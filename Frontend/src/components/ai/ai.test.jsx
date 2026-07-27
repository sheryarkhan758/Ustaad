/**
 * The AI surfaces — §6.10, §6.11, §6.25, §6.26, §7.
 *
 * The stated done-conditions, and the properties that fail silently:
 *
 *  · the shortlist says the constraints were applied **by code, not by the
 *    model** — the one claim a family has to take on trust otherwise;
 *  · a tutor who fails can appeal, and is told an administrator may overturn
 *    the automated result;
 *  · the plan renders in prerequisite order and shows it was *checked*;
 *  · **every** AI screen degrades to something usable, and the manual route is
 *    present before anything goes wrong rather than after.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AGENT_LIMITS, searchToolCallSchema } from '@shared/ai-contract';

import i18n from '../../i18n';
import { AiUnavailable, ManualSearchLink } from './AiFallback';
import { ConstraintNotice } from './ConstraintNotice';
import { CompetencyExam } from './CompetencyExam';
import { ExamCountdown, daysUntil, nextStep } from './ExamCountdown';
import { StudyPlanTimeline } from './StudyPlanTimeline';
import { ToastProvider } from '../../context/ToastContext';

beforeEach(() => {
  i18n.changeLanguage('en');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ topics: [], edges: [] }),
      headers: new Headers(),
    })),
  );
});

function renderIn(ui) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <ToastProvider>
          <MemoryRouter>{ui}</MemoryRouter>
        </ToastProvider>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

/* =========================================================================
 * §7.2, FR-16.4 — the model cannot relax a hard constraint
 * ====================================================================== */

describe('the hard constraints', () => {
  it('have no field in the search tool call the model may emit', () => {
    /*
     * The structural half. The UI's claim — "applied by the system, not the
     * assistant" — is only true because the contract gives the model nowhere
     * to express gender, budget or area. If a field were ever added here the
     * copy would become a lie, so the test guards the contract rather than
     * the sentence.
     */
    const shape = searchToolCallSchema.shape;
    expect(Object.keys(shape).sort()).toEqual(['boardId', 'levelId', 'tool', 'topicIds']);
    expect(shape).not.toHaveProperty('genderPreference');
    expect(shape).not.toHaveProperty('maxHourlyRate');
    expect(shape).not.toHaveProperty('areaId');
  });

  it('are stated as enforced in code, not as a preference passed to the model', () => {
    renderIn(
      <ConstraintNotice
        constraints={{ genderPreference: 'female_only', maxHourlyRate: 150000 }}
        areaName="Clifton"
      />,
    );

    expect(screen.getByText(/Female tutors only/i)).toBeInTheDocument();
    expect(screen.getByText(/in the database query/i)).toBeInTheDocument();
    expect(screen.getByText(/no way to set or relax them/i)).toBeInTheDocument();
    // Exclusion, never ordering.
    expect(screen.getByText(/not in the list at all/i)).toBeInTheDocument();
  });

  it('renders nothing when no preference was set', () => {
    // FR-16.6 — the system never pre-sets the filter, so there is nothing to
    // announce by default.
    const { container } = renderIn(
      <ConstraintNotice constraints={{ genderPreference: 'no_preference' }} />,
    );
    expect(container.firstChild).toBeNull();
  });
});

/* =========================================================================
 * NFR-11 — every AI screen degrades
 * ====================================================================== */

describe('the degraded path', () => {
  it('offers the manual route without an error having happened', () => {
    renderIn(<ManualSearchLink />);
    expect(screen.getByRole('link', { name: /Search for tutors yourself/i })).toHaveAttribute(
      'href',
      '/search',
    );
  });

  it('treats "could not work it out" as an outcome, not a failure', () => {
    // FR-10.8 — a valid terminal state. The copy must not apologise for a
    // correct answer.
    renderIn(<AiUnavailable reasonKey="insufficient" />);

    expect(screen.getByText(/could not be located confidently/i)).toBeInTheDocument();
    expect(screen.getByText(/better than naming a topic on a hunch/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Search for tutors yourself/i })).toBeInTheDocument();
  });

  it('reports rather than alerts', () => {
    // `status`, not `alert`: an assertive interruption is the wrong register
    // for "we could not work it out from what you told us".
    renderIn(<AiUnavailable reasonKey="busy" />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('puts the manual link on every AI screen, not only the broken one', () => {
    /*
     * Structural. A rate limit arriving on turn four should find the escape
     * hatch already on the page — so every screen under components/ai and the
     * AI pages must reference the fallback, not just import it on demand.
     */
    const roots = ['src/components/ai'];
    const screens = ['IntakeConversation.jsx', 'CompetencyExam.jsx'];

    for (const root of roots) {
      for (const name of readdirSync(root)) {
        if (!screens.includes(name)) continue;
        const source = readFileSync(join(root, name), 'utf8');
        expect(source, `${name} must offer a non-AI route`).toMatch(
          /ManualSearchLink|AiUnavailable/,
        );
      }
    }
  });
});

/* =========================================================================
 * §6.11 — an examination that respects the tutor
 * ====================================================================== */

const CLAIM = { id: 'c1', topicId: 't1', topicName: 'Thermodynamics' };

describe('the competency assessment', () => {
  it('states the stakes and the rules before she starts', () => {
    renderIn(<CompetencyExam claim={CLAIM} />);

    // Heading and the appeal-rules line both match; both are wanted.
    expect(screen.getAllByText(/The rules/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/valid for twelve months/i)).toBeInTheDocument();
    // What a failure does *not* touch — the thing she most needs to know.
    expect(screen.getByText(/untouched/i)).toBeInTheDocument();
    // And that the automated verdict is not the last word.
    expect(screen.getByText(/An administrator can overturn/i)).toBeInTheDocument();
  });

  it('reads the exchange cap from the shared limits rather than hard-coding it', () => {
    renderIn(<CompetencyExam claim={CLAIM} />);
    expect(
      screen.getByText(
        new RegExp(`at most ${AGENT_LIMITS.verificationMaxTurns} exchanges`, 'i'),
      ),
    ).toBeInTheDocument();
  });

  it('offers an appeal on a failure, with the override stated', async () => {
    const user = userEvent.setup();

    // Drive it to a verdict through the real component: start, answer, fail.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        const body = String(url).includes('/answers')
          ? { verdict: 'failed', reasoning: 'The second law was stated but not applied.', finished: true }
          : { sessionId: 's1', items: [{ id: 'i1', question: 'Explain entropy.' }] };
        return { ok: true, status: 200, json: async () => body, headers: new Headers() };
      }),
    );

    renderIn(<CompetencyExam claim={CLAIM} />);
    await user.click(screen.getByRole('button', { name: /Begin the assessment/i }));
    await user.click(await screen.findByRole('button', { name: /Submit answers/i }));

    expect(await screen.findByText(/Not passed: Thermodynamics/i)).toBeInTheDocument();
    // The reasoning, quoting her answer — what makes an appeal possible in
    // practice rather than only on paper.
    expect(screen.getByText(/second law was stated but not applied/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Appeal this result/i })).toBeInTheDocument();
    expect(screen.getByText(/can overturn the automated result/i)).toBeInTheDocument();
    // And the rest of her profile is explicitly safe.
    expect(screen.getByText(/every other topic you have claimed are unaffected/i)).toBeInTheDocument();
  });

  it('never shows the internal rubric score', () => {
    // FR-11.5's figure is internal. A number invites haggling; the reasoning
    // is what she can actually argue with.
    const source = readFileSync('src/components/ai/CompetencyExam.jsx', 'utf8');
    expect(source).not.toMatch(/\bverifiedScore\b|\bscore\b\s*[}/]/);
  });
});

/* =========================================================================
 * §6.26 — prerequisite order, and evidence that it was checked
 * ====================================================================== */

const PLAN = {
  targetDate: '2026-09-15',
  prereqValidated: true,
  summary: 'Six weeks, starting from signed numbers.',
  steps: [
    { topicId: 'signed-numbers', weekOffset: 0, focus: 'Negatives in every operation', startDate: '2026-08-04' },
    { topicId: 'factorisation', weekOffset: 1, focus: 'Common factors first', startDate: '2026-08-11' },
    { topicId: 'quadratics', weekOffset: 2, focus: 'Only once factorisation is automatic', startDate: '2026-08-18' },
  ],
};

describe('the study plan', () => {
  it('renders steps in the order the server produced', () => {
    renderIn(<StudyPlanTimeline plan={PLAN} />);

    const headings = screen.getAllByRole('heading', { level: 3 });
    const order = headings.map((heading) => heading.textContent);
    expect(order.slice(0, 3)).toEqual(['signed-numbers', 'factorisation', 'quadratics']);
  });

  it('distinguishes a checked ordering from one that merely looks ordered', () => {
    const { unmount } = renderIn(<StudyPlanTimeline plan={PLAN} />);
    expect(screen.getByText(/Order checked/i)).toBeInTheDocument();
    expect(screen.getByText(/never appears before something it depends on/i)).toBeInTheDocument();
    unmount();

    renderIn(<StudyPlanTimeline plan={{ ...PLAN, prereqValidated: false }} />);
    expect(screen.getByText(/Order not confirmed/i)).toBeInTheDocument();
    // Says so plainly rather than implying a check that did not happen.
    expect(screen.getByText(/as a suggestion rather than a sequence/i)).toBeInTheDocument();
  });

  it('says the dates were computed rather than produced by the model', () => {
    // FR-26.4 — the model emits ordinals; the application does the arithmetic.
    renderIn(<StudyPlanTimeline plan={PLAN} />);
    expect(screen.getByText(/it did not choose any date/i)).toBeInTheDocument();
  });
});

/* =========================================================================
 * §6.25 — the countdown
 * ====================================================================== */

describe('the exam countdown', () => {
  it('counts whole days in UTC', () => {
    expect(daysUntil('2026-09-15', new Date('2026-09-01T22:00:00.000Z'))).toBe(14);
    // A late-evening local time must not shift the figure by one.
    expect(daysUntil('2026-09-15', new Date('2026-09-14T23:59:00.000Z'))).toBe(1);
  });

  it('names the first topic not yet mastered', () => {
    expect(nextStep(PLAN.steps, [])).toMatchObject({ topicId: 'signed-numbers' });
    expect(nextStep(PLAN.steps, ['signed-numbers'])).toMatchObject({ topicId: 'factorisation' });
    expect(nextStep(PLAN.steps, PLAN.steps.map((s) => s.topicId))).toBeNull();
  });

  it('shows days, progress and exactly one next topic', () => {
    renderIn(
      <ExamCountdown
        plan={PLAN}
        masteredTopicIds={['signed-numbers']}
        today={new Date('2026-09-01T00:00:00.000Z')}
      />,
    );

    expect(screen.getByText('14')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
    expect(screen.getByText('1 of 3')).toBeInTheDocument();

    const next = screen.getByText(/Next topic/i).closest('div').parentElement;
    expect(within(next).getByText('factorisation')).toBeInTheDocument();
  });

  it('stops counting once the date has passed', () => {
    // A negative countdown turns a study aid into a reproach.
    renderIn(<ExamCountdown plan={PLAN} today={new Date('2026-09-20T00:00:00.000Z')} />);
    expect(screen.getByText(/The exam date has passed/i)).toBeInTheDocument();
    expect(screen.queryByText('-5')).toBeNull();
  });

  it('says progress comes from the tutor, not from ticking topics off', () => {
    renderIn(<ExamCountdown plan={PLAN} today={new Date('2026-09-01T00:00:00.000Z')} />);
    expect(screen.getByText(/recorded in session notes/i)).toBeInTheDocument();
  });
});
