/**
 * The prerequisite graph — §2.4, FR-3.4.
 *
 * ── The spec's central worked example ──────────────────────────────────────
 * Select *quadratic equations* and the component shows that it depends on
 * *algebraic factorisation*, which depends on *signed-number arithmetic*. That
 * chain is the specification's own illustration and it is the idea the whole
 * product rests on: a student who "cannot do quadratics" usually cannot do
 * signed-number arithmetic, and drilling quadratics will not fix it.
 *
 * It reappears in the diagnostic agent's gap map and in the study plan, which
 * is why this is one reusable component rather than three drawings.
 *
 * ── Why a nested list and not a chart ──────────────────────────────────────
 * The obvious build is a node diagram. It would be the wrong choice here:
 * arrows on a 320px screen are unreadable, an SVG graph is invisible to a
 * screen reader without a parallel text version, and the relationship being
 * shown is genuinely hierarchical — "this rests on that".
 *
 * A nested `<ul>` says exactly that, in the one markup structure browsers and
 * assistive technology already agree about. It reads correctly right-to-left
 * with no work, keyboard-navigates for free, and prints.
 *
 * ── Depth, and why it is bounded ───────────────────────────────────────────
 * The graph is acyclic and board-scoped, and the seed validates that. This
 * still tracks visited nodes and caps depth, because a component that renders
 * user-reachable data must not be the thing that hangs if an invariant is ever
 * broken upstream.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge, EmptyState, Skeleton } from '../ui/Card';
import { usePrerequisites, useLocalName } from '../../lib/reference';

/** Deep enough for any real chain; short enough to be a guard. */
const MAX_DEPTH = 8;

/**
 * Build the dependency tree beneath one topic.
 *
 * `ancestors` carries the path taken to get here, so a cycle — which should not
 * exist — is detected and cut rather than followed forever.
 */
function buildTree(topicId, edgesByTopic, topicsById, ancestors = new Set(), depth = 0) {
  const topic = topicsById.get(topicId);
  if (!topic) return null;

  const children =
    depth >= MAX_DEPTH
      ? []
      : (edgesByTopic.get(topicId) ?? [])
          .filter((prerequisiteId) => !ancestors.has(prerequisiteId))
          .map((prerequisiteId) =>
            buildTree(
              prerequisiteId,
              edgesByTopic,
              topicsById,
              new Set([...ancestors, topicId]),
              depth + 1,
            ),
          )
          .filter(Boolean);

  return { topic, children, depth };
}

function TopicNode({ node, localName, isRoot }) {
  const { t } = useTranslation('search');
  const shown = localName(node.topic);
  const hasChildren = node.children.length > 0;

  return (
    <li className="relative">
      <div
        className={[
          'flex flex-wrap items-center gap-2 rounded-control border px-3 py-2',
          isRoot
            ? 'border-verdigris bg-verdigris-soft'
            : 'border-slate-line bg-white',
        ].join(' ')}
      >
        <span
          lang={shown.lang}
          className={isRoot ? 'text-small font-semibold text-verdigris-deep' : 'text-small text-ink'}
        >
          {shown.text}
        </span>

        {node.topic.chapterRef ? (
          <span className="font-mono text-caption text-slate">{node.topic.chapterRef}</span>
        ) : null}

        {isRoot ? <Badge tone="info">{t('prereq.selected')}</Badge> : null}

        {/* A leaf is where the chain bottoms out — the actual foundation. */}
        {!hasChildren && !isRoot ? <Badge tone="neutral">{t('prereq.foundation')}</Badge> : null}
      </div>

      {hasChildren ? (
        <>
          <p className="ms-4 mt-1 text-caption text-slate">{t('prereq.dependsOn')}</p>
          {/*
            `border-s` and `ms-*`: the guide rule sits on the reading-start edge
            in both directions, so the indentation reads correctly in Urdu.
          */}
          <ul className="ms-4 mt-1 space-y-2 border-s-2 border-slate-line ps-4">
            {node.children.map((child) => (
              <TopicNode key={child.topic.id} node={child} localName={localName} isRoot={false} />
            ))}
          </ul>
        </>
      ) : null}
    </li>
  );
}

/**
 * @param {object} props
 * @param {string[]} props.topicIds Roots to explain. Usually one.
 */
export function PrerequisiteBrowser({ topicIds = [] }) {
  const { t } = useTranslation(['search', 'common']);
  const localName = useLocalName();
  const query = usePrerequisites(topicIds);

  const trees = useMemo(() => {
    if (!query.data) return [];

    const topicsById = new Map((query.data.topics ?? []).map((topic) => [topic.id, topic]));

    const edgesByTopic = new Map();
    for (const edge of query.data.edges ?? []) {
      const list = edgesByTopic.get(edge.topicId) ?? [];
      list.push(edge.prerequisiteTopicId);
      edgesByTopic.set(edge.topicId, list);
    }

    return topicIds.map((id) => buildTree(id, edgesByTopic, topicsById)).filter(Boolean);
  }, [query.data, topicIds]);

  if (topicIds.length === 0) {
    return (
      <EmptyState
        title={t('prereq.emptyTitle')}
        description={t('prereq.emptyBody')}
      />
    );
  }

  if (query.isPending) {
    return (
      <div role="status" aria-label={t('common:state.loading')} className="space-y-2">
        <span className="sr-only">{t('common:state.loading')}</span>
        <Skeleton className="h-10 w-3/4" />
        <Skeleton className="ms-6 h-10 w-2/3" />
        <Skeleton className="ms-12 h-10 w-1/2" />
      </div>
    );
  }

  if (trees.length === 0) {
    return <EmptyState title={t('prereq.noneTitle')} description={t('prereq.noneBody')} />;
  }

  return (
    <div className="space-y-4">
      <p className="text-small text-slate">{t('prereq.explanation')}</p>

      {trees.map((tree) => (
        <ul key={tree.topic.id} className="space-y-2">
          <TopicNode node={tree} localName={localName} isRoot />
        </ul>
      ))}
    </div>
  );
}
