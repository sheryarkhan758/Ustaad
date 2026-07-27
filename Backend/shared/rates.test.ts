import { describe, expect, it } from 'vitest';

import {
  RateNormalisationError,
  WEEKS_PER_MONTH,
  formatPaisa,
  monthlyHours,
  normaliseHourlyAmount,
  paisaToRupees,
  prepareRate,
  rupeesToPaisa,
} from './rates';

const PKR = rupeesToPaisa;

describe('unit conversion', () => {
  it('converts rupees to integer paisa', () => {
    expect(PKR(8000)).toBe(800_000);
    expect(PKR(410.26)).toBe(41_026);
  });

  it('round-trips through rupees for display', () => {
    expect(paisaToRupees(41_026)).toBeCloseTo(410.26, 2);
    expect(formatPaisa(41_026)).toBe('410.26');
  });
});

describe('monthlyHours', () => {
  it('uses 52/12 weeks per month, not a flat 4', () => {
    expect(WEEKS_PER_MONTH).toBeCloseTo(4.3333, 4);
    // 3 sessions a week is exactly 13 sessions a month under this convention.
    expect(monthlyHours(3, 90)).toBeCloseTo(19.5, 10);
    // A flat 4 weeks would give 18 hours — the value this deliberately is not.
    expect(monthlyHours(3, 90)).not.toBeCloseTo(18, 6);
  });
});

describe('normaliseHourlyAmount — the specification §2.7 worked case', () => {
  it('normalises PKR 8,000 a month for 3 × 90-minute sessions to PKR 410.26 an hour', () => {
    const normalised = normaliseHourlyAmount({
      rateType: 'monthly',
      amount: PKR(8000),
      sessionsPerWeek: 3,
      minutesPerSession: 90,
    });

    // 800000 paisa ÷ 19.5 hours = 41025.64… → 41026 paisa.
    expect(normalised).toBe(41_026);
    expect(formatPaisa(normalised)).toBe('410.26');
  });

  it('makes an incomparable pair comparable', () => {
    // "PKR 8,000 a month, three days a week" vs "PKR 900 an hour" — the whole
    // point of §2.7 is that no one can compare these by inspection.
    const monthly = normaliseHourlyAmount({
      rateType: 'monthly',
      amount: PKR(8000),
      sessionsPerWeek: 3,
      minutesPerSession: 90,
    });
    const hourly = normaliseHourlyAmount({ rateType: 'hourly', amount: PKR(900) });

    expect(monthly).toBeLessThan(hourly);
    expect(formatPaisa(monthly)).toBe('410.26');
    expect(formatPaisa(hourly)).toBe('900.00');
  });
});

describe('normaliseHourlyAmount — per rate type', () => {
  it('passes an hourly rate through unchanged', () => {
    expect(normaliseHourlyAmount({ rateType: 'hourly', amount: PKR(900) })).toBe(90_000);
  });

  it('scales a single session by its length', () => {
    // PKR 1,200 for 90 minutes is PKR 800 an hour.
    expect(
      normaliseHourlyAmount({
        rateType: 'single_session',
        amount: PKR(1200),
        minutesPerSession: 90,
      }),
    ).toBe(80_000);
  });

  it('never silently treats a single session as a monthly rate', () => {
    const amount = PKR(1200);
    const single = normaliseHourlyAmount({
      rateType: 'single_session',
      amount,
      minutesPerSession: 90,
    });
    const asIfMonthly = normaliseHourlyAmount({
      rateType: 'monthly',
      amount,
      sessionsPerWeek: 3,
      minutesPerSession: 90,
    });

    // The monthly reading understates the session fee roughly thirteenfold.
    // If this assertion ever fails, single-session rates are being folded into
    // the monthly benchmark and every published median is wrong.
    expect(single).toBe(80_000);
    expect(asIfMonthly).toBe(6_154);
    expect(single / asIfMonthly).toBeGreaterThan(12);
  });

  it('normalises a group rate per head, not per tutor', () => {
    // PKR 3,500 per head per month, 2 × 120-minute sessions a week,
    // group of 4. Hours a month = 2 × 4.3333 × 2 = 17.3333.
    const perHead = normaliseHourlyAmount({
      rateType: 'group_monthly',
      amount: PKR(14_000),
      perHeadAmount: PKR(3500),
      sessionsPerWeek: 2,
      minutesPerSession: 120,
      groupSizeMax: 4,
    });

    expect(perHead).toBe(20_192);
    expect(formatPaisa(perHead)).toBe('201.92');

    // A family comparing group tuition against one-to-one must see the
    // per-head figure; using the tutor's total would quadruple it here.
    const asIfTotal = normaliseHourlyAmount({
      rateType: 'monthly',
      amount: PKR(14_000),
      sessionsPerWeek: 2,
      minutesPerSession: 120,
    });
    expect(asIfTotal).toBeGreaterThan(perHead * 3);
  });
});

describe('normaliseHourlyAmount — refuses to guess', () => {
  it('throws when a monthly rate has no session count', () => {
    expect(() =>
      normaliseHourlyAmount({ rateType: 'monthly', amount: PKR(8000), minutesPerSession: 90 }),
    ).toThrow(RateNormalisationError);
  });

  it('throws when a monthly rate has no session length', () => {
    expect(() =>
      normaliseHourlyAmount({ rateType: 'monthly', amount: PKR(8000), sessionsPerWeek: 3 }),
    ).toThrow(RateNormalisationError);
  });

  it('throws when a single session has no length', () => {
    expect(() =>
      normaliseHourlyAmount({ rateType: 'single_session', amount: PKR(1200) }),
    ).toThrow(RateNormalisationError);
  });

  it('throws when a group rate has no per-head amount', () => {
    expect(() =>
      normaliseHourlyAmount({
        rateType: 'group_monthly',
        amount: PKR(14_000),
        sessionsPerWeek: 2,
        minutesPerSession: 120,
        groupSizeMax: 4,
      }),
    ).toThrow(RateNormalisationError);
  });

  it('rejects a zero or negative session length rather than dividing by it', () => {
    expect(() =>
      normaliseHourlyAmount({
        rateType: 'single_session',
        amount: PKR(1200),
        minutesPerSession: 0,
      }),
    ).toThrow(RateNormalisationError);
  });
});

describe('prepareRate', () => {
  it('validates and normalises in one step', () => {
    const rate = prepareRate({
      rateType: 'monthly',
      amount: PKR(8000),
      sessionsPerWeek: 3,
      minutesPerSession: 90,
    });

    expect(rate.normalisedHourlyAmount).toBe(41_026);
    expect(rate.rateType).toBe('monthly');
  });

  it('rejects a monthly rate missing its session fields before any arithmetic', () => {
    expect(() => prepareRate({ rateType: 'monthly', amount: PKR(8000) })).toThrow();
  });

  it('rejects a non-integer amount — money is integer paisa', () => {
    expect(() => prepareRate({ rateType: 'hourly', amount: 900.5 })).toThrow();
  });

  it('rejects an unknown rate type', () => {
    expect(() => prepareRate({ rateType: 'per_semester', amount: 100 })).toThrow();
  });
});
