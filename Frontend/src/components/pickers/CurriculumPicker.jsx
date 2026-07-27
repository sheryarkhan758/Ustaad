/**
 * Subject → level → board → topics — §6.3.
 *
 * ── Board is a first-class choice ──────────────────────────────────────────
 * Decision 5: *a Sindh Board tutor and a Cambridge tutor are not
 * interchangeable.* The usual way this gets built is subject and level as
 * prominent selects with board tucked underneath as a refinement, and that is
 * wrong — the board changes the syllabus, the topic list, the exam and the
 * teaching. Two Matric Mathematics tutors on different boards are teaching
 * different courses.
 *
 * So board is rendered at the same visual weight as subject, as a set of
 * radio-style cards rather than a dropdown: a choice you make, not a default
 * you accept. The topic list stays disabled until all three are chosen rather
 * than guessing a board, because a guessed board produces a topic list that is
 * confidently wrong.
 *
 * ── The cascade never leaves a stale child ─────────────────────────────────
 * Changing subject, level or board clears the selected topics. A form holding
 * `math-matric-sindh-quadratic-equations` after the user switched to Cambridge
 * submits a Sindh topic against a Cambridge board.
 */

import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge } from '../ui/Card';
import { Combobox } from '../ui/Combobox';
import { Field } from '../ui/Field';
import { Check } from '../ui/Icon';
import { useBoards, useLevels, useLocalName, useSubjects, useTopics } from '../../lib/reference';

/**
 * @param {object} props
 * @param {{subjectId, levelId, boardId, topicIds}} props.value
 */
export function CurriculumPicker({ value = {}, onChange, errors = {}, disabled = false }) {
  const { t } = useTranslation(['search', 'common']);
  const localName = useLocalName();

  const subjects = useSubjects();
  const levels = useLevels();
  const boards = useBoards();
  const topics = useTopics({
    subjectId: value.subjectId,
    levelId: value.levelId,
    boardId: value.boardId,
  });

  const set = useCallback((patch) => onChange?.({ ...value, ...patch }), [onChange, value]);

  // Any change to the triple invalidates the topic selection.
  const setSubject = useCallback((subjectId) => set({ subjectId, topicIds: [] }), [set]);
  const setLevel = useCallback((levelId) => set({ levelId, topicIds: [] }), [set]);
  const setBoard = useCallback((boardId) => set({ boardId, topicIds: [] }), [set]);

  /**
   * The safety net: topics arrive after a restored value, and a held topic
   * turns out not to belong to the current triple.
   */
  useEffect(() => {
    const chosen = value.topicIds ?? [];
    if (chosen.length === 0 || !topics.data) return;

    const valid = new Set(topics.data.map((topic) => topic.id));
    const kept = chosen.filter((id) => valid.has(id));
    if (kept.length !== chosen.length) set({ topicIds: kept });
  }, [topics.data, value.topicIds, set]);

  const selectedTopics = new Set(value.topicIds ?? []);

  const toggleTopic = useCallback(
    (topicId) => {
      const current = new Set(value.topicIds ?? []);
      if (current.has(topicId)) current.delete(topicId);
      else current.add(topicId);
      set({ topicIds: [...current] });
    },
    [set, value.topicIds],
  );

  const tripleComplete = Boolean(value.subjectId && value.levelId && value.boardId);

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('filters.subject')} error={errors.subjectId}>
          {(props) => (
            <Combobox
              {...props}
              label={t('filters.subject')}
              value={value.subjectId ?? null}
              onChange={setSubject}
              options={subjects.data ?? []}
              renderName={localName}
              disabled={disabled || subjects.isPending}
              invalid={Boolean(errors.subjectId)}
            />
          )}
        </Field>

        <Field label={t('filters.level')} error={errors.levelId}>
          {(props) => (
            <Combobox
              {...props}
              label={t('filters.level')}
              value={value.levelId ?? null}
              onChange={setLevel}
              options={levels.data ?? []}
              renderName={localName}
              disabled={disabled || levels.isPending}
              invalid={Boolean(errors.levelId)}
            />
          )}
        </Field>
      </div>

      {/*
        Board, at the same weight as subject — decision 5. Cards rather than a
        dropdown, because a dropdown with a default is a choice people skip.
      */}
      <fieldset disabled={disabled}>
        <legend className="text-small font-medium text-ink">
          {t('filters.board')}
          <span className="ms-1 text-flag" aria-hidden="true">
            *
          </span>
        </legend>
        <p className="mt-1 text-caption text-slate">{t('picker.boardMatters')}</p>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {(boards.data ?? []).map((board) => {
            const shown = localName(board);
            const isSelected = value.boardId === board.id;
            return (
              <label
                key={board.id}
                className={[
                  'flex min-h-tap cursor-pointer items-center gap-2 rounded-control border px-3 py-2 text-small transition-colors',
                  isSelected
                    ? 'border-verdigris bg-verdigris-soft font-semibold text-verdigris-deep'
                    : 'border-slate-line bg-white text-ink hover:border-slate',
                ].join(' ')}
              >
                <input
                  type="radio"
                  name="boardId"
                  value={board.id}
                  checked={isSelected}
                  onChange={() => setBoard(board.id)}
                  className="sr-only"
                />
                {isSelected ? <Check size="sm" /> : null}
                <span lang={shown.lang}>{shown.text}</span>
              </label>
            );
          })}
        </div>

        {errors.boardId ? (
          <p role="alert" className="mt-2 text-caption font-medium text-flag">
            {errors.boardId}
          </p>
        ) : null}
      </fieldset>

      {/* Topics — multi-select, and only once the triple is complete. */}
      <div>
        <p className="text-small font-medium text-ink">{t('picker.topics')}</p>
        <p className="mt-1 text-caption text-slate">
          {tripleComplete ? t('picker.topicsHint') : t('picker.topicsNeedTriple')}
        </p>

        {tripleComplete ? (
          topics.isPending ? (
            <p className="mt-3 text-small text-slate">{t('common:state.loading')}</p>
          ) : (topics.data ?? []).length === 0 ? (
            <p className="mt-3 text-small text-slate">{t('picker.noTopics')}</p>
          ) : (
            <ul className="mt-3 flex flex-wrap gap-2">
              {topics.data.map((topic) => {
                const shown = localName(topic);
                const isSelected = selectedTopics.has(topic.id);
                return (
                  <li key={topic.id}>
                    <button
                      type="button"
                      // A toggle button, so a screen reader hears its state
                      // rather than only its label.
                      aria-pressed={isSelected}
                      onClick={() => toggleTopic(topic.id)}
                      className={[
                        'flex min-h-tap items-center gap-1.5 rounded-full border px-3 text-small transition-colors',
                        isSelected
                          ? 'border-verdigris bg-verdigris-soft font-medium text-verdigris-deep'
                          : 'border-slate-line bg-white text-ink hover:border-slate',
                      ].join(' ')}
                    >
                      {isSelected ? <Check size="sm" /> : null}
                      <span lang={shown.lang}>{shown.text}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )
        ) : null}

        {selectedTopics.size > 0 ? (
          <p className="mt-3 text-caption text-slate">
            <Badge tone="info">{selectedTopics.size}</Badge>{' '}
            {t('picker.topicsSelected', { count: selectedTopics.size })}
          </p>
        ) : null}
      </div>
    </div>
  );
}
