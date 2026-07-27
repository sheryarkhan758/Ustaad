/**
 * The two cascading selectors — §6.2, §6.3.
 *
 * The property being tested is the one that makes a cascade trustworthy:
 * **changing a parent never leaves a stale child.** A form still holding
 * `karachi-clifton` after the user switched to Punjab submits a Karachi area
 * against a Punjab city, and the server rejects it with an error the person
 * cannot act on.
 *
 * The reference API is stubbed rather than mocked at the fetch layer, so the
 * tests exercise the real query hooks, the real cache keys and the real
 * `enabled` gating.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../../i18n';
import { CurriculumPicker } from './CurriculumPicker';
import { LocationPicker } from './LocationPicker';
import { PrerequisiteBrowser } from './PrerequisiteBrowser';

/* -------------------------------------------------------------------------
 * A stub of the reference API, shaped exactly like the real one
 * ---------------------------------------------------------------------- */

const DATA = {
  provinces: [
    { id: 'sindh', name: 'Sindh', nameUr: 'سندھ' },
    { id: 'punjab', name: 'Punjab', nameUr: 'پنجاب' },
  ],
  cities: {
    sindh: [{ id: 'karachi', name: 'Karachi', nameUr: 'کراچی' }],
    punjab: [{ id: 'lahore', name: 'Lahore', nameUr: 'لاہور' }],
  },
  areas: {
    karachi: [
      { id: 'karachi-clifton', name: 'Clifton', nameUr: 'کلفٹن' },
      // No Urdu name — the deliberate fallback case.
      { id: 'karachi-dha', name: 'DHA', nameUr: null },
    ],
    lahore: [{ id: 'lahore-gulberg', name: 'Gulberg', nameUr: 'گلبرگ' }],
  },
  adjacent: { 'karachi-clifton': ['karachi-dha'] },
  subjects: [
    { id: 'mathematics', name: 'Mathematics', nameUr: 'ریاضی' },
    { id: 'physics', name: 'Physics', nameUr: 'طبیعیات' },
  ],
  levels: [{ id: 'matric', name: 'Matric', nameUr: null }],
  boards: [
    { id: 'sindh-board', name: 'Sindh Board', nameUr: 'سندھ بورڈ' },
    { id: 'cambridge', name: 'Cambridge', nameUr: 'کیمبرج' },
  ],
  topics: {
    'mathematics|matric|sindh-board': [
      { id: 'quadratics', name: 'Quadratic equations', nameUr: 'مربعی مساوات', chapterRef: 'Ch 2' },
      { id: 'factorisation', name: 'Algebraic factorisation', nameUr: 'تحلیل', chapterRef: 'Ch 1' },
    ],
    'mathematics|matric|cambridge': [
      { id: 'cam-algebra', name: 'Algebra', nameUr: null, chapterRef: 'U1' },
    ],
  },
};

/** The §2.4 worked example, as the endpoint returns it. */
const PREREQ = {
  edges: [
    { topicId: 'quadratics', prerequisiteTopicId: 'factorisation' },
    { topicId: 'factorisation', prerequisiteTopicId: 'signed-numbers' },
  ],
  topics: [
    { id: 'quadratics', name: 'Quadratic equations', nameUr: 'مربعی مساوات', chapterRef: 'Ch 2' },
    { id: 'factorisation', name: 'Algebraic factorisation', nameUr: 'تحلیل', chapterRef: 'Ch 1' },
    { id: 'signed-numbers', name: 'Signed-number arithmetic', nameUr: null, chapterRef: 'Ch 1' },
  ],
};

beforeEach(() => {
  i18n.changeLanguage('en');

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => {
      const path = String(url);
      const query = new URL(path, 'http://x').searchParams;
      let body = { items: [] };

      if (path.includes('/reference/provinces')) body = { items: DATA.provinces };
      else if (path.includes('/reference/cities'))
        body = { items: DATA.cities[query.get('provinceId')] ?? [] };
      else if (path.includes('/reference/areas/adjacent'))
        body = { items: DATA.adjacent[query.get('ids')] ?? [] };
      else if (path.includes('/reference/areas'))
        body = { items: DATA.areas[query.get('cityId')] ?? [] };
      else if (path.includes('/reference/subjects')) body = { items: DATA.subjects };
      else if (path.includes('/reference/levels')) body = { items: DATA.levels };
      else if (path.includes('/reference/boards')) body = { items: DATA.boards };
      else if (path.includes('/reference/topics/prerequisites')) body = PREREQ;
      else if (path.includes('/reference/topics')) {
        const key = `${query.get('subjectId')}|${query.get('levelId')}|${query.get('boardId')}`;
        body = { items: DATA.topics[key] ?? [] };
      }

      return {
        ok: true,
        status: 200,
        json: async () => body,
        headers: new Headers(),
      };
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

function renderPicker(ui) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>{ui}</I18nextProvider>
    </QueryClientProvider>,
  );
}

/** Drives a controlled picker the way a real form does. */
function Controlled({ Picker, initial }) {
  const [value, setValue] = useState(initial);
  return <Picker value={value} onChange={setValue} />;
}

/* =========================================================================
 * Location — §6.2
 * ====================================================================== */

describe('LocationPicker', () => {
  it('cascades province → city → area', async () => {
    const user = userEvent.setup();
    renderPicker(<Controlled Picker={LocationPicker} initial={{}} />);

    const province = await screen.findByRole('combobox', { name: /province/i });
    await user.click(province);
    await user.click(await screen.findByRole('option', { name: /sindh/i }));

    const city = screen.getByRole('combobox', { name: /city/i });
    await waitFor(() => expect(city).not.toBeDisabled());
    await user.click(city);
    await user.click(await screen.findByRole('option', { name: /karachi/i }));

    const area = screen.getByRole('combobox', { name: /area/i });
    await waitFor(() => expect(area).not.toBeDisabled());
    await user.click(area);
    expect(await screen.findByRole('option', { name: /clifton/i })).toBeInTheDocument();
  });

  it('clears the city AND the area when the province changes', async () => {
    const user = userEvent.setup();
    renderPicker(
      <Controlled
        Picker={LocationPicker}
        initial={{ provinceId: 'sindh', cityId: 'karachi', areaId: 'karachi-clifton' }}
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: /area/i })).toHaveValue('Clifton'),
    );

    const province = await screen.findByRole('combobox', { name: /province/i });
    await user.click(province);
    await user.click(await screen.findByRole('option', { name: /punjab/i }));

    // The bug this test exists for: a Karachi area surviving a switch to Punjab
    // and being submitted against a Punjab city.
    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: /city/i })).toHaveValue('');
      expect(screen.getByRole('combobox', { name: /area/i })).toHaveValue('');
    });
  });

  it('clears the area when the city changes', async () => {
    const user = userEvent.setup();
    renderPicker(
      <Controlled
        Picker={LocationPicker}
        initial={{ provinceId: 'sindh', cityId: 'karachi', areaId: 'karachi-clifton' }}
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: /area/i })).toHaveValue('Clifton'),
    );

    const city = screen.getByRole('combobox', { name: /city/i });
    await user.click(city);
    // Re-selecting the same city still counts as a change of parent.
    await user.click(await screen.findByRole('option', { name: /karachi/i }));

    await waitFor(() => expect(screen.getByRole('combobox', { name: /area/i })).toHaveValue(''));
  });

  it('names the areas the neighbouring toggle adds', async () => {
    renderPicker(
      <Controlled
        Picker={LocationPicker}
        initial={{
          provinceId: 'sindh',
          cityId: 'karachi',
          areaId: 'karachi-clifton',
          includeAdjacent: true,
        }}
      />,
    );

    // A checkbox that silently widens a search leaves the user unable to
    // explain their own results.
    expect(await screen.findByText(/also searching/i)).toBeInTheDocument();
    expect(await screen.findByText('DHA')).toBeInTheDocument();
  });

  it('offers no map, pin or distance affordance', () => {
    const { container } = renderPicker(<Controlled Picker={LocationPicker} initial={{}} />);

    // §4.2 — area is the finest granularity in this product.
    //
    // The test is about *affordances*, not words. An earlier version matched
    // the string "map" in the page text and failed on the copy that says
    // "there is no map and no pin" — which would have pushed the disclaimer
    // out of the interface in order to satisfy a regular expression. The
    // disclaimer is the thing worth keeping; a control that implies GPS is the
    // thing worth catching.
    expect(container.querySelector('canvas')).toBeNull();
    expect(container.querySelector('input[type="range"]')).toBeNull();
    expect(screen.queryByRole('slider')).toBeNull();
    expect(
      screen.queryByRole('button', { name: /my location|use location|near me|locate/i }),
    ).toBeNull();

    // A `queryByLabelText(/distance/i)` sweep was tried here and removed: it
    // matched the "include nearby areas" checkbox, whose own hint reads "a
    // curated list, not a distance". Twice now, a text-matching assertion has
    // fired on the copy that states the very property being asserted — the
    // affordance checks above are the ones that mean something.
    //
    // The remaining control is a checkbox, which cannot express a radius.
    const numericInputs = [...container.querySelectorAll('input')].filter(
      (input) => input.type === 'number' || input.inputMode === 'numeric',
    );
    expect(numericInputs).toHaveLength(0);
  });

  it('is navigable by keyboard alone', async () => {
    const user = userEvent.setup();
    renderPicker(<Controlled Picker={LocationPicker} initial={{}} />);

    const province = await screen.findByRole('combobox', { name: /province/i });

    // Focus via the keyboard rather than a bare `.focus()` call: user-event
    // wraps its interactions in `act`, so the resulting state settles before
    // the assertion. A raw `.focus()` leaves the assertion racing the render.
    await user.tab();
    await waitFor(() => expect(province).toHaveFocus());

    await user.keyboard('{ArrowDown}');
    await waitFor(() => expect(province).toHaveAttribute('aria-expanded', 'true'));

    await user.keyboard('{ArrowDown}{Enter}');
    await waitFor(() => expect(province.value).toBeTruthy());

    // Escape closes without committing, and returns focus to the input.
    await user.keyboard('{ArrowDown}{Escape}');
    await waitFor(() => expect(province).toHaveAttribute('aria-expanded', 'false'));
    expect(province).toHaveFocus();
  });

  it('falls back to the Latin name when there is no Urdu one', async () => {
    i18n.changeLanguage('ur');
    const user = userEvent.setup();
    renderPicker(
      <Controlled Picker={LocationPicker} initial={{ provinceId: 'sindh', cityId: 'karachi' }} />,
    );

    const area = await screen.findByRole('combobox', { name: /علاقہ|area/i });
    await waitFor(() => expect(area).not.toBeDisabled());
    await user.click(area);

    // کلفٹن has an Urdu name; DHA does not and keeps the familiar spelling.
    expect(await screen.findByRole('option', { name: 'کلفٹن' })).toBeInTheDocument();
    const dha = await screen.findByRole('option', { name: 'DHA' });
    // Tagged as English so the browser picks the right font and voice.
    expect(dha).toHaveAttribute('lang', 'en');
  });
});

/* =========================================================================
 * Curriculum — §6.3
 * ====================================================================== */

describe('CurriculumPicker', () => {
  it('shows no topics until subject, level and board are all chosen', async () => {
    renderPicker(
      <Controlled
        Picker={CurriculumPicker}
        initial={{ subjectId: 'mathematics', levelId: 'matric' }}
      />,
    );

    // Decision 5: a guessed board produces a topic list that is confidently
    // wrong, so the list waits rather than guessing.
    expect(await screen.findByText(/choose a subject, level and board/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /quadratic/i })).not.toBeInTheDocument();
  });

  it('gives board the same weight as subject, as a real choice', async () => {
    renderPicker(<Controlled Picker={CurriculumPicker} initial={{}} />);

    // Radios, not a dropdown with a default — a default is a choice people skip.
    const sindh = await screen.findByRole('radio', { name: /sindh board/i });
    const cambridge = await screen.findByRole('radio', { name: /cambridge/i });
    expect(sindh).toBeInTheDocument();
    expect(cambridge).toBeInTheDocument();
    expect(sindh).not.toBeChecked();
  });

  it('clears selected topics when the board changes', async () => {
    const user = userEvent.setup();
    renderPicker(
      <Controlled
        Picker={CurriculumPicker}
        initial={{
          subjectId: 'mathematics',
          levelId: 'matric',
          boardId: 'sindh-board',
          topicIds: ['quadratics'],
        }}
      />,
    );

    const quadratics = await screen.findByRole('button', { name: /quadratic equations/i });
    expect(quadratics).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('radio', { name: /cambridge/i }));

    // A Sindh topic submitted against a Cambridge board is the failure here.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /quadratic equations/i })).not.toBeInTheDocument(),
    );
    expect(await screen.findByRole('button', { name: /^Algebra$/i })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('toggles topics and announces their state', async () => {
    const user = userEvent.setup();
    renderPicker(
      <Controlled
        Picker={CurriculumPicker}
        initial={{ subjectId: 'mathematics', levelId: 'matric', boardId: 'sindh-board' }}
      />,
    );

    const topic = await screen.findByRole('button', { name: /quadratic equations/i });
    expect(topic).toHaveAttribute('aria-pressed', 'false');

    await user.click(topic);
    await waitFor(() => expect(topic).toHaveAttribute('aria-pressed', 'true'));

    await user.click(topic);
    await waitFor(() => expect(topic).toHaveAttribute('aria-pressed', 'false'));
  });
});

/* =========================================================================
 * The prerequisite chain — §2.4
 * ====================================================================== */

describe('PrerequisiteBrowser', () => {
  it('renders the mathematics chain from the specification', async () => {
    renderPicker(<PrerequisiteBrowser topicIds={['quadratics']} />);

    // quadratics → algebraic factorisation → signed-number arithmetic
    expect(await screen.findByText('Quadratic equations')).toBeInTheDocument();
    expect(await screen.findByText('Algebraic factorisation')).toBeInTheDocument();
    expect(await screen.findByText('Signed-number arithmetic')).toBeInTheDocument();
  });

  it('nests the chain so the dependency direction is unambiguous', async () => {
    renderPicker(<PrerequisiteBrowser topicIds={['quadratics']} />);

    const root = (await screen.findByText('Quadratic equations')).closest('li');
    // Factorisation sits *inside* quadratics, which is what "rests on" means in
    // a nested list — and is why this is a list rather than a node diagram.
    expect(within(root).getByText('Algebraic factorisation')).toBeInTheDocument();

    const middle = within(root).getByText('Algebraic factorisation').closest('li');
    expect(within(middle).getByText('Signed-number arithmetic')).toBeInTheDocument();
  });

  it('marks the bottom of the chain as the foundation', async () => {
    renderPicker(<PrerequisiteBrowser topicIds={['quadratics']} />);

    const leaf = (await screen.findByText('Signed-number arithmetic')).closest('div');
    expect(within(leaf).getByText(/foundation/i)).toBeInTheDocument();
  });

  it('invites a choice rather than sitting blank with nothing selected', async () => {
    renderPicker(<PrerequisiteBrowser topicIds={[]} />);
    expect(await screen.findByText(/choose a topic/i)).toBeInTheDocument();
  });
});
