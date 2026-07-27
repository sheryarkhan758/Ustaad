/**
 * Sign in — §6.1.
 *
 * ── There is nothing to store ──────────────────────────────────────────────
 * A successful login sets an httpOnly cookie. JavaScript cannot read it, so
 * there is no token to put in `localStorage`, no header to attach, and nothing
 * for this component to remember. What it does is invalidate the `me` query and
 * let the auth context re-ask the server who is signed in.
 *
 * ── Where the person lands ─────────────────────────────────────────────────
 * Back where they were going, if a guard sent them here (`state.from`), and
 * otherwise to their own role's home. Dropping everyone on a generic dashboard
 * after they clicked a specific link is a small betrayal that people notice.
 */

import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { loginSchema } from '@shared/auth';

import { FormErrorSummary } from '../../components/form/FormErrorSummary';
import { useZodForm } from '../../components/form/useZodForm';
import { Button } from '../../components/ui/Button';
import { Card, CardBody } from '../../components/ui/Card';
import { Field, Input } from '../../components/ui/Field';
import { useToast } from '../../context/ToastContext';
import { api } from '../../lib/api';
import { keys } from '../../lib/queryClient';
import { HOME_FOR_ROLE } from './Register';

export default function Login() {
  const { t } = useTranslation(['auth', 'common']);
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const toast = useToast();

  const login = useMutation({
    mutationFn: (values) => api.post('/auth/login', values),
    onSuccess: async (payload) => {
      await queryClient.invalidateQueries({ queryKey: keys.me });
      toast.forAction('signIn');

      const intended = location.state?.from;
      navigate(intended ?? HOME_FOR_ROLE[payload?.user?.role] ?? '/', { replace: true });
    },
  });

  const form = useZodForm({
    schema: loginSchema,
    initialValues: { email: '', password: '' },
    onSubmit: (values) => login.mutateAsync(values),
  });

  return (
    <div className="mx-auto max-w-prose px-4 py-8">
      <h1 className="font-display text-display text-ink">{t('signIn.title')}</h1>

      <form onSubmit={form.handleSubmit} noValidate className="mt-6 space-y-5">
        {/*
          A wrong password arrives here as `formError`, not as a field error.
          The server deliberately returns the identical response for an unknown
          email and a wrong password, so blaming one field would be a guess —
          and a guess that turns the form into an account-existence oracle.
        */}
        <FormErrorSummary
          ref={form.summaryRef}
          errors={form.errorList}
          formError={form.formError}
        />

        <Card>
          <CardBody className="space-y-5">
            <Field label={t('signIn.email')} required error={form.errors.email}>
              {(props) => (
                <Input
                  {...props}
                  {...form.field('email')}
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoFocus
                />
              )}
            </Field>

            <Field label={t('signIn.password')} required error={form.errors.password}>
              {(props) => (
                <Input
                  {...props}
                  {...form.field('password')}
                  type="password"
                  autoComplete="current-password"
                />
              )}
            </Field>

            <p className="text-small">
              <Link
                to="/forgot-password"
                className="font-medium text-verdigris-deep underline underline-offset-2"
              >
                {t('signIn.forgot')}
              </Link>
            </p>
          </CardBody>
        </Card>

        <Button type="submit" variant="primary" fullWidth busy={form.submitting}>
          {t('signIn.submit')}
        </Button>

        <p className="text-center text-small text-slate">
          {t('signIn.noAccount')}{' '}
          <Link
            to="/register"
            className="font-medium text-verdigris-deep underline underline-offset-2"
          >
            {t('signIn.register')}
          </Link>
        </p>
      </form>
    </div>
  );
}
