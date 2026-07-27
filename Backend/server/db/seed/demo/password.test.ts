/**
 * The credential rule for the demonstration seed — FR-15.9.
 *
 * The seed used to refuse Postgres outright, and that refusal was the whole
 * control: nothing invented could reach a database on the internet because
 * nothing invented could be written there at all. It is now narrower — the
 * people may be seeded into a deployment, because a site nobody can sign into
 * demonstrates nothing — so the control that remains is exactly one function.
 *
 * A published password on a database reachable from the internet is the thing
 * being prevented. `demoPasswordFor` is the only thing preventing it, which is
 * why it is tested here directly rather than inferred from the exit code of a
 * script somebody has to remember to run.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { demoPasswordFor } from './index';
import { DEMO_PASSWORD } from './people';

const restore = process.env.DEMO_SEED_PASSWORD;

afterEach(() => {
  if (restore === undefined) delete process.env.DEMO_SEED_PASSWORD;
  else process.env.DEMO_SEED_PASSWORD = restore;
});

describe('the password the demonstration seed writes', () => {
  it('is the published one against SQLite — which is the point of publishing it', () => {
    delete process.env.DEMO_SEED_PASSWORD;
    expect(demoPasswordFor('sqlite')).toBe(DEMO_PASSWORD);
  });

  it('does not exist against Postgres unless the operator chose one', () => {
    delete process.env.DEMO_SEED_PASSWORD;
    expect(() => demoPasswordFor('postgres')).toThrow(/DEMO_SEED_PASSWORD/);
  });

  it('is never the published one against Postgres, in any casing or padding', () => {
    // The one credential a stranger reading this public repository already
    // knows is the one credential an internet-facing database must refuse.
    for (const attempt of [DEMO_PASSWORD, DEMO_PASSWORD.toUpperCase(), ` ${DEMO_PASSWORD} `]) {
      process.env.DEMO_SEED_PASSWORD = attempt;
      expect(() => demoPasswordFor('postgres'), attempt).toThrow(/published/);
    }
  });

  it('refuses a chosen password short enough to be worth guessing', () => {
    process.env.DEMO_SEED_PASSWORD = 'short';
    expect(() => demoPasswordFor('postgres')).toThrow(/12 characters/);
  });

  it('accepts a chosen password, and writes that one', () => {
    process.env.DEMO_SEED_PASSWORD = 'a-password-nobody-published';
    expect(demoPasswordFor('postgres')).toBe('a-password-nobody-published');
  });
});
