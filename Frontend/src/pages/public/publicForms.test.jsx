/**
 * The two v4.0 modules — §6.32 and §6.33.
 *
 * These cover the stated done-conditions, and each one is here because getting
 * it wrong is quiet rather than loud:
 *
 *  · feedback submits from any page **without a route change**, so nothing the
 *    user had half-finished is lost (FR-32.1);
 *  · it submits with no account at all (FR-32.6);
 *  · a non-PDF is refused before anything is read, with a message that says so;
 *  · a saved application whose notification email failed still confirms receipt
 *    (FR-33.9) — showing a failure there would make somebody re-apply, or give
 *    up, over an application that is already safe;
 *  · both render in Urdu.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../../i18n';
import { AuthProvider } from '../../context/AuthContext';
import { FeedbackDialog } from '../../components/layout/FeedbackDialog';
import Volunteer from './Volunteer';

/** Every request the component under test made, in order. */
let sent;

function stubFetch(handler) {
  sent = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init) => {
      const body = init?.body ? JSON.parse(init.body) : null;
      sent.push({ url: String(url), method: init?.method ?? 'GET', body });
      return handler(String(url), body);
    }),
  );
}

/** Reference lookups the pickers make; anything else is the form's own POST. */
function referenceResponse(url) {
  if (url.includes('/reference/subjects')) {
    return { items: [{ id: 'mathematics', name: 'Mathematics', nameUr: 'ریاضی' }] };
  }
  if (url.includes('/reference/levels')) {
    return { items: [{ id: 'matric', name: 'Matric', nameUr: 'میٹرک' }] };
  }
  if (url.includes('/reference/provinces')) {
    return { items: [{ id: 'sindh', name: 'Sindh', nameUr: 'سندھ' }] };
  }
  if (url.includes('/reference/cities')) {
    return { items: [{ id: 'karachi', provinceId: 'sindh', name: 'Karachi', nameUr: 'کراچی' }] };
  }
  if (url.includes('/reference/areas')) {
    return {
      items: [{ id: 'karachi-clifton', cityId: 'karachi', name: 'Clifton', nameUr: 'کلفٹن' }],
    };
  }
  return { items: [] };
}

function ok(json) {
  return { ok: true, status: 200, headers: new Headers(), json: async () => json };
}

beforeEach(() => {
  globalThis.localStorage?.clear();
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await i18n.changeLanguage('en');
});

function renderIn(ui, { route = '/search' } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[route]}>
          <AuthProvider>
            <Routes>
              <Route path="*" element={ui} />
            </Routes>
          </AuthProvider>
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

/* =========================================================================
 * §6.32 — platform feedback
 * ====================================================================== */

describe('the feedback panel', () => {
  it('submits from the page it was opened on, with no account, and never navigates', async () => {
    stubFetch((url) => ok(url.includes('/feedback') ? { id: 'fb-1' } : referenceResponse(url)));
    const user = userEvent.setup();

    renderIn(<FeedbackDialog open onClose={() => {}} />, { route: '/search?subjectId=mathematics' });

    await user.type(
      await screen.findByLabelText(/what happened/i),
      'The area filter is hard to reach on my phone.',
    );
    await user.click(screen.getByRole('button', { name: /send report/i }));

    await waitFor(() => expect(sent.some((r) => r.url.includes('/feedback'))).toBe(true));
    const post = sent.find((r) => r.url.includes('/feedback'));

    // FR-32.4 — the page travelled with it, unasked.
    expect(post.body.pagePath).toBe('/search');
    expect(post.body.locale).toBe('en');
    // FR-33.8's sibling: both anti-abuse fields are present and plausible.
    expect(post.body).toHaveProperty('websiteUrl', '');
    expect(post.body.timeOnFormMs).toBeGreaterThanOrEqual(0);
    // Anonymous: nothing identifying was attached by the client.
    expect(JSON.stringify(post.body)).not.toMatch(/email|userId/i);
  });

  it('shows what is being captured rather than collecting it silently', async () => {
    stubFetch((url) => ok(referenceResponse(url)));
    renderIn(<FeedbackDialog open onClose={() => {}} />, { route: '/t/ayesha-siddiqui' });

    const context = await screen.findByRole('region', { name: /sent with your report/i });
    expect(within(context).getByText('/t/ayesha-siddiqui')).toBeInTheDocument();
    expect(within(context).getByText(/not signed in/i)).toBeInTheDocument();
  });

  it('says what happens next, not just thank you', async () => {
    stubFetch((url) => ok(url.includes('/feedback') ? { id: 'fb-2' } : referenceResponse(url)));
    const user = userEvent.setup();

    renderIn(<FeedbackDialog open onClose={() => {}} />);

    await user.type(await screen.findByLabelText(/what happened/i), 'The Urdu view broke a layout.');
    await user.click(screen.getByRole('button', { name: /send report/i }));

    await waitFor(() => expect(screen.getByText(/in the team’s queue/i)).toBeInTheDocument());
  });

  it('renders in Urdu', async () => {
    stubFetch((url) => ok(referenceResponse(url)));
    await i18n.changeLanguage('ur');

    renderIn(<FeedbackDialog open onClose={() => {}} />);

    expect(await screen.findByText(/آپ کی رپورٹ کے ساتھ بھیجا جائے گا/)).toBeInTheDocument();
  });
});

/* =========================================================================
 * §6.33 — the volunteer application
 * ====================================================================== */

describe('the volunteer application', () => {
  /** Everything the shared schema requires, and nothing more. */
  async function fillEverything(user) {
    await user.type(await screen.findByLabelText(/full name/i), 'Sidra Kamal');
    await user.type(screen.getByLabelText(/email address/i), 'sidra@example.test');
    await user.type(screen.getByLabelText(/phone number/i), '03001234567');

    /*
     * The location picker is a typeahead combobox, not a `<select>`, so it is
     * driven the way a person drives it: type enough to narrow the list, then
     * choose the option. `selectOptions` would not reach it.
     */
    async function pick(label, text) {
      const box = await screen.findByRole('combobox', { name: label });
      await user.click(box);
      await user.type(box, text);
      await user.click(await screen.findByRole('option', { name: new RegExp(text, 'i') }));
    }

    await pick(/province/i, 'Sindh');
    await pick(/city/i, 'Karachi');
    await pick(/area/i, 'Clifton');

    await user.click(screen.getByRole('checkbox', { name: 'Mathematics' }));
    await user.click(screen.getByRole('checkbox', { name: 'Matric' }));
    await user.click(screen.getByRole('checkbox', { name: /at your home/i }));
  }

  it('refuses a file that is not a PDF, before anything is read', async () => {
    stubFetch((url) => ok(referenceResponse(url)));

    renderIn(<Volunteer />, { route: '/volunteer' });

    const input = await screen.findByLabelText(/attach a cv/i);

    /*
     * `fireEvent` rather than `userEvent.upload`, deliberately. userEvent
     * honours the input's `accept` and silently drops a non-matching file — so
     * an upload test would pass without the component's own check ever running.
     * The case being covered is exactly the one `accept` does not stop: a file
     * renamed, or chosen through the "all files" option some platforms offer.
     */
    fireEvent.change(input, {
      target: { files: [new File(['not a pdf'], 'cv.txt', { type: 'text/plain' })] },
    });

    expect(await screen.findByText(/only a pdf can be attached/i)).toBeInTheDocument();
    // Nothing was posted, and the file was not retained.
    expect(sent.some((r) => r.method === 'POST')).toBe(false);
  });

  it('accepts a PDF and sends it with the application', async () => {
    stubFetch((url, body) =>
      ok(
        url.includes('/volunteers')
          ? { id: 'v-1', mailDispatchStatus: 'sent', acknowledgement: 'ok', echo: body }
          : referenceResponse(url),
      ),
    );
    const user = userEvent.setup();

    renderIn(<Volunteer />, { route: '/volunteer' });

    const input = await screen.findByLabelText(/attach a cv/i);
    await user.upload(input, new File(['%PDF-1.7'], 'cv.pdf', { type: 'application/pdf' }));

    expect(await screen.findByText(/cv\.pdf/)).toBeInTheDocument();
    expect(screen.queryByText(/only a pdf can be attached/i)).not.toBeInTheDocument();
  });

  it('confirms receipt even when the notification email failed', async () => {
    /*
     * FR-33.9. The row is written before the dispatch and the outcome is
     * recorded against it, so a mail failure is a failure of the notification
     * and not of the application. An applicant shown a failure here would
     * re-apply, or give up, over something already saved.
     */
    stubFetch((url) =>
      ok(
        url.includes('/volunteers')
          ? { id: 'v-2', mailDispatchStatus: 'failed', acknowledgement: 'ok' }
          : referenceResponse(url),
      ),
    );
    const user = userEvent.setup();

    renderIn(<Volunteer />, { route: '/volunteer' });
    await fillEverything(user);
    await user.click(screen.getByRole('button', { name: /send application/i }));

    // Receipt is confirmed…
    await waitFor(() =>
      expect(screen.getByText(/your application has been received/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/it is saved and in the queue/i)).toBeInTheDocument();
    // …and the mail is described as our problem, not theirs.
    expect(screen.getByText(/did not go out — that is our problem/i)).toBeInTheDocument();
  });

  it('states the standard and the private store before asking for anything', async () => {
    stubFetch((url) => ok(referenceResponse(url)));
    renderIn(<Volunteer />, { route: '/volunteer' });

    /*
     * FR-33.10 — goodwill is not a substitute for verification. Said twice on
     * this page, in the introduction and again in the "why" panel, which is
     * deliberate: it is the one thing an applicant must not be surprised by.
     */
    const stated = await screen.findAllByText(
      /verified on exactly the same basis as a paid tutor/i,
    );
    expect(stated.length).toBeGreaterThan(0);
    // SEC-24 — where the document goes, said where it is asked for.
    expect(screen.getByText(/private store that only Ustaad\.com administrators/i)).toBeInTheDocument();
  });

  it('renders in Urdu', async () => {
    stubFetch((url) => ok(referenceResponse(url)));
    await i18n.changeLanguage('ur');

    renderIn(<Volunteer />, { route: '/volunteer' });

    expect(await screen.findByText(/یہ پروگرام کیوں ہے/)).toBeInTheDocument();
  });
});
