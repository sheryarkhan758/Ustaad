/**
 * Profile completeness and the verification flow — §6.4, §6.6, §6.28.
 *
 * ── Why completeness gets its own component ────────────────────────────────
 * An incomplete profile is the most common reason an application stalls, and
 * the way it stalls is silent: the tutor believes she has applied, the
 * administrator sees nothing worth reviewing, and neither of them knows the
 * other is waiting. So the indicator does not show a percentage and stop — it
 * **names the specific missing thing** and links to it.
 *
 * ── The status view is a chain of custody, not a progress bar ──────────────
 * `draft → pending → approved | rejected`. On approval it lists **which
 * artefacts were checked**, because that itemised list is what the public badge
 * is generated from and the tutor is entitled to see exactly what the platform
 * will claim on her behalf (FR-6.5).
 *
 * On rejection it shows the administrator's written reason and the appeal
 * route. A verdict that affects a livelihood is never final without a path to
 * human review (SEC-18, decision 12) — and an appeal route the tutor cannot
 * find is not a path.
 */

import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { Button } from '../ui/Button';
import { Badge, Card, CardBody } from '../ui/Card';
import { Check, Clock, Warning } from '../ui/Icon';
import { useFormat } from '../../lib/format';

/* -------------------------------------------------------------------------
 * Completeness
 * ---------------------------------------------------------------------- */

/**
 * What a profile needs before it is worth an administrator's time.
 *
 * `required` items block submission; the rest are advice. The split matters:
 * demanding a biography before she can apply would stall exactly the tutors
 * this platform most wants — the ones who are good at teaching and indifferent
 * to writing about themselves.
 */
export function computeCompleteness({ profile, claims = [], rates = [], availability = [], documents = [] }) {
  const items = [
    {
      key: 'basics',
      required: true,
      done: Boolean(profile?.cityId && profile?.gender),
      to: '/tutor/profile',
    },
    {
      key: 'bio',
      required: false,
      done: Boolean(profile?.bio?.trim() || profile?.bioUr?.trim()),
      to: '/tutor/profile',
    },
    {
      key: 'qualifications',
      required: true,
      done: Boolean(profile?.qualifications?.trim()),
      to: '/tutor/profile',
    },
    {
      key: 'modes',
      required: true,
      done: Boolean(profile?.teachesAtHome || profile?.teachesOnline || profile?.teachesAtOwnPlace),
      to: '/tutor/profile',
    },
    { key: 'claims', required: true, done: claims.length > 0, to: '/tutor/profile' },
    {
      key: 'rates',
      required: false,
      // A volunteer has no rates, and that is not incompleteness.
      done: rates.length > 0 || Boolean(profile?.volunteerFlag),
      to: '/tutor/profile',
    },
    { key: 'availability', required: false, done: availability.length > 0, to: '/tutor/schedule' },
    {
      key: 'identityDocuments',
      required: true,
      done: documents.some((d) => d.docType === 'cnic_front'),
      to: '/tutor/verification',
    },
    {
      key: 'academicDocuments',
      required: true,
      done: documents.some((d) => d.docType === 'degree' || d.docType === 'transcript'),
      to: '/tutor/verification',
    },
  ];

  const done = items.filter((item) => item.done).length;
  const blocking = items.filter((item) => item.required && !item.done);

  return {
    items,
    done,
    total: items.length,
    percent: Math.round((done / items.length) * 100),
    blocking,
    canSubmit: blocking.length === 0,
  };
}

export function CompletenessPanel({ completeness }) {
  const { t } = useTranslation('tutor');
  const { percent, done, total, items, blocking } = completeness;

  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-display text-subtitle text-ink">{t('completeness.title')}</h2>
          <p className="font-mono text-small tnum text-slate">
            {t('completeness.count', { done, total })}
          </p>
        </div>

        <div
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={t('completeness.title')}
          className="h-2 w-full overflow-hidden rounded-full bg-paper-sunk"
        >
          <div
            className={`h-full transition-[width] duration-300 ${
              blocking.length === 0 ? 'bg-settled' : 'bg-verdigris'
            }`}
            style={{ width: `${percent}%` }}
          />
        </div>

        {/*
          Naming the missing thing rather than only counting it. "80% complete"
          tells a tutor she is nearly there and nothing about what to do next.
        */}
        <ul className="space-y-1.5">
          {items.map((item) => (
            <li key={item.key} className="flex items-start gap-2 text-small">
              {item.done ? (
                <Check size="sm" className="mt-0.5 text-settled" />
              ) : (
                <span
                  aria-hidden="true"
                  className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                    item.required ? 'bg-flag' : 'bg-slate-light'
                  }`}
                />
              )}
              <span className={item.done ? 'text-slate line-through' : 'text-ink'}>
                <Link to={item.to} className={item.done ? '' : 'underline underline-offset-2'}>
                  {t(`completeness.item.${item.key}`)}
                </Link>
                {!item.done && !item.required ? (
                  <span className="ms-1.5 text-caption text-slate">
                    {t('completeness.optional')}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

/* -------------------------------------------------------------------------
 * The verification status view
 * ---------------------------------------------------------------------- */

const STATUS_PRESENTATION = {
  draft: { tone: 'neutral', Icon: Clock },
  pending_verification: { tone: 'info', Icon: Clock },
  documents_submitted: { tone: 'info', Icon: Clock },
  under_review: { tone: 'info', Icon: Clock },
  approved: { tone: 'settled', Icon: Check },
  rejected: { tone: 'flag', Icon: Warning },
  more_info_needed: { tone: 'warning', Icon: Warning },
};

const ARTEFACT_KEY = {
  cnic: 'verification.artefact.cnic',
  degree: 'verification.artefact.degree',
  transcript: 'verification.artefact.transcript',
};

export function VerificationStatus({ profile, records = [], completeness, onSubmit, submitting }) {
  const { t } = useTranslation(['tutor', 'common']);
  const fmt = useFormat();

  const status = profile?.profileStatus ?? 'draft';
  const presentation = STATUS_PRESENTATION[status] ?? STATUS_PRESENTATION.draft;
  const { Icon } = presentation;

  // Newest first. The chain of custody reads backwards from where she is now.
  const history = [...records].sort(
    (a, b) => new Date(b.decidedAt) - new Date(a.decidedAt),
  );
  const latest = history[0] ?? null;

  return (
    <div className="space-y-5">
      <Card>
        <CardBody className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-caption font-semibold uppercase tracking-wide text-slate">
                {t('verification.statusLabel')}
              </p>
              <h2 className="mt-0.5 font-display text-title text-ink">
                {t(`verification.status.${status}`)}
              </h2>
            </div>
            <Badge tone={presentation.tone}>
              <Icon size="sm" />
              {t(`verification.status.${status}`)}
            </Badge>
          </div>

          <p className="text-small text-slate">{t(`verification.explain.${status}`)}</p>

          {status === 'draft' ? (
            completeness?.canSubmit ? (
              <Button variant="primary" onClick={onSubmit} busy={submitting}>
                {t('verification.submit')}
              </Button>
            ) : (
              <div className="rounded-card border border-seal/30 bg-seal-soft p-3">
                <p className="text-small font-medium text-seal-deep">
                  {t('verification.cannotSubmit', { count: completeness?.blocking?.length ?? 0 })}
                </p>
                <ul className="mt-1.5 list-disc space-y-0.5 ps-5">
                  {(completeness?.blocking ?? []).map((item) => (
                    <li key={item.key} className="text-small text-ink">
                      {t(`completeness.item.${item.key}`)}
                    </li>
                  ))}
                </ul>
              </div>
            )
          ) : null}
        </CardBody>
      </Card>

      {/*
        The itemised list — FR-6.5. She is entitled to see exactly what the
        platform will claim on her behalf, because the public badge is generated
        from this list and nothing else.
      */}
      {latest?.decision === 'approved' ? (
        <Card className="border-verdigris/40">
          <CardBody>
            <p className="font-display text-subtitle text-ink">{t('verification.checkedTitle')}</p>
            <ul className="mt-3 divide-y divide-slate-line">
              {(latest.artefactsChecked ?? []).map((artefact) => (
                <li key={artefact} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-small text-ink">
                    {t(ARTEFACT_KEY[artefact] ?? 'verification.artefact.other', {
                      defaultValue: artefact,
                    })}
                  </span>
                  <Check size="sm" className="text-settled" />
                </li>
              ))}
            </ul>
            <p className="mt-3 border-t border-slate-line pt-3 text-caption text-slate">
              {t('verification.approvedBy', {
                name: latest.decidedBy,
                date: fmt.date(latest.decidedAt),
              })}
            </p>
            {/* The limit of the claim, on her copy of the record too. */}
            <p className="mt-2 text-caption font-medium text-ink">
              {t('verification.notChecked')}
            </p>
          </CardBody>
        </Card>
      ) : null}

      {latest && (latest.decision === 'rejected' || latest.decision === 'more_info_needed') ? (
        <Card className="border-flag/30">
          <CardBody className="space-y-3">
            <p className="font-display text-subtitle text-flag">
              {t(`verification.decision.${latest.decision}`)}
            </p>
            {/* The administrator's own words, verbatim. */}
            <blockquote
              dir="auto"
              className="border-s-2 border-flag/40 ps-3 text-small text-ink"
            >
              {latest.reason}
            </blockquote>
            <p className="text-caption text-slate">
              {t('verification.decidedOn', { date: fmt.date(latest.decidedAt) })}
            </p>

            <div className="rounded-card border border-slate-line bg-paper p-3">
              <p className="text-small font-medium text-ink">{t('verification.appealTitle')}</p>
              <p className="mt-1 text-small text-slate">{t('verification.appealBody')}</p>
              <Link
                to="/tutor/verification#appeal"
                className="mt-2 inline-flex min-h-tap items-center rounded-control border border-slate-line bg-white px-4 text-small font-medium text-ink hover:bg-paper"
              >
                {t('verification.appealAction')}
              </Link>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {history.length > 1 ? (
        <Card>
          <CardBody>
            <p className="font-display text-subtitle text-ink">{t('verification.historyTitle')}</p>
            <ul className="mt-3 divide-y divide-slate-line">
              {history.map((record) => (
                <li key={record.id} className="py-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-small text-ink">
                      {t(`verification.decision.${record.decision}`)}
                    </span>
                    <span className="font-mono text-caption tnum text-slate">
                      {fmt.date(record.decidedAt)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
            {/* Records are never edited — a later decision supersedes, it does
                not overwrite (FR-28.4). */}
            <p className="mt-3 text-caption text-slate">{t('verification.historyNote')}</p>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
