/**
 * The administrator surface — §6.6, §6.14, §6.32, §6.33.
 *
 * These cover the three stated done-conditions, and one property that is easy
 * to lose by accident:
 *
 *  · the badge preview is the **public** badge — same function, same input —
 *    and there is no field anywhere on the screen to type one into;
 *  · feedback triage moves an item on and records a disposition note;
 *  · approving a volunteer says, before the button, that it does not verify
 *    anybody — the failure FR-33.10 exists to prevent is an administrator who
 *    believes they have just vetted somebody;
 *  · no decision can be recorded without a written reason.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildBadges } from '@shared/badges';

import i18n from '../../i18n';
import { ToastProvider } from '../../context/ToastContext';
import AdminFeedback from './Feedback';
import AdminVerifications from './Verifications';
import AdminVolunteers from './Volunteers';

let sent;

function stubFetch(handler) {
  sent = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init) => {
      const body = init?.body ? JSON.parse(init.body) : null;
      sent.push({ url: String(url), method: init?.method ?? 'GET', body });
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => handler(String(url), body),
      };
    }),
  );
}

beforeEach(() => globalThis.localStorage?.clear());

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await i18n.changeLanguage('en');
});

function renderAt(route, path, element) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <ToastProvider>
          <MemoryRouter initialEntries={[route]}>
            <Routes>
              <Route path={path} element={element} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

/* =========================================================================
 * The verification dossier
 * ====================================================================== */

describe('the verification screen', () => {
  const DOSSIER = {
    documents: [{ id: 'doc-1', docType: 'cnic', uploadedAt: '2026-05-01T00:00:00.000Z' }],
    history: [],
    auditTrail: [],
  };

  it('previews the public badge from the ticks, and offers no way to type one', async () => {
    stubFetch(() => DOSSIER);
    const user = userEvent.setup();

    renderAt('/admin/verifications/t-1', '/admin/verifications/:tutorId', <AdminVerifications />);

    const checklist = within(
      await screen.findByRole('group', { name: /what you have checked/i }),
    );
    await user.click(checklist.getByRole('checkbox', { name: 'CNIC' }));

    /*
     * The assertion that matters: the text on screen is what `buildBadges`
     * produces for that tick — the same call the public profile makes. If the
     * preview ever drifts into being its own copy, this fails.
     */
    const [expected] = buildBadges({ artefactsChecked: ['cnic'] }).badges;
    expect(await screen.findByText(expected.text)).toBeInTheDocument();

    // SEC-6 — the scope note travels with the badge, not in a footnote.
    expect(screen.getByText(/No police check, background check/i)).toBeInTheDocument();

    /*
     * And there is no badge input. Every textbox on this screen is the reason
     * field; a free-text badge is not representable here, which is the point.
     */
    const textboxes = screen.getAllByRole('textbox');
    for (const box of textboxes) {
      expect(box.getAttribute('id')).toBe('reason');
    }
  });

  it('refuses to record a decision without a written reason', async () => {
    stubFetch(() => DOSSIER);
    const user = userEvent.setup();

    renderAt('/admin/verifications/t-1', '/admin/verifications/:tutorId', <AdminVerifications />);

    const checklist = within(
      await screen.findByRole('group', { name: /what you have checked/i }),
    );
    await user.click(checklist.getByRole('checkbox', { name: 'CNIC' }));
    await user.click(screen.getByRole('button', { name: 'Approve' }));

    expect(await screen.findByText(/A written reason is required/i)).toBeInTheDocument();
    expect(sent.some((r) => r.url.includes('/approve'))).toBe(false);
  });

  it('sends the ticked artefacts and the reason on approval', async () => {
    stubFetch(() => DOSSIER);
    const user = userEvent.setup();

    renderAt('/admin/verifications/t-1', '/admin/verifications/:tutorId', <AdminVerifications />);

    const checklist = within(
      await screen.findByRole('group', { name: /what you have checked/i }),
    );
    await user.click(checklist.getByRole('checkbox', { name: 'CNIC' }));
    await user.click(checklist.getByRole('checkbox', { name: 'Degree' }));
    await user.type(
      screen.getByLabelText(/^Reason/i),
      'CNIC and degree both opened and legible; name and date of birth match.',
    );
    await user.click(screen.getByRole('button', { name: 'Approve' }));

    await waitFor(() => expect(sent.some((r) => r.url.includes('/approve'))).toBe(true));
    const post = sent.find((r) => r.url.includes('/approve'));
    expect(post.body.artefactsChecked).toEqual(['cnic', 'degree']);
    expect(post.body.reason.length).toBeGreaterThanOrEqual(15);
  });
});

/* =========================================================================
 * Feedback triage
 * ====================================================================== */

describe('feedback triage', () => {
  const ITEM = {
    id: 'fb-1',
    category: 'defect',
    status: 'new',
    detail: 'The area filter does not open on my phone.',
    pagePath: '/search',
    locale: 'en',
    createdAt: '2026-05-02T00:00:00.000Z',
    safetyConcernFlag: false,
  };

  it('moves an item on with a disposition note', async () => {
    stubFetch((url) => (url.includes('safetyOnly') ? { items: [] } : { items: [ITEM] }));
    const user = userEvent.setup();

    renderAt('/admin/feedback', '/admin/feedback', <AdminFeedback />);

    await user.click(await screen.findByRole('button', { name: /move it on/i }));
    await user.type(
      screen.getByLabelText(/^Reason/i),
      'Reproduced on a 360px viewport; raised with the search work.',
    );
    await user.click(screen.getByRole('button', { name: 'Triaged' }));

    await waitFor(() => expect(sent.some((r) => r.url.includes('/triage'))).toBe(true));
    const post = sent.find((r) => r.url.includes('/triage'));
    expect(post.body.status).toBe('triaged');
    expect(post.body.dispositionNote.length).toBeGreaterThanOrEqual(3);
  });

  it('pins safety concerns above the rest', async () => {
    const safety = { ...ITEM, id: 'fb-2', category: 'content_or_safety', detail: 'A safety worry.' };
    stubFetch((url) => (url.includes('safetyOnly') ? { items: [safety] } : { items: [ITEM] }));

    renderAt('/admin/feedback', '/admin/feedback', <AdminFeedback />);

    const pinned = await screen.findByRole('region', { name: /safety concerns, first/i });
    expect(within(pinned).getByText('A safety worry.')).toBeInTheDocument();
    // And the note explaining that it is never shown to the tutor concerned.
    expect(screen.getByText(/never shown to the tutor concerned/i)).toBeInTheDocument();
  });
});

/* =========================================================================
 * Volunteer approval
 * ====================================================================== */

describe('volunteer approval', () => {
  const APPLICATION = {
    id: 'v-1',
    fullName: 'Sidra Kamal',
    email: 'sidra@example.test',
    phone: '03001234567',
    areaId: 'karachi-clifton',
    weeklyHours: 6,
    status: 'received',
    createdAt: '2026-05-03T00:00:00.000Z',
    motivation: 'I was taught free when my family could not pay.',
  };

  it('states that approving is not verifying, before the button', async () => {
    stubFetch((url) =>
      url.includes('/volunteers/v-1')
        ? { application: APPLICATION, documentUrl: null, priorApplications: [] }
        : { applications: [APPLICATION] },
    );
    const user = userEvent.setup();

    renderAt('/admin/volunteers', '/admin/volunteers', <AdminVolunteers />);

    await user.click(
      await screen.findByRole('button', { name: /approve and create the tutor account/i }),
    );

    /*
     * FR-33.10's whole point. An administrator who has read a good application
     * and clicked approve feels like they have vetted somebody; if the screen
     * lets that stand, an unverified volunteer reaches a family home.
     */
    expect(await screen.findByText(/Approving is not verifying/i)).toBeInTheDocument();
    expect(
      screen.getByText(/puts it in the verification queue.*does not make anybody searchable/is),
    ).toBeInTheDocument();
  });
});
