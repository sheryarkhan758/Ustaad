/**
 * Subject claims — §6.4, §6.11, and the platform's whole argument (§2.2).
 *
 * ── The distinction this component exists to make unmissable ───────────────
 * A **claim** is something a tutor said about herself. A **verified badge** is
 * something the platform tested. Every other tuition site in this market
 * conflates the two, and that conflation is precisely what Ustaad.com exists
 * not to do.
 *
 * So an untested claim is never rendered in a way that could be mistaken for a
 * verified one. Concretely:
 *
 *  · The words are different: "Asserted — not yet tested" against
 *    "Passed assessment". Never "Verified" on a claim, never a tick.
 *  · The colour is different: asserted is neutral grey, verified is teal. The
 *    seal ochre never appears here at all — that belongs to the identity record.
 *  · The **shape** is different: an asserted claim is drawn with a dashed
 *    border. Colour alone fails a colour-blind reader, and a badge that means
 *    something this important cannot depend on hue.
 *  · Asserted claims carry an explanatory line saying what has and has not
 *    happened. A verified one carries its date and expiry.
 *
 * `claimStatus` is only ever `asserted` when a tutor writes it — the server
 * refuses anything else from a tutor-facing endpoint, and Agent 2 is the only
 * writer of `verified`. This component renders that truth rather than
 * decorating it.
 */

import { useTranslation } from 'react-i18next';

import { Badge, Card, CardBody, EmptyState } from '../ui/Card';
import { Button } from '../ui/Button';
import { Check, Clock, Warning } from '../ui/Icon';
import { useFormat } from '../../lib/format';
import { useLocalName } from '../../lib/reference';

/**
 * How each status is presented.
 *
 * `dashed` is the non-colour signal. `tone` never uses `settled` green for
 * `asserted`, and never uses anything for `asserted` that a glance could read
 * as approval.
 */
const PRESENTATION = {
  asserted: { tone: 'neutral', dashed: true, Icon: Clock, labelKey: 'claims.statusAsserted' },
  under_assessment: { tone: 'info', dashed: true, Icon: Clock, labelKey: 'claims.statusUnderAssessment' },
  verified: { tone: 'info', dashed: false, Icon: Check, labelKey: 'claims.statusVerified' },
  failed: { tone: 'flag', dashed: false, Icon: Warning, labelKey: 'claims.statusFailed' },
  expired: { tone: 'warning', dashed: false, Icon: Warning, labelKey: 'claims.statusExpired' },
  appealed: { tone: 'warning', dashed: false, Icon: Clock, labelKey: 'claims.statusAppealed' },
};

function ClaimCard({ claim, subjects, levels, boards, topics, onRemove, onRequestAssessment }) {
  const { t } = useTranslation(['tutor', 'common']);
  const fmt = useFormat();
  const localName = useLocalName();

  const presentation = PRESENTATION[claim.claimStatus] ?? PRESENTATION.asserted;
  const { Icon } = presentation;

  const named = (list, id) => {
    const row = list?.find((item) => item.id === id);
    return row ? localName(row) : { text: id, lang: undefined };
  };

  const subject = named(subjects, claim.subjectId);
  const level = named(levels, claim.levelId);
  const board = named(boards, claim.boardId);

  const isTested = claim.claimStatus === 'verified';

  return (
    <li>
      <Card
        className={[
          // The shape signal. A dashed edge reads as provisional at a glance
          // and survives greyscale, a colour-blind reader and a cheap screen.
          presentation.dashed ? 'border-dashed' : '',
          isTested ? 'border-verdigris/40' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <CardBody className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-display text-subtitle text-ink">
                <span lang={subject.lang}>{subject.text}</span>
              </p>
              <p className="mt-0.5 text-small text-slate">
                <span lang={level.lang}>{level.text}</span>
                {' · '}
                {/* Board named on every claim — decision 5. */}
                <span lang={board.lang}>{board.text}</span>
              </p>
            </div>

            <Badge tone={presentation.tone}>
              <Icon size="sm" />
              {t(presentation.labelKey)}
            </Badge>
          </div>

          {/*
            The explanatory line. An untested claim says so in words, not only
            in colour — this is the sentence that stops a parent reading a
            claim as a credential.
          */}
          <p
            className={[
              'text-small',
              isTested ? 'text-verdigris-deep' : 'text-slate',
            ].join(' ')}
          >
            {isTested
              ? t('claims.verifiedExplain', {
                  date: fmt.date(claim.verifiedAt),
                  expires: fmt.date(claim.expiresOn),
                })
              : t(`claims.explain.${claim.claimStatus}`, {
                  defaultValue: t('claims.explain.asserted'),
                })}
          </p>

          {(claim.topicIds ?? []).length > 0 ? (
            <ul className="flex flex-wrap gap-1.5">
              {claim.topicIds.map((topicId) => {
                const topic = named(topics, topicId);
                return (
                  <li key={topicId}>
                    <Badge tone="neutral">
                      <span lang={topic.lang}>{topic.text}</span>
                    </Badge>
                  </li>
                );
              })}
            </ul>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {claim.claimStatus === 'asserted' ? (
              <Button size="sm" variant="accent" onClick={() => onRequestAssessment?.(claim.id)}>
                {t('claims.requestAssessment')}
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={() => onRemove?.(claim.id)}>
              {t('claims.withdraw')}
            </Button>
          </div>
        </CardBody>
      </Card>
    </li>
  );
}

export function ClaimList({
  claims = [],
  subjects,
  levels,
  boards,
  topics,
  onRemove,
  onRequestAssessment,
}) {
  const { t } = useTranslation('tutor');

  if (claims.length === 0) {
    return <EmptyState title={t('claims.emptyTitle')} description={t('claims.emptyBody')} />;
  }

  const untested = claims.filter((claim) => claim.claimStatus === 'asserted').length;

  return (
    <div className="space-y-4">
      {/*
        Said once, plainly, above the list. A tutor who understands that a claim
        is not a badge is a tutor who will sit the assessment.
      */}
      {untested > 0 ? (
        <div className="rounded-card border border-slate-line bg-paper p-4">
          <p className="text-small font-semibold text-ink">
            {t('claims.untestedTitle', { count: untested })}
          </p>
          <p className="mt-1 text-small text-slate">{t('claims.untestedBody')}</p>
        </div>
      ) : null}

      <ul className="space-y-3">
        {claims.map((claim) => (
          <ClaimCard
            key={claim.id}
            claim={claim}
            subjects={subjects}
            levels={levels}
            boards={boards}
            topics={topics}
            onRemove={onRemove}
            onRequestAssessment={onRequestAssessment}
          />
        ))}
      </ul>
    </div>
  );
}
