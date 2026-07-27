/**
 * Form state validated by the **same Zod schema the server uses**.
 *
 * ── Why the schema is imported, not copied ─────────────────────────────────
 * `Backend/shared/` holds the single definition of what a registration or a
 * login may contain, and the server validates against it as the actual gate
 * (NFR-6, NFR-7). This hook validates against the identical object.
 *
 * A copied schema is a second definition, and the two drift the first time
 * somebody raises a minimum length on one side. The failure that produces is
 * the worst kind: the form says a password is fine, the server refuses it, and
 * the person is told nothing useful about which of the two is right.
 *
 * **The client copy is never trusted.** It exists so somebody is told about a
 * problem before they submit, not so the server can skip checking.
 *
 * ── Validation timing ──────────────────────────────────────────────────────
 * Fields validate on **blur**, not on every keystroke. Telling somebody their
 * email is invalid while they are still typing the third character is not help;
 * it is an interface arguing with a person mid-thought. After a failed submit,
 * a field that has been corrected re-validates live, so the error clears as
 * soon as it is fixed rather than waiting for another submit.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Map a ZodError onto `{ fieldName: message }`.
 *
 * Only the first issue per field is kept. A field with three simultaneous
 * complaints produces a wall of red that says less than one clear sentence.
 */
function collectIssues(error) {
  const issues = {};
  for (const issue of error.issues ?? []) {
    const key = issue.path.join('.') || '_form';
    if (!(key in issues)) issues[key] = issue.message;
  }
  return issues;
}

/**
 * @param {object} options
 * @param {import('zod').ZodTypeAny} options.schema The shared schema. Required.
 * @param {object} options.initialValues
 * @param {(values: object) => Promise<unknown>} options.onSubmit
 */
export function useZodForm({ schema, initialValues = {}, onSubmit }) {
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  /** A server-side refusal that is not about one field — e.g. bad credentials. */
  const [formError, setFormError] = useState(null);

  /** Focused when a submit fails. See `FormErrorSummary`. */
  const summaryRef = useRef(null);

  /**
   * Set when a submit fails; consumed by the effect below.
   *
   * **Focus cannot be moved inside the submit handler.** The summary only
   * renders once there is something to show, so at the moment the handler runs
   * `summaryRef.current` is still null and the `focus()` call silently does
   * nothing — which is precisely the accessibility failure the summary exists
   * to prevent: a keyboard or screen-reader user presses the button, nothing is
   * announced, and the form appears to have ignored them.
   *
   * So the request is recorded and acted on after React has committed the
   * summary to the DOM.
   */
  const [focusSummary, setFocusSummary] = useState(0);

  useEffect(() => {
    if (focusSummary > 0) summaryRef.current?.focus();
  }, [focusSummary]);

  const validate = useCallback(
    (candidate) => {
      const result = schema.safeParse(candidate);
      return result.success ? {} : collectIssues(result.error);
    },
    [schema],
  );

  const setValue = useCallback(
    (name, value) => {
      setValues((current) => {
        const next = { ...current, [name]: value };

        // Re-validate live only once the person has already been shown an
        // error for this field. Before that, typing is not a mistake.
        setErrors((currentErrors) => {
          if (!submitted && !touched[name]) return currentErrors;
          const fresh = validate(next);
          return { ...currentErrors, [name]: fresh[name] };
        });

        return next;
      });
      setFormError(null);
    },
    [submitted, touched, validate],
  );

  const handleBlur = useCallback(
    (name) => {
      setTouched((current) => ({ ...current, [name]: true }));
      setErrors((current) => ({ ...current, [name]: validate(values)[name] }));
    },
    [validate, values],
  );

  const handleSubmit = useCallback(
    async (event) => {
      event?.preventDefault?.();
      setSubmitted(true);
      setFormError(null);

      const found = validate(values);
      setErrors(found);

      if (Object.keys(found).length > 0) {
        // Move focus to the summary rather than to the first bad field. The
        // summary says how many problems there are and lets someone choose
        // which to fix; jumping straight into a field hides the rest.
        setFocusSummary((n) => n + 1);
        return;
      }

      setSubmitting(true);
      try {
        await onSubmit?.(schema.parse(values));
      } catch (error) {
        // A server refusal may carry per-field issues (`validation_failed`) or
        // be about the request as a whole (`invalid_credentials`). Both are
        // rendered in the person's own language by the caller's copy.
        if (error?.issues?.length) {
          const mapped = {};
          for (const issue of error.issues) {
            if (issue.path && !(issue.path in mapped)) mapped[issue.path] = issue.message;
          }
          setErrors(mapped);
          setFocusSummary((n) => n + 1);
        } else {
          setFormError(error);
          setFocusSummary((n) => n + 1);
        }
      } finally {
        setSubmitting(false);
      }
    },
    [onSubmit, schema, validate, values],
  );

  /** Spread onto a control: value, handlers and the wiring `Field` needs. */
  const field = useCallback(
    (name) => ({
      name,
      value: values[name] ?? '',
      onChange: (event) => {
        const target = event?.target;
        setValue(name, target?.type === 'checkbox' ? target.checked : target?.value ?? event);
      },
      onBlur: () => handleBlur(name),
    }),
    [values, setValue, handleBlur],
  );

  const errorList = useMemo(
    () =>
      Object.entries(errors)
        .filter(([, message]) => Boolean(message))
        .map(([name, message]) => ({ name, message })),
    [errors],
  );

  return {
    values,
    errors,
    errorList,
    formError,
    touched,
    submitted,
    submitting,
    summaryRef,
    field,
    setValue,
    setValues,
    setFormError,
    handleSubmit,
    /** True when the schema is satisfied. Never used to skip the server. */
    isValid: errorList.length === 0 && Object.keys(values).length > 0,
  };
}
