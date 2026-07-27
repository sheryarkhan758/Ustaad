/**
 * The platform feedback channel — §6.32.
 *
 * Feedback about **Ustaad.com itself**, never about a tutor. A review is a
 * different thing with a different table and a different audience, and merging
 * the two would put "the site is slow" into a tutor's public record.
 *
 * ── Anonymous is a first-class path ────────────────────────────────────────
 * `POST /api/feedback` requires no account (FR-32.6). Somebody reporting that a
 * verification badge looks wrong may specifically not want to be identified,
 * and requiring a login to say so is how a platform stops hearing it.
 *
 * The page path, locale and app version are captured automatically (FR-32.4)
 * because a report saying "the button does not work" is worth very little
 * without knowing which page it was on.
 */

import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';

import { api } from '../../lib/api';
import { Button } from '../ui/Button';
import { Checkbox, Field, Select, Textarea } from '../ui/Field';
import { Modal } from '../ui/Modal';
import { ErrorState } from '../ui/Card';

/** Mirrors the server's `FEEDBACK_CATEGORIES`. */
const CATEGORIES = [
  { value: 'defect', label: 'Something is broken' },
  { value: 'usability', label: 'Something is hard to use' },
  { value: 'incorrect_ai_output', label: 'The AI gave a wrong answer' },
  { value: 'missing_feature', label: 'Something is missing' },
  { value: 'content_or_safety', label: 'A safety or content concern' },
  { value: 'other', label: 'Something else' },
];

export function FeedbackDialog({ open, onClose }) {
  const location = useLocation();
  const [category, setCategory] = useState('usability');
  const [detail, setDetail] = useState('');
  const [safety, setSafety] = useState(false);
  const [done, setDone] = useState(false);

  // Reset when reopened, so a previous submission is not still on screen.
  useEffect(() => {
    if (open) {
      setDone(false);
      setDetail('');
      setSafety(false);
    }
  }, [open]);

  const submit = useMutation({
    mutationFn: () =>
      api.post('/feedback', {
        category,
        detail,
        safetyConcernFlag: safety,
        // FR-32.4 — captured, not asked for.
        pagePath: location.pathname,
        locale: document.documentElement.lang || 'en',
        appVersion: import.meta.env?.VITE_APP_VERSION ?? '0.1.0',
      }),
    onSuccess: () => setDone(true),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={done ? 'Thank you' : 'Report a problem'}
      description={
        done
          ? undefined
          : 'This goes to the Ustaad.com team, not to any tutor. You do not need an account.'
      }
      footer={
        done ? (
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              busy={submit.isPending}
              disabled={detail.trim().length < 10}
              onClick={() => submit.mutate()}
            >
              Send report
            </Button>
          </>
        )
      }
    >
      {done ? (
        <p className="text-small text-ink">
          Your report has been recorded and is in the team&rsquo;s queue. If you raised a safety
          concern, it is prioritised and is never shown to the tutor concerned.
        </p>
      ) : (
        <div className="space-y-4">
          {submit.isError ? <ErrorState error={submit.error} /> : null}

          <Field label="What kind of problem is it?" required>
            {(props) => (
              <Select {...props} value={category} onChange={(e) => setCategory(e.target.value)}>
                {CATEGORIES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field
            label="What happened?"
            required
            hint="Write in English or Urdu — whichever you prefer. It is stored exactly as you write it."
          >
            {(props) => (
              <Textarea
                {...props}
                value={detail}
                onChange={(e) => setDetail(e.target.value)}
                maxLength={4000}
                placeholder="The area filter was hard to find on my phone…"
              />
            )}
          </Field>

          <Checkbox
            label="This is a safety concern"
            hint="Safety reports jump the queue and are never shown to the tutor concerned."
            checked={safety}
            onChange={(e) => setSafety(e.target.checked)}
          />
        </div>
      )}
    </Modal>
  );
}
