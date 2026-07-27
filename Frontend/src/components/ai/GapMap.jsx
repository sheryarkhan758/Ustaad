/**
 * The gap map — §6.10, FR-10.5, FR-10.10.
 *
 * ── The finding, not the symptom ───────────────────────────────────────────
 * The point of the whole diagnostic is that the topic a family names is
 * usually not the topic that is broken. A parent says "she cannot do quadratic
 * equations"; the agent finds she cannot factorise, and underneath that cannot
 * reliably handle signed numbers. Teaching quadratics harder does nothing.
 *
 * So the **root gap comes first and is marked as the root**, with the symptom
 * shown as what led there rather than as an equal item in a list. A flat list
 * of weak topics would bury the finding among its consequences and hand the
 * family back exactly the confusion they arrived with.
 *
 * ── The chain is the evidence ──────────────────────────────────────────────
 * `PrerequisiteBrowser` — the component from the cascading-selector task —
 * renders the real prerequisite edges from reference data, not from the model.
 * That matters: the agent classified which topics are weak, and the *graph*
 * says what depends on what. A parent can follow the chain themselves and
 * disagree with the reading, which is only possible because the two come from
 * different places.
 *
 * ── What it could not work out is listed, not hidden ───────────────────────
 * FR-10.10. An agent that quietly drops the topics it failed to resolve looks
 * more confident than it is. Naming them is also what tells a family which
 * question to answer next.
 */

import { useTranslation } from 'react-i18next';

import { PrerequisiteBrowser } from '../pickers/PrerequisiteBrowser';
import { Badge, Card, CardBody } from '../ui/Card';
import { UserText } from '../ui/UserText';
import { useLocalName, usePrerequisites } from '../../lib/reference';

function GapRow({ gap, name }) {
  const { t } = useTranslation('ai');

  return (
    <li
      className={[
        'rounded-control border px-3 py-2.5',
        gap.isRootGap ? 'border-verdigris-deep bg-verdigris-soft' : 'border-slate-line bg-white',
      ].join(' ')}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-small font-medium text-ink" lang={name?.lang}>
          {name?.text ?? gap.topicId}
        </span>
        {gap.isRootGap ? <Badge tone="verdigris">{t('gapMap.rootGap')}</Badge> : null}
      </div>

      {/*
        The agent's rationale, in the parent's own terms and often quoting
        them. Rendered verbatim — it is a classification of what *they* said
        and paraphrasing it would misrepresent both sides (§2.10).
      */}
      {gap.rationale ? (
        <UserText className="mt-1 text-caption text-slate">{gap.rationale}</UserText>
      ) : null}
    </li>
  );
}

export function GapMap({ gaps = [], insufficientInfo = [] }) {
  const { t } = useTranslation('ai');
  const localName = useLocalName();

  /*
   * Names come from the same call that draws the chain below — the
   * prerequisite endpoint returns the topic rows for everything reachable, so
   * naming a gap costs no extra request and cannot disagree with the graph.
   */
  const graph = usePrerequisites(gaps.map((gap) => gap.topicId));

  const nameFor = (topicId) => {
    const row = (graph.data?.topics ?? []).find((topic) => topic.id === topicId);
    return row ? localName(row) : null;
  };

  if (gaps.length === 0 && insufficientInfo.length === 0) return null;

  // Root first. See the header: the ordering is the finding.
  const ordered = [...gaps].sort((a, b) => Number(b.isRootGap) - Number(a.isRootGap));
  const roots = ordered.filter((gap) => gap.isRootGap);

  return (
    <Card>
      <CardBody className="space-y-4">
        <div>
          <h2 className="font-display text-subtitle text-ink">{t('gapMap.title')}</h2>
          <p className="mt-0.5 text-caption text-slate">{t('gapMap.subtitle')}</p>
        </div>

        {ordered.length > 0 ? (
          <ul className="space-y-2">
            {ordered.map((gap) => (
              <GapRow key={gap.topicId} gap={gap} name={nameFor(gap.topicId)} />
            ))}
          </ul>
        ) : null}

        {/*
          The chain, from reference data. Anchored on the root gap where one
          was found — that is the topic whose prerequisites explain the rest.
        */}
        {roots.length > 0 ? (
          <div>
            <h3 className="text-caption font-semibold uppercase tracking-wide text-slate">
              {t('gapMap.chainHeading')}
            </h3>
            <p className="mb-2 mt-0.5 text-caption text-slate">{t('gapMap.chainNote')}</p>
            <PrerequisiteBrowser topicIds={roots.map((gap) => gap.topicId)} />
          </div>
        ) : null}

        {/* FR-10.10 — named, not silently dropped. */}
        {insufficientInfo.length > 0 ? (
          <div className="rounded-control border border-slate-line bg-paper px-3 py-2.5">
            <h3 className="text-caption font-semibold uppercase tracking-wide text-slate">
              {t('gapMap.unresolvedHeading')}
            </h3>
            <ul className="mt-1 space-y-0.5">
              {insufficientInfo.map((item) => (
                <li key={item}>
                  <UserText className="text-caption text-ink">{item}</UserText>
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-caption text-slate">{t('gapMap.unresolvedNote')}</p>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
