/**
 * Registration — §6.1, §5.1.
 *
 * ── The rule this screen is shaped by ──────────────────────────────────────
 * **There is no path here that creates an account for a minor.** A learner
 * under 18 exists only as a `student_profiles` record owned by a parent — a
 * table with no password, no email and no session (SEC-1, decision 2).
 *
 * That is structural on the server: `REGISTERABLE_ROLES` contains no role for a
 * minor, and `admin` is absent by construction so a registration cannot request
 * it (FR-1.5). This screen renders that same list rather than writing its own,
 * so the two cannot disagree.
 *
 * What the screen adds is **copy that says so plainly**. The parent note reads
 * "add your child's details" — not "your child can sign up", not "create a
 * student account". A parent who expects their child to get a login and cannot
 * find it will conclude the product is broken; a parent told the truth up front
 * understands the safety property they are being given.
 *
 * The `student` option is labelled "18 or over" for the same reason. It means
 * an adult student acting on their own behalf, and the date of birth is checked
 * here, by the shared schema, and again in the service against an injected
 * clock.
 */

import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';

// The same schema the server validates with. Imported, never copied.
import { REGISTERABLE_ROLES, registerSchema } from '@shared/auth';

import { FormErrorSummary } from '../../components/form/FormErrorSummary';
import { useZodForm } from '../../components/form/useZodForm';
import { Button } from '../../components/ui/Button';
import { Card, CardBody } from '../../components/ui/Card';
import { Field, Input, Select } from '../../components/ui/Field';
import { useToast } from '../../context/ToastContext';
import { api } from '../../lib/api';
import { keys } from '../../lib/queryClient';

/** Where each role lands once registered. */
export const HOME_FOR_ROLE = {
  parent: '/my/students',
  student: '/my/bookings',
  tutor: '/tutor/profile',
  organisation: '/org/profile',
  admin: '/admin',
};

const ROLE_LABEL_KEY = {
  parent: 'register.roleParent',
  student: 'register.roleStudent',
  tutor: 'register.roleTutor',
  organisation: 'register.roleOrganisation',
};

export default function Register() {
  const { t } = useTranslation(['auth', 'common']);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();

  const register = useMutation({
    mutationFn: (values) => api.post('/auth/register', values),
    onSuccess: async (payload) => {
      // The session arrives as an httpOnly cookie. There is nothing to store —
      // JavaScript cannot read it, which is what makes an XSS bug survivable
      // rather than fatal.
      await queryClient.invalidateQueries({ queryKey: keys.me });
      toast.forAction('createAccount');
      navigate(HOME_FOR_ROLE[payload?.user?.role] ?? '/', { replace: true });
    },
  });

  const form = useZodForm({
    schema: registerSchema,
    initialValues: {
      role: 'parent',
      email: '',
      password: '',
      displayName: '',
      phone: '',
      dateOfBirth: '',
    },
    onSubmit: (values) => register.mutateAsync(values),
  });

  const role = form.values.role;
  const isAdultStudent = role === 'student';

  return (
    <div className="mx-auto max-w-prose px-4 py-8">
      <h1 className="font-display text-display text-ink">{t('register.title')}</h1>

      <form onSubmit={form.handleSubmit} noValidate className="mt-6 space-y-5">
        <FormErrorSummary
          ref={form.summaryRef}
          errors={form.errorList}
          formError={form.formError}
        />

        <Card>
          <CardBody className="space-y-5">
            <Field label={t('register.role')} required error={form.errors.role}>
              {(props) => (
                <Select {...props} {...form.field('role')}>
                  {/*
                    Driven by the shared constant, so `admin` cannot appear here
                    even by mistake — it is not in the list to be rendered.
                  */}
                  {REGISTERABLE_ROLES.map((value) => (
                    <option key={value} value={value}>
                      {t(ROLE_LABEL_KEY[value])}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            {/*
              The child-safety property, stated at the moment it is relevant
              rather than buried in a policy page.
            */}
            {role === 'parent' ? (
              <div className="rounded-card border border-verdigris/25 bg-verdigris-soft p-4">
                <p className="text-small font-semibold text-verdigris-deep">
                  {t('register.parentNoteTitle')}
                </p>
                <p className="mt-1 text-small text-ink">{t('register.parentNoteBody')}</p>
              </div>
            ) : null}

            {isAdultStudent ? (
              <div className="rounded-card border border-seal/30 bg-seal-soft p-4">
                <p className="text-small font-semibold text-seal-deep">
                  {t('register.studentNoteTitle')}
                </p>
                <p className="mt-1 text-small text-ink">{t('register.studentNoteBody')}</p>
              </div>
            ) : null}

            <Field label={t('register.displayName')} required error={form.errors.displayName}>
              {(props) => <Input {...props} {...form.field('displayName')} autoComplete="name" />}
            </Field>

            <Field label={t('signIn.email')} required error={form.errors.email}>
              {(props) => (
                <Input
                  {...props}
                  {...form.field('email')}
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                />
              )}
            </Field>

            <Field
              label={t('signIn.password')}
              required
              hint={t('register.passwordHint')}
              error={form.errors.password}
            >
              {(props) => (
                <Input
                  {...props}
                  {...form.field('password')}
                  type="password"
                  autoComplete="new-password"
                />
              )}
            </Field>

            <Field label={t('register.phone')} error={form.errors.phone}>
              {(props) => (
                <Input
                  {...props}
                  {...form.field('phone')}
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                />
              )}
            </Field>

            {isAdultStudent ? (
              <Field
                label={t('register.dateOfBirth')}
                required
                hint={t('register.dobHint')}
                error={form.errors.dateOfBirth}
              >
                {(props) => <Input {...props} {...form.field('dateOfBirth')} type="date" />}
              </Field>
            ) : null}
          </CardBody>
        </Card>

        <Button type="submit" variant="primary" fullWidth busy={form.submitting}>
          {t('register.submit')}
        </Button>

        <p className="text-center text-small text-slate">
          {t('register.haveAccount')}{' '}
          <Link to="/login" className="font-medium text-verdigris-deep underline underline-offset-2">
            {t('signIn.title')}
          </Link>
        </p>

        {/*
          FR-33.1 — the volunteer route, from the tutor onboarding path.
          Shown only to somebody registering as a tutor, because that is the
          moment the choice is live: they are already deciding to teach through
          this platform, and the programme is a different way of doing it rather
          than a different product.
        */}
        {role === 'tutor' ? (
          <p className="text-center text-small text-slate">
            {t('register.volunteerPrompt')}{' '}
            <Link
              to="/volunteer"
              className="font-medium text-verdigris-deep underline underline-offset-2"
            >
              {t('register.volunteerLink')}
            </Link>
          </p>
        ) : null}
      </form>
    </div>
  );
}
