/**
 * The volunteer application — §6.33.
 *
 * ── It opens with why, because the why is the recruitment ──────────────────
 * Nobody fills in an unpaid application because the form is short. §6.33 gives
 * two reasons and this page leads with both: students whose families cannot pay
 * at any rate, and the thinnest part of supply — verified female tutors who
 * will teach at a family's home, without whom the §2.1 pathway has nobody to
 * offer. A page that opened with "Full name" would be asking a favour without
 * saying what for.
 *
 * ── The standard is stated before anything is asked ────────────────────────
 * FR-33.10 is the module's load-bearing rule: a volunteer is verified exactly
 * as a paid tutor is, against a CNIC and academic documents. Goodwill is not a
 * substitute, because a volunteer enters a family home on the same terms. The
 * page says so up front rather than surprising somebody with a document request
 * after they have committed.
 *
 * ── The record is the truth; the email is a notification ───────────────────
 * FR-33.9 writes the row first and records the dispatch outcome against it. The
 * success state honours that: it confirms receipt on the strength of the saved
 * record, and where the mail failed it says so as *our* problem, without
 * casting doubt on the application. Showing a failure to an applicant whose
 * submission actually succeeded is the worst outcome available — they fill it
 * in again, or they give up.
 *
 * ── Anti-abuse the applicant never meets ───────────────────────────────────
 * A honeypot field and the time the form was open, both checked server-side
 * (FR-33.8). No challenge, no CAPTCHA, no cost to a real applicant — which
 * matters more here than usual, because the people this page is trying to reach
 * are the ones most likely to abandon a form that treats them as a suspect.
 */

import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';

import { submitVolunteerApplicationSchema } from '@shared/volunteers';

import { FormErrorSummary } from '../../components/form/FormErrorSummary';
import { useZodForm } from '../../components/form/useZodForm';
import { LocationPicker } from '../../components/pickers/LocationPicker';
import { Button } from '../../components/ui/Button';
import { Card, CardBody } from '../../components/ui/Card';
import { Check, Warning } from '../../components/ui/Icon';
import { Field, Input, Select, Textarea } from '../../components/ui/Field';
import { api } from '../../lib/api';
import { useLevels, useLocalName, useSubjects } from '../../lib/reference';

/** `TEACHING_MODES` from `shared/rates.ts`, and the dictionary keys match it. */
const MODES = ['home', 'online', 'own_place'];
const GENDERS = ['female', 'male'];

/** PDF only — FR-33.3. */
const ACCEPTED_TYPE = 'application/pdf';
const MAX_BYTES = 5 * 1024 * 1024;

/** From `shared/anti-abuse.ts`. Named to look worth filling in. */
const HONEYPOT_FIELD = 'websiteUrl';

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** `data:application/pdf;base64,AAA…` → `AAA…`, which is what the schema takes. */
function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('could not read the file'));
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.readAsDataURL(file);
  });
}

/** A checkbox group that reads as one question — subjects, levels, modes. */
function CheckboxGroup({ legend, hint, options, selected, onToggle, error, name }) {
  return (
    <fieldset>
      <legend className="text-small font-medium text-ink">{legend}</legend>
      {hint ? <p className="mt-0.5 text-caption text-slate">{hint}</p> : null}
      {error ? (
        <p id={`${name}-error`} role="alert" className="mt-1 text-caption font-medium text-flag">
          {error}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((option) => {
          const checked = selected.includes(option.id);
          return (
            <label
              key={option.id}
              className={[
                'flex min-h-tap cursor-pointer items-center gap-2 rounded-control border px-3 text-small',
                checked
                  ? 'border-verdigris bg-verdigris-soft/40 text-ink'
                  : 'border-slate-line text-slate hover:bg-paper-sunk',
              ].join(' ')}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(option.id)}
                className="h-4 w-4 accent-verdigris-deep"
              />
              {option.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export default function Volunteer() {
  const { t } = useTranslation(['volunteer', 'common', 'search']);
  const localName = useLocalName();

  const subjects = useSubjects();
  const levels = useLevels();

  const [location, setLocation] = useState({ provinceId: null, cityId: null, areaId: null });
  const [file, setFile] = useState(null);
  const [fileError, setFileError] = useState(null);
  const [result, setResult] = useState(null);

  const openedAt = useRef(Date.now());
  const [honeypot, setHoneypot] = useState('');

  const send = useMutation({
    mutationFn: (body) => api.post('/volunteers', body),
    onSuccess: (data) => setResult(data),
  });

  const form = useZodForm({
    schema: submitVolunteerApplicationSchema,
    initialValues: {
      fullName: '',
      email: '',
      phone: '',
      cityId: '',
      areaId: '',
      subjectIds: [],
      levelIds: [],
      weeklyHours: 4,
      deliveryModes: [],
      gender: 'female',
      motivation: '',
    },
    onSubmit: async (values) => {
      const document = file
        ? {
            fileName: file.name,
            mimeType: ACCEPTED_TYPE,
            contentBase64: await readAsBase64(file),
          }
        : null;

      return send.mutateAsync({
        ...values,
        document,
        [HONEYPOT_FIELD]: honeypot,
        timeOnFormMs: Date.now() - openedAt.current,
      });
    },
  });

  // The picker owns province, city and area; the schema wants the two ids.
  function changeLocation(next) {
    setLocation(next);
    form.setValue('cityId', next.cityId ?? '');
    form.setValue('areaId', next.areaId ?? '');
  }

  function toggle(name, id) {
    const current = form.values[name] ?? [];
    form.setValue(name, current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);
  }

  function chooseFile(event) {
    const chosen = event.target.files?.[0] ?? null;
    setFileError(null);

    if (!chosen) {
      setFile(null);
      return;
    }

    /*
     * Checked before a byte is read. `accept` is a filter on the file picker
     * and nothing more — a file can be renamed and some platforms offer "all
     * files" anyway. The server sniffs the bytes as well (SEC-24); this exists
     * so the applicant is told immediately rather than after a 5 MB upload.
     */
    const looksPdf = chosen.type === ACCEPTED_TYPE || chosen.name.toLowerCase().endsWith('.pdf');
    if (!looksPdf) {
      setFile(null);
      setFileError(t('document.wrongType'));
      return;
    }
    if (chosen.size > MAX_BYTES) {
      setFile(null);
      setFileError(t('document.tooLarge'));
      return;
    }
    setFile(chosen);
  }

  const subjectOptions = useMemo(
    () => (subjects.data ?? []).map((s) => ({ id: s.id, label: localName(s).text })),
    [subjects.data, localName],
  );
  const levelOptions = useMemo(
    () => (levels.data ?? []).map((l) => ({ id: l.id, label: localName(l).text })),
    [levels.data, localName],
  );

  /* --- Received -------------------------------------------------------- */

  if (result) {
    // FR-33.9: the row exists. Everything below is stated on that basis.
    const mailFailed = result.mailDispatchStatus && result.mailDispatchStatus !== 'sent';

    return (
      <div className="mx-auto max-w-prose space-y-4 px-4 py-6">
        <Card>
          <CardBody className="space-y-3">
            <div className="flex items-start gap-3">
              <Check className="mt-0.5 shrink-0 text-settled" aria-hidden="true" />
              <h1 className="font-display text-display text-ink">{t('success.heading')}</h1>
            </div>

            <p className="text-small text-ink">{t('success.saved')}</p>

            {/*
              Said either way, and never as a failure of the application. A
              dispatch that did not go out is our problem; the record is the
              truth and it is already safe.
            */}
            <p className="text-small text-slate">
              {mailFailed ? t('success.mailFailed') : t('success.mailSent')}
            </p>

            <p className="text-small text-ink">{t('success.next')}</p>

            <Button
              variant="secondary"
              onClick={() => {
                setResult(null);
                setFile(null);
                openedAt.current = Date.now();
              }}
            >
              {t('success.again')}
            </Button>
          </CardBody>
        </Card>
      </div>
    );
  }

  /* --- The page -------------------------------------------------------- */

  return (
    <div className="mx-auto max-w-prose space-y-5 px-4 py-6">
      <header className="space-y-2">
        <h1 className="font-display text-display text-ink">{t('title')}</h1>
        <p className="text-body text-slate">{t('intro')}</p>
      </header>

      {/* --- Why, before what -------------------------------------------- */}
      <Card>
        <CardBody className="space-y-2">
          <h2 className="font-display text-subtitle text-ink">{t('why.heading')}</h2>
          <p className="text-small text-slate">{t('why.reach')}</p>
          <p className="text-small text-slate">{t('why.supply')}</p>
          {/* FR-33.10, before a single field is asked for. */}
          <p className="rounded-control bg-paper-sunk px-3 py-2 text-small text-ink">
            {t('why.standard')}
          </p>
        </CardBody>
      </Card>

      <form onSubmit={form.handleSubmit} noValidate className="space-y-4">
        <FormErrorSummary
          ref={form.summaryRef}
          errors={form.errorList}
          formError={form.formError}
          title={t('errors.summaryTitle')}
        />

        <Card>
          <CardBody className="space-y-4">
            <div>
              <h2 className="font-display text-subtitle text-ink">{t('form.contactHeading')}</h2>
              <p className="mt-0.5 text-caption text-slate">{t('form.noAccount')}</p>
            </div>

            <Field label={t('fullName')} required error={form.errors.fullName} htmlFor="fullName">
              {(props) => <Input {...props} {...form.field('fullName')} autoComplete="name" />}
            </Field>

            <Field label={t('email')} required error={form.errors.email} htmlFor="email">
              {(props) => (
                <Input {...props} {...form.field('email')} type="email" autoComplete="email" />
              )}
            </Field>

            <Field label={t('phone')} required error={form.errors.phone} htmlFor="phone">
              {(props) => <Input {...props} {...form.field('phone')} inputMode="tel" />}
            </Field>

            <div>
              <LocationPicker value={location} onChange={changeLocation} />
              {form.errors.cityId || form.errors.areaId ? (
                <p role="alert" className="mt-1 text-caption font-medium text-flag">
                  {form.errors.cityId ?? form.errors.areaId}
                </p>
              ) : null}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="space-y-4">
            <h2 className="font-display text-subtitle text-ink">{t('form.teachingHeading')}</h2>

            <CheckboxGroup
              name="subjectIds"
              legend={t('subjects')}
              options={subjectOptions}
              selected={form.values.subjectIds ?? []}
              onToggle={(id) => toggle('subjectIds', id)}
              error={form.errors.subjectIds}
            />

            <CheckboxGroup
              name="levelIds"
              legend={t('levels')}
              options={levelOptions}
              selected={form.values.levelIds ?? []}
              onToggle={(id) => toggle('levelIds', id)}
              error={form.errors.levelIds}
            />

            <CheckboxGroup
              name="deliveryModes"
              legend={t('deliveryModes')}
              options={MODES.map((mode) => ({ id: mode, label: t(`common:mode.${mode}`) }))}
              selected={form.values.deliveryModes ?? []}
              onToggle={(id) => toggle('deliveryModes', id)}
              error={form.errors.deliveryModes}
            />

            <Field
              label={t('weeklyHours')}
              hint={t('weeklyHoursHint')}
              required
              error={form.errors.weeklyHours}
              htmlFor="weeklyHours"
            >
              {(props) => (
                <Input
                  {...props}
                  id="weeklyHours"
                  type="number"
                  min={1}
                  max={20}
                  value={form.values.weeklyHours}
                  onChange={(event) => form.setValue('weeklyHours', Number(event.target.value))}
                />
              )}
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="space-y-4">
            <h2 className="font-display text-subtitle text-ink">{t('form.aboutHeading')}</h2>

            <Field label={t('gender')} required error={form.errors.gender} htmlFor="gender">
              {(props) => (
                <Select {...props} {...form.field('gender')}>
                  {GENDERS.map((value) => (
                    <option key={value} value={value}>
                      {t(`search:gender.${value === 'female' ? 'female_only' : 'male_only'}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field
              label={t('motivation')}
              hint={t('motivationHint')}
              error={form.errors.motivation}
              htmlFor="motivation"
            >
              {(props) => (
                <Textarea {...props} {...form.field('motivation')} rows={4} maxLength={2000} />
              )}
            </Field>

            {/* --- The document — FR-33.3, FR-33.4, SEC-24 ---------------- */}
            <Field
              label={t('document.label')}
              hint={t('document.hint')}
              error={fileError}
              htmlFor="document"
            >
              {(props) => (
                <input
                  {...props}
                  id="document"
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={chooseFile}
                  className="block w-full text-small text-ink file:me-3 file:min-h-tap file:rounded-control file:border file:border-slate-line file:bg-paper file:px-3 file:text-small file:text-ink"
                />
              )}
            </Field>

            {file ? (
              <p className="flex flex-wrap items-center gap-2 text-caption text-slate">
                <span>
                  {t('document.chosen', { name: file.name, size: formatBytes(file.size) })}
                </span>
                <button
                  type="button"
                  onClick={() => setFile(null)}
                  className="text-verdigris-deep underline underline-offset-2"
                >
                  {t('document.remove')}
                </button>
              </p>
            ) : null}

            <p className="text-caption text-slate">{t('document.optionalNow')}</p>
            <div className="flex gap-2 rounded-control border border-slate-line px-3 py-2">
              <Warning size="sm" className="mt-0.5 shrink-0 text-slate" aria-hidden="true" />
              <p className="text-caption text-slate">{t('document.private')}</p>
            </div>
          </CardBody>
        </Card>

        {/* Off-screen, out of the tab order, announced to nobody. */}
        <input
          type="text"
          name={HONEYPOT_FIELD}
          value={honeypot}
          onChange={(event) => setHoneypot(event.target.value)}
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          className="absolute -left-[9999px] h-px w-px opacity-0"
        />

        <Button type="submit" variant="accent" busy={form.submitting || send.isPending} fullWidth>
          {form.submitting || send.isPending ? t('submitting') : t('submit')}
        </Button>
      </form>
    </div>
  );
}
