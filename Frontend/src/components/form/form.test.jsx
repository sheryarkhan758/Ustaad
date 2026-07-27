/**
 * The form layer, and the property the whole task rests on:
 * **the client validates identically to the server.**
 *
 * These tests import the *same* schema objects `Backend/shared/auth.ts`
 * exports, which are the same objects the route handlers validate with. So a
 * disagreement between client and server is not possible by construction — and
 * these tests prove the construction, rather than asserting a list of rules
 * that would itself be a third copy.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';

import { PASSWORD_MIN_LENGTH, REGISTERABLE_ROLES, loginSchema, registerSchema } from '@shared/auth';

import i18n from '../../i18n';
import { FormErrorSummary } from './FormErrorSummary';
import { useZodForm } from './useZodForm';
import { Field, Input } from '../ui/Field';
import { Button } from '../ui/Button';

/* =========================================================================
 * The shared schemas themselves
 * ====================================================================== */

describe('the client uses the server’s own schemas', () => {
  it('never offers admin as a registerable role', () => {
    // FR-1.5. `admin` is absent by construction, not by a check that could be
    // forgotten — an administrator is seeded or promoted, never self-selected.
    expect(REGISTERABLE_ROLES).not.toContain('admin');
    expect([...REGISTERABLE_ROLES].sort()).toEqual(
      ['organisation', 'parent', 'student', 'tutor'].sort(),
    );
  });

  it('offers no role for a minor anywhere in the list', () => {
    // SEC-1, decision 2. A learner under 18 exists only as a student_profiles
    // record owned by a parent — a table with no password and no session.
    for (const role of REGISTERABLE_ROLES) {
      expect(role).not.toMatch(/child|minor|kid|pupil/i);
    }
  });

  it('rejects a short password at exactly the server’s threshold', () => {
    const short = 'a'.repeat(PASSWORD_MIN_LENGTH - 1);
    const ok = 'a'.repeat(PASSWORD_MIN_LENGTH);

    const base = { role: 'parent', email: 'a@b.test', displayName: 'A Parent' };

    expect(registerSchema.safeParse({ ...base, password: short }).success).toBe(false);
    expect(registerSchema.safeParse({ ...base, password: ok }).success).toBe(true);
  });

  it('requires a date of birth for an adult student but not for a parent', () => {
    const base = {
      email: 'a@b.test',
      password: 'a'.repeat(PASSWORD_MIN_LENGTH),
      // Two characters minimum — the schema's own rule, and the reason this
      // was failing before: a one-character name is invalid for every role.
      displayName: 'Ali',
    };

    expect(registerSchema.safeParse({ ...base, role: 'parent' }).success).toBe(true);
    expect(registerSchema.safeParse({ ...base, role: 'student' }).success).toBe(false);
    expect(
      registerSchema.safeParse({ ...base, role: 'student', dateOfBirth: '2000-01-01' }).success,
    ).toBe(true);
  });

  it('refuses a student under eighteen', () => {
    // The schema checks age; the service checks it again against an injected
    // clock. Both, because this is the one rule the product cannot get wrong.
    const tooYoung = new Date();
    tooYoung.setFullYear(tooYoung.getFullYear() - 12);

    const result = registerSchema.safeParse({
      role: 'student',
      email: 'a@b.test',
      password: 'a'.repeat(PASSWORD_MIN_LENGTH),
      displayName: 'A Student',
      dateOfBirth: tooYoung.toISOString().slice(0, 10),
    });

    expect(result.success).toBe(false);
  });
});

/* =========================================================================
 * The form behaviour
 * ====================================================================== */

function TestForm({ onSubmit = vi.fn() }) {
  const form = useZodForm({
    schema: loginSchema,
    initialValues: { email: '', password: '' },
    onSubmit,
  });

  return (
    <I18nextProvider i18n={i18n}>
      <form onSubmit={form.handleSubmit} noValidate>
        <FormErrorSummary
          ref={form.summaryRef}
          errors={form.errorList}
          formError={form.formError}
        />
        <Field label="Email" required error={form.errors.email}>
          {(props) => <Input {...props} {...form.field('email')} />}
        </Field>
        <Field label="Password" required error={form.errors.password}>
          {(props) => <Input {...props} {...form.field('password')} type="password" />}
        </Field>
        <Button type="submit">Sign in</Button>
      </form>
    </I18nextProvider>
  );
}

describe('form behaviour', () => {
  it('does not complain while somebody is still typing', async () => {
    const user = userEvent.setup();
    render(<TestForm />);

    await user.type(screen.getByLabelText(/email/i), 'a');

    // Telling somebody their email is invalid at the third character is an
    // interface arguing with a person mid-thought.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a summary that takes focus when submit fails', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<TestForm onSubmit={onSubmit} />);

    await user.click(screen.getByRole('button', { name: /sign in/i }));

    // Several things carry role="alert" once a submit fails — the summary and
    // each inline field error. Target the summary by its accessible name.
    const summary = await screen.findByRole('alert', { name: /problems? with this form/i });
    expect(summary).toBeInTheDocument();
    // The failure is announced rather than silently rendered somewhere the
    // person is not looking — on a phone, above the fold they can see.
    await waitFor(() => expect(summary).toHaveFocus());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits parsed values once the schema is satisfied', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<TestForm onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText(/email/i), 'parent@demo.ustaad.test');
    await user.type(screen.getByLabelText(/password/i), 'demo-ustaad-2026');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ email: 'parent@demo.ustaad.test' });
  });

  it('clears a field error as soon as it is corrected', async () => {
    const user = userEvent.setup();
    render(<TestForm />);

    await user.click(screen.getByRole('button', { name: /sign in/i }));
    await screen.findByRole('alert', { name: /problems? with this form/i });

    await user.type(screen.getByLabelText(/email/i), 'parent@demo.ustaad.test');
    await user.type(screen.getByLabelText(/password/i), 'demo-ustaad-2026');

    // Waiting for another submit to clear a fixed error makes the form feel
    // like it is still arguing after the person has done what was asked.
    await waitFor(() =>
      expect(
        screen.queryByRole('alert', { name: /problems? with this form/i }),
      ).not.toBeInTheDocument(),
    );
  });

  it('surfaces a server refusal that belongs to no single field', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue({
      code: 'invalid_credentials',
      message: 'That email address and password do not match an account.',
    });
    render(<TestForm onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText(/email/i), 'parent@demo.ustaad.test');
    await user.type(screen.getByLabelText(/password/i), 'wrong-password-here');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    // Blaming one field would be a guess — and a guess that turns the form into
    // an account-existence oracle.
    expect(
      await screen.findByText(/do not match an account/i),
    ).toBeInTheDocument();
  });

  it('marks required fields and wires errors for a screen reader', async () => {
    const user = userEvent.setup();
    render(<TestForm />);

    await user.click(screen.getByRole('button', { name: /sign in/i }));

    const email = screen.getByLabelText(/email/i);
    await waitFor(() => expect(email).toHaveAttribute('aria-invalid', 'true'));
    // Colour alone fails anyone who cannot see it.
    expect(email).toHaveAttribute('aria-describedby');
  });
});
