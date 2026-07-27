/**
 * Booking and payment transparency — §6.8, §6.20, §6.30, §6.31.
 *
 * The stated done-conditions, plus the two properties that fail silently:
 *
 *  · **no payment screen implies the platform handles money** — asserted
 *    structurally across every payment source file, because a "Pay now" button
 *    added in good faith is exactly the kind of thing a reviewer waves through;
 *  · **the fit check promises privacy on the form itself** — the promise is
 *    what makes the answers candid, so its absence is a real defect and not a
 *    copy nitpick;
 *  · a state the server would reject is **not clickable**;
 *  · a payment reaches settled only through **both** acknowledgements.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { allowedTransitionsFrom } from '@shared/booking-status';

import i18n from '../../i18n';
import { BookingActions } from './BookingActions';
import { FitCheckForm } from './FitCheck';
import { SlotCalendar } from './SlotCalendar';
import { GuardianPresenceNotice, AddressDisclosure } from './SafetyAndDisclosure';
import { PaymentLedger } from '../payments/PaymentLedger';
import { ToastProvider } from '../../context/ToastContext';

beforeEach(() => {
  i18n.changeLanguage('en');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}), headers: new Headers() })),
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

const SLOTS = [
  {
    startsAt: '2026-08-03T11:00:00.000Z',
    endsAt: '2026-08-03T12:00:00.000Z',
    date: '2026-08-03',
    localStart: '16:00',
    localEnd: '17:00',
    mode: 'home',
    areaId: null,
  },
  {
    startsAt: '2026-08-03T12:00:00.000Z',
    endsAt: '2026-08-03T13:00:00.000Z',
    date: '2026-08-03',
    localStart: '17:00',
    localEnd: '18:00',
    mode: 'home',
    areaId: null,
  },
];

/* =========================================================================
 * FR-8.3 — conflicts are unselectable, not rejected
 * ====================================================================== */

describe('the availability calendar', () => {
  it('offers only the free times the server returned', () => {
    renderIn(<SlotCalendar slots={SLOTS} onChange={() => {}} />);

    const options = screen.getAllByRole('radio');
    expect(options).toHaveLength(2);
    // Every rendered option is choosable. A taken slot is not in the data, so
    // there is deliberately no disabled "already booked" tile to find.
    for (const option of options) expect(option).toBeEnabled();
  });

  it('says why a time somebody expected is missing', () => {
    renderIn(<SlotCalendar slots={SLOTS} onChange={() => {}} />);
    expect(screen.getByText(/Only times the tutor is actually free/i)).toBeInTheDocument();
  });

  it('shows the tutor’s own wall-clock times, not a converted instant', () => {
    // The server sends `localStart` as the tutor wrote it. Reformatting the
    // UTC instant in the browser would put a device timezone between two
    // people in the same city.
    renderIn(<SlotCalendar slots={SLOTS} onChange={() => {}} />);
    expect(screen.getByRole('radio', { name: '16:00–17:00' })).toBeInTheDocument();
  });
});

/* =========================================================================
 * SEC-19, SEC-20 — nobody is surprised
 * ====================================================================== */

describe('the tutor’s declared conditions', () => {
  it('asks for the guardian acknowledgement before submission', () => {
    renderIn(
      <GuardianPresenceNotice
        safety={{ guardianPresenceRequired: true, femaleStudentsOnly: false }}
        onAcknowledge={() => {}}
      />,
    );

    expect(screen.getByText(/only with a parent or guardian present/i)).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: /guardian will be present/i }),
    ).toBeInTheDocument();
    // Stated as enforcement, not as a preference she might be talked out of.
    expect(screen.getByText(/enforces these/i)).toBeInTheDocument();
  });

  it('says her declines under it do not count against her', () => {
    renderIn(
      <GuardianPresenceNotice
        safety={{ guardianPresenceRequired: true, femaleStudentsOnly: false }}
        onAcknowledge={() => {}}
      />,
    );
    expect(screen.getByText(/do not count against her statistics/i)).toBeInTheDocument();
  });

  it('renders nothing when she has declared none', () => {
    const { container } = renderIn(
      <GuardianPresenceNotice
        safety={{ guardianPresenceRequired: false, femaleStudentsOnly: false }}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe('the address rule is stated to both sides', () => {
  it('tells the family the tutor sees the area first and the street after', () => {
    renderIn(<AddressDisclosure audience="family" />);
    expect(screen.getByText(/only your area/i)).toBeInTheDocument();
    expect(screen.getByText(/After she confirms, she sees the full address/i)).toBeInTheDocument();
    expect(screen.getByText(/Nobody else ever sees it/i)).toBeInTheDocument();
  });

  it('tells the tutor the same rule from her side', () => {
    renderIn(<AddressDisclosure audience="tutor" />);
    expect(screen.getByText(/you see the area only/i)).toBeInTheDocument();
    expect(screen.getByText(/Once you confirm, you see the full address/i)).toBeInTheDocument();
  });
});

/* =========================================================================
 * FR-8.4 — a state the server would reject is not clickable
 * ====================================================================== */

describe('lifecycle actions', () => {
  it('offers nothing on a completed booking', () => {
    // `completed` is terminal in the shared table — reviews, payment records
    // and the progress ledger all hang off it.
    expect(allowedTransitionsFrom('completed')).toHaveLength(0);

    renderIn(
      <BookingActions booking={{ id: 'b1', status: 'completed' }} viewerParty="tutor" />,
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(/not reopened/i)).toBeInTheDocument();
  });

  it('never offers a move the shared table forbids', () => {
    // `confirmed` cannot go back to `requested`, and cannot be declined.
    renderIn(
      <BookingActions booking={{ id: 'b1', status: 'confirmed' }} viewerParty="tutor" />,
    );

    const labels = screen.getAllByRole('button').map((button) => button.textContent);
    expect(labels.join(' ')).not.toMatch(/Decline/i);

    const legal = allowedTransitionsFrom('confirmed');
    expect(legal).toContain('in_progress');
    expect(legal).not.toContain('declined');
  });

  it('offers the family no action that belongs to the tutor', () => {
    renderIn(
      <BookingActions booking={{ id: 'b1', status: 'requested' }} viewerParty="family" />,
    );

    const labels = screen.getAllByRole('button').map((button) => button.textContent);
    expect(labels.join(' ')).not.toMatch(/Confirm booking|Decline/i);
    expect(labels.join(' ')).toMatch(/Cancel booking/i);
  });
});

/* =========================================================================
 * §6.20, SEC-15 — the fit check is private, and says so
 * ====================================================================== */

describe('the trial fit check', () => {
  it('states on the form that the tutor never sees it', () => {
    renderIn(<FitCheckForm bookingId="b1" />);

    const notice = screen.getByText(/The tutor never sees this/i);
    expect(notice).toBeInTheDocument();
    // Not fine print — it is the sentence that makes the answers candid.
    expect(notice.className).not.toMatch(/text-caption/);
    expect(screen.getByText(/does not affect her ranking/i)).toBeInTheDocument();
  });

  it('asks all four dimensions and the continue decision', () => {
    renderIn(<FitCheckForm bookingId="b1" />);

    for (const label of [/Communication/i, /Punctuality/i, /Engagement/i, /Pace/i]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText(/Would you continue with this tutor/i)).toBeInTheDocument();
  });

  it('makes "no" exactly as easy to choose as "yes"', () => {
    // A checkbox defaulted to "continue" would be a thumb on the scale.
    renderIn(<FitCheckForm bookingId="b1" />);

    const yes = screen.getByRole('radio', { name: /Yes, continue/i });
    const no = screen.getByRole('radio', { name: /No, look for someone else/i });
    expect(yes).not.toBeChecked();
    expect(no).not.toBeChecked();
  });
});

/* =========================================================================
 * §6.31 — both acknowledgements, or it is not settled
 * ====================================================================== */

const LINE = {
  recordId: 'p1',
  cycleLabel: 'August 2026',
  agreedAmount: 1200000,
  travelCharge: 50000,
  totalAgreed: 1250000,
  disputes: [],
  createdAt: '2026-08-01T00:00:00.000Z',
};

function statementWith(overrides) {
  const line = { ...LINE, ...overrides };
  return {
    lines: [line],
    totalSettled: line.status === 'settled' ? line.totalAgreed : 0,
    totalOutstanding: line.status === 'settled' ? 0 : line.totalAgreed,
  };
}

describe('the payment record', () => {
  it('shows a one-sided claim as a claim, not as a payment', () => {
    renderIn(
      <PaymentLedger
        bookingId="b1"
        viewerParty="tutor"
        statement={statementWith({
          status: 'family_marked',
          acknowledgement: { familyHasMarkedPaid: true, tutorHasConfirmed: false },
        })}
      />,
    );

    expect(screen.getByText(/The family has marked this paid\./i)).toBeInTheDocument();
    expect(screen.getByText(/The tutor has not confirmed receiving it yet\./i)).toBeInTheDocument();
    // It has not settled, and the total reflects that.
    expect(screen.queryByText(/Confirmed by both$/)).toBeNull();
  });

  it('reaches settled only when both parties have acknowledged', () => {
    renderIn(
      <PaymentLedger
        bookingId="b1"
        viewerParty="family"
        statement={statementWith({
          status: 'settled',
          acknowledgement: { familyHasMarkedPaid: true, tutorHasConfirmed: true },
        })}
      />,
    );

    expect(screen.getByText(/The family has marked this paid\./i)).toBeInTheDocument();
    expect(screen.getByText(/The tutor has confirmed receiving it\./i)).toBeInTheDocument();
  });

  it('records the travel charge as its own line (FR-31.2)', () => {
    renderIn(
      <PaymentLedger
        bookingId="b1"
        viewerParty="family"
        statement={statementWith({
          status: 'pending',
          acknowledgement: { familyHasMarkedPaid: false, tutorHasConfirmed: false },
        })}
      />,
    );

    const table = screen.getByRole('table', { name: /August 2026/i });
    expect(within(table).getByText(/Travel charge/i)).toBeInTheDocument();
    // 50000 paisa = PKR 500, formatted with the currency code — unambiguous
    // in both scripts, which is why the formatter uses `currencyDisplay: code`.
    expect(within(table).getByText(/PKR\s*500/)).toBeInTheDocument();
  });

  it('offers each side only its own acknowledgement', () => {
    const pending = statementWith({
      status: 'pending',
      acknowledgement: { familyHasMarkedPaid: false, tutorHasConfirmed: false },
    });

    const { unmount } = renderIn(
      <PaymentLedger bookingId="b1" viewerParty="family" statement={pending} />,
    );
    expect(screen.getByRole('button', { name: /I have paid this/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /I received this/i })).toBeNull();
    unmount();

    renderIn(<PaymentLedger bookingId="b1" viewerParty="tutor" statement={pending} />);
    expect(screen.getByRole('button', { name: /I received this/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /I have paid this/i })).toBeNull();
  });

  it('offers a dispute path', () => {
    renderIn(
      <PaymentLedger
        bookingId="b1"
        viewerParty="family"
        statement={statementWith({
          status: 'pending',
          acknowledgement: { familyHasMarkedPaid: false, tutorHasConfirmed: false },
        })}
      />,
    );
    expect(screen.getByRole('button', { name: /Raise a dispute/i })).toBeInTheDocument();
  });
});

/* =========================================================================
 * SEC-23 — no screen implies the platform handles money
 * ====================================================================== */

describe('the payment boundary', () => {
  it('is stated wherever a payment record appears', () => {
    renderIn(
      <PaymentLedger
        bookingId="b1"
        viewerParty="family"
        statement={statementWith({
          status: 'pending',
          acknowledgement: { familyHasMarkedPaid: false, tutorHasConfirmed: false },
        })}
      />,
    );

    expect(screen.getByText(/does not process, hold or transfer money/i)).toBeInTheDocument();
    expect(screen.getByText(/directly between the family and the tutor/i)).toBeInTheDocument();
  });

  it('appears nowhere as a pay button, a card field, or a gateway', () => {
    /*
     * Structural, across every source file that touches payment or booking.
     * A "Pay now" button is the kind of thing added in good faith by somebody
     * who has not read §2.6 — the platform has no gateway, no escrow, no
     * payout and no wallet, so a control implying otherwise is a defect even
     * though it would compile and look reasonable in review.
     *
     * Matched against markup only: this file and the components' own headers
     * discuss what is absent, and prose explaining an absence must not trip
     * a check on that absence.
     */
    const roots = ['src/components/payments', 'src/components/booking', 'src/pages/booking', 'src/pages/book'];
    const forbidden = [
      /\bpay\s*now\b/i,
      /\bcard\s*number\b/i,
      /\bcvv\b/i,
      /\bcheckout\b/i,
      /\bstripe\b/i,
      /\bescrow\b/i,
      /\bwallet\b/i,
      /\bpayout\b/i,
    ];

    const offenders = [];

    for (const root of roots) {
      for (const name of readdirSync(root)) {
        if (!/\.jsx?$/.test(name) || name.includes('.test.')) continue;

        const source = readFileSync(join(root, name), 'utf8')
          // Headers and inline notes say what the product deliberately lacks.
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '');

        for (const pattern of forbidden) {
          if (pattern.test(source)) offenders.push(`${root}/${name}: ${pattern}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('is carried by the dictionary too, so it survives translation', () => {
    // A boundary stated only in English is not stated to half the users.
    const en = JSON.parse(readFileSync('src/locales/en/payments.json', 'utf8'));
    const ur = JSON.parse(readFileSync('src/locales/ur/payments.json', 'utf8'));

    expect(en.boundary.body).toMatch(/does not process, hold or transfer money/i);
    expect(ur.boundary.body.length).toBeGreaterThan(40);
    expect(ur.boundary.body).not.toBe(en.boundary.body);
  });
});
