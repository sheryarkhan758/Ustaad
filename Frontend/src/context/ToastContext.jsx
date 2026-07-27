/**
 * Confirmations.
 *
 * ── The naming rule ────────────────────────────────────────────────────────
 * **A confirmation names the action that produced it, in its completed form.**
 * "Send application" produces "Application sent". "Confirm booking" produces
 * "Booking confirmed". "Resolve report" produces "Report resolved".
 *
 * That is not a style preference. A generic "Success!" leaves somebody who
 * pressed two buttons in quick succession — or who was interrupted between
 * pressing and reading — with no way to know *which* thing worked. On a
 * platform where the two buttons might be "Decline" and "Confirm", that
 * ambiguity is expensive.
 *
 * `TOAST_COPY` below pairs each action with its completion so the two cannot
 * drift, and `toast.forAction('sendApplication')` is the only call site a
 * feature screen needs.
 *
 * ── Toasts carry no action ─────────────────────────────────────────────────
 * No "Undo", no "View". A control that vanishes on a timer is a control a slow
 * reader, a screen-reader user or somebody who looked away cannot use. Anything
 * worth offering belongs in the page, where it persists.
 */

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Toast, ToastRegion } from '../components/ui/Modal';

const ToastContext = createContext(null);

/**
 * Six seconds.
 *
 * Long enough to read a sentence in a second language, short enough not to sit
 * over the bottom action bar while somebody is trying to use it. Errors are not
 * toasted at all — they go in the page and stay there.
 */
const DEFAULT_DURATION = 6000;

/**
 * Action → the i18n key of its completed form.
 *
 * Adding an action here is what keeps the button and its confirmation in step.
 */
export const TOAST_COPY = {
  sendApplication: 'toast.applicationSent',
  sendReport: 'toast.reportSent',
  createAccount: 'toast.accountCreated',
  signIn: 'toast.signedIn',
  signOut: 'toast.signedOut',
  saveProfile: 'toast.profileSaved',
  confirmBooking: 'toast.bookingConfirmed',
  cancelBooking: 'toast.bookingCancelled',
  resolveReport: 'toast.reportResolved',
  postVacancy: 'toast.vacancyPosted',
  expressInterest: 'toast.interestSent',
  addStudent: 'toast.studentAdded',
};

export function ToastProvider({ children }) {
  const { t } = useTranslation('common');
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const show = useCallback(
    ({ title, description, tone = 'settled', duration = DEFAULT_DURATION }) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((current) => [...current, { id, title, description, tone }]);

      if (duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration),
        );
      }
      return id;
    },
    [dismiss],
  );

  /**
   * The call a feature screen makes.
   *
   * `toast.forAction('sendApplication')` → "Application sent", in whichever
   * language is active. An unknown action falls back to a generic
   * confirmation rather than throwing: a missing toast must never take down the
   * screen whose work already succeeded.
   */
  const forAction = useCallback(
    (action, options = {}) => {
      const key = TOAST_COPY[action];
      return show({
        title: key ? t(key) : t('toast.done'),
        ...options,
      });
    },
    [show, t],
  );

  const value = useMemo(() => ({ show, forAction, dismiss }), [show, forAction, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toasts.length > 0 ? (
        <ToastRegion>
          {toasts.map((toast) => (
            <Toast
              key={toast.id}
              tone={toast.tone}
              title={toast.title}
              description={toast.description}
              onDismiss={() => dismiss(toast.id)}
            />
          ))}
        </ToastRegion>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>.');
  return context;
}
