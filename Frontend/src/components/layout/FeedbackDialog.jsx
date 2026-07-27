/**
 * The platform feedback channel — §6.32.
 *
 * Feedback about **Ustaad.com itself**, never about a tutor. A review is a
 * different thing with a different table and a different audience, and merging
 * the two would put "the site is slow" into a tutor's public record (FR-32.10).
 *
 * ── It must not cost the user their place ──────────────────────────────────
 * FR-32.1: reachable from every page, in one action, without leaving it. A
 * route change would discard a half-filled search or a booking form — and the
 * moment somebody most wants to report a problem is usually the moment they are
 * in the middle of something. So it is a slide-over over the page they are on,
 * and the page is still there behind it when they close it.
 *
 * ── Anonymous is a first-class path, and is said out loud ──────────────────
 * `POST /api/feedback` requires no account (FR-32.6). Somebody reporting that a
 * verification badge looks wrong may specifically not want to be identified,
 * and requiring a login to say so is how a platform stops hearing it. The panel
 * states that plainly rather than leaving it to be inferred from the absence of
 * a sign-in prompt.
 *
 * ── Context is captured, and shown being captured ──────────────────────────
 * FR-32.4 takes the page, language, role and version automatically, because the
 * commonest reason a defect report is unusable is that nobody can reproduce it.
 * Collecting that quietly is fine; hiding it is not — so the panel lists
 * exactly what travels with the report, in a box the user can read before they
 * send it. The server takes role, locale and version from the request itself
 * and discards whatever the client claimed, so this display is a courtesy
 * rather than the source of truth.
 *
 * ── The text is never touched ──────────────────────────────────────────────
 * Urdu, Roman Urdu and mixed text all arrive as typed and are stored unchanged
 * (FR-32.3, decision 13). There is no normalisation here and none on the way in.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';

import { useAuth } from '../../context/AuthContext';
import { api } from '../../lib/api';
import { Button } from '../ui/Button';
import { Checkbox, Field, Select, Textarea } from '../ui/Field';
import { Modal } from '../ui/Modal';
import { ErrorState } from '../ui/Card';

/** Mirrors the server's `FEEDBACK_CATEGORIES`. */
const CATEGORIES = [
  'defect',
  'usability',
  'incorrect_ai_output',
  'missing_feature',
  'content_or_safety',
  'other',
];

const RATINGS = [1, 2, 3, 4, 5];

/** FR-32.5 — one file, and only these three types. */
const ACCEPTED = ['image/png', 'image/jpeg', 'application/pdf'];
const MAX_BYTES = 5 * 1024 * 1024;

/** The honeypot's name, from `shared/anti-abuse.ts`. Must look worth filling in. */
const HONEYPOT_FIELD = 'websiteUrl';

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** `data:image/png;base64,AAA…` → `AAA…`, which is what the schema takes. */
function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('could not read the file'));
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.readAsDataURL(file);
  });
}

export function FeedbackDialog({ open, onClose }) {
  const { t, i18n } = useTranslation(['feedback', 'common']);
  const location = useLocation();
  const { user } = useAuth();

  const [category, setCategory] = useState('usability');
  const [detail, setDetail] = useState('');
  const [rating, setRating] = useState('');
  const [safety, setSafety] = useState(false);
  const [file, setFile] = useState(null);
  const [fileError, setFileError] = useState(null);
  const [done, setDone] = useState(false);

  /*
   * Anti-abuse the user never notices (FR-33.8's sibling rule, applied here
   * because `submitFeedbackSchema` extends the same anti-abuse fields). The
   * honeypot is a real input, off-screen and never focusable; the timer is when
   * the panel opened. Both are trivially forgeable and both are checked
   * server-side — they raise the cost of the lazy attack, which is the one that
   * actually happens.
   */
  const openedAt = useRef(Date.now());
  const [honeypot, setHoneypot] = useState('');

  useEffect(() => {
    if (!open) return;
    openedAt.current = Date.now();
    setDone(false);
    setDetail('');
    setRating('');
    setSafety(false);
    setFile(null);
    setFileError(null);
    setHoneypot('');
  }, [open]);

  /** Exactly what travels with the report, in the order it is sent. */
  const context = useMemo(
    () => [
      { label: t('context.page'), value: location.pathname },
      { label: t('context.language'), value: i18n.language },
      { label: t('context.role'), value: user?.role ?? t('context.roleNone') },
      { label: t('context.version'), value: import.meta.env?.VITE_APP_VERSION ?? '0.1.0' },
    ],
    [t, location.pathname, i18n.language, user?.role],
  );

  function chooseFile(event) {
    const chosen = event.target.files?.[0] ?? null;
    setFileError(null);

    if (!chosen) {
      setFile(null);
      return;
    }
    // Checked before anything is read, so an oversized file is never held in
    // memory and never leaves the machine.
    if (!ACCEPTED.includes(chosen.type)) {
      setFile(null);
      setFileError(t('attachment.wrongType'));
      return;
    }
    if (chosen.size > MAX_BYTES) {
      setFile(null);
      setFileError(t('attachment.tooLarge'));
      return;
    }
    setFile(chosen);
  }

  const submit = useMutation({
    mutationFn: async () => {
      const attachment = file
        ? {
            fileName: file.name,
            mimeType: file.type,
            contentBase64: await readAsBase64(file),
          }
        : null;

      return api.post('/feedback', {
        category,
        // Sent exactly as typed. No normalisation, no transliteration (§2.10).
        detail,
        satisfactionRating: rating === '' ? null : Number(rating),
        safetyConcernFlag: safety,
        // FR-32.4 — captured, not asked for.
        pagePath: location.pathname,
        locale: i18n.language === 'ur' ? 'ur' : 'en',
        attachment,
        [HONEYPOT_FIELD]: honeypot,
        timeOnFormMs: Date.now() - openedAt.current,
      });
    },
    onSuccess: () => setDone(true),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      placement="side"
      title={done ? t('next.heading') : t('title')}
      description={done ? undefined : t('intro')}
      footer={
        done ? (
          <Button variant="primary" onClick={onClose}>
            {t('next.close')}
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              {t('common:action.cancel')}
            </Button>
            <Button
              variant="primary"
              busy={submit.isPending}
              disabled={detail.trim().length < 10}
              onClick={() => submit.mutate()}
            >
              {t('submit')}
            </Button>
          </>
        )
      }
    >
      {done ? (
        <div className="space-y-2">
          {/* What happens next, not "thanks". */}
          <p className="text-small text-ink">{t('next.body')}</p>
          {safety ? <p className="text-small text-ink">{t('next.safety')}</p> : null}
        </div>
      ) : (
        <div className="space-y-4">
          {submit.isError ? <ErrorState error={submit.error} /> : null}

          {/* FR-32.6, said rather than implied. */}
          <p className="rounded-control bg-paper-sunk px-3 py-2 text-caption text-ink">
            {t('anonymous')}
          </p>

          <Field label={t('category.label')} required>
            {(props) => (
              <Select {...props} value={category} onChange={(e) => setCategory(e.target.value)}>
                {CATEGORIES.map((value) => (
                  <option key={value} value={value}>
                    {t(`category.${value}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label={t('detail.label')} required hint={t('detail.hint')}>
            {(props) => (
              <Textarea
                {...props}
                value={detail}
                onChange={(e) => setDetail(e.target.value)}
                maxLength={5000}
                placeholder={t('detail.placeholder')}
              />
            )}
          </Field>

          {/* FR-32.2 — optional, and the "prefer not to say" is a real option. */}
          <Field label={t('rating.label')} hint={t('rating.hint')}>
            {(props) => (
              <Select {...props} value={rating} onChange={(e) => setRating(e.target.value)}>
                <option value="">{t('rating.none')}</option>
                {RATINGS.map((value) => (
                  <option key={value} value={value}>
                    {t(`rating.${value}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          {/* FR-32.5 */}
          <Field label={t('attachment.label')} hint={t('attachment.hint')} error={fileError}>
            {(props) => (
              <input
                {...props}
                type="file"
                accept={ACCEPTED.join(',')}
                onChange={chooseFile}
                className="block w-full text-small text-ink file:me-3 file:min-h-tap file:rounded-control file:border file:border-slate-line file:bg-paper file:px-3 file:text-small file:text-ink"
              />
            )}
          </Field>

          {file ? (
            <p className="flex flex-wrap items-center gap-2 text-caption text-slate">
              <span>{t('attachment.chosen', { name: file.name, size: formatBytes(file.size) })}</span>
              <button
                type="button"
                onClick={() => setFile(null)}
                className="text-verdigris-deep underline underline-offset-2"
              >
                {t('attachment.remove')}
              </button>
            </p>
          ) : null}

          <Checkbox
            label={t('safety.label')}
            hint={t('safety.hint')}
            checked={safety}
            onChange={(e) => setSafety(e.target.checked)}
          />

          {/* --- What is being sent with it (FR-32.4) --------------------- */}
          <section
            aria-labelledby="feedback-context-heading"
            className="rounded-control border border-slate-line px-3 py-2"
          >
            <h3
              id="feedback-context-heading"
              className="text-caption font-semibold uppercase tracking-wide text-slate"
            >
              {t('context.heading')}
            </h3>
            <dl className="mt-1.5 space-y-0.5">
              {context.map((row) => (
                <div key={row.label} className="flex flex-wrap gap-x-2 text-caption">
                  <dt className="text-slate">{row.label}:</dt>
                  <dd className="min-w-0 break-all text-ink">{row.value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-1.5 text-caption text-slate">{t('context.body')}</p>
          </section>

          {/*
            The honeypot. Off-screen rather than `display:none`, because some
            bots skip hidden inputs and a real user never reaches it: it is not
            in the tab order and is announced to nobody.
          */}
          <input
            type="text"
            name={HONEYPOT_FIELD}
            value={honeypot}
            onChange={(e) => setHoneypot(e.target.value)}
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            className="absolute -left-[9999px] h-px w-px opacity-0"
          />
        </div>
      )}
    </Modal>
  );
}
