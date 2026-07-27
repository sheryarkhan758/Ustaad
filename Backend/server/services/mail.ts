/**
 * EmailJS dispatch — FR-32.9, FR-33.6, FR-33.7, FR-33.8, SEC-25.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * EmailJS is a notification channel. It is not a system of record.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * That sentence is the whole module. A monthly quota reached, a template
 * renamed, a blocked request — any of these makes a send fail, and if the email
 * were the only artefact the application would be gone while the applicant's
 * browser showed a success message. They would wait for a reply that could
 * never come, and nobody at the platform would know there was anyone to reply
 * to.
 *
 * So FR-33.9 fixes the order and this module is built to make that order the
 * only one available: **`dispatch` never creates anything.** It takes an id
 * that already exists, sends, and hands back an outcome for the caller to
 * record against the row. There is no code path here that could be mistaken for
 * a write.
 *
 * ── It never throws ─────────────────────────────────────────────────────────
 *
 * A failed send returns `{ status: 'failed' }`. It does not raise, because the
 * caller's next line is "record the outcome" and an exception would skip it —
 * turning a recorded failure, which is recoverable by a retry sweep, into an
 * unrecorded one, which is not.
 *
 * ── Credentials ─────────────────────────────────────────────────────────────
 *
 * Service id, template id and public key come from the environment (SEC-25,
 * FR-33.8). The public key is public by design — it is meant to sit in a
 * browser bundle. **There is no SMTP credential, no mail password and no
 * private key here or anywhere in this repository**, because EmailJS's model
 * does not use one; the private key below is optional and, when present, is
 * EmailJS's own server-side strict-mode token, never a mail password.
 *
 * A public key on an open send endpoint is still an open send endpoint. That is
 * what the rate limiter and the honeypot in `shared/anti-abuse.ts` are for, and
 * why FR-33.8 calls them requirements rather than refinements.
 */

const EMAILJS_ENDPOINT = 'https://api.emailjs.com/api/v1.0/email/send';

export type MailDispatchStatus = 'pending' | 'sent' | 'failed' | 'skipped';

export interface MailDispatchResult {
  status: MailDispatchStatus;
  /** Short, safe to log, and never containing a field value. */
  detail: string;
}

export interface MailTemplateSelection {
  /** `EMAILJS_TEMPLATE_VOLUNTEER`, `EMAILJS_TEMPLATE_FEEDBACK`, … */
  templateEnvVar: string;
}

export interface MailMessage extends MailTemplateSelection {
  /**
   * Template variables. Values are inserted into an email, so this is the one
   * place a phone number or a free-text detail legitimately leaves the
   * database — and the one place none of it may be logged (CLAUDE.md §2.2).
   */
  params: Record<string, string | number | null>;
}

export interface Mailer {
  readonly name: string;
  send(message: MailMessage): Promise<MailDispatchResult>;
}

function configured(value: string | undefined): value is string {
  return !!value && value.trim() !== '' && !value.startsWith('REPLACE_');
}

/* -------------------------------------------------------------------------
 * The real sender
 * ---------------------------------------------------------------------- */

class EmailJsMailer implements Mailer {
  readonly name = 'emailjs';

  async send(message: MailMessage): Promise<MailDispatchResult> {
    const serviceId = process.env.EMAILJS_SERVICE_ID;
    const publicKey = process.env.EMAILJS_PUBLIC_KEY;
    const templateId = process.env[message.templateEnvVar];

    if (!configured(serviceId) || !configured(publicKey) || !configured(templateId)) {
      // Not a failure: nothing was misconfigured at runtime, the channel simply
      // is not set up. Distinguished from `failed` so a retry sweep does not
      // hammer an endpoint that was never going to work.
      return {
        status: 'skipped',
        detail: `EmailJS is not configured (${message.templateEnvVar})`,
      };
    }

    try {
      const response = await fetch(EMAILJS_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_id: serviceId,
          template_id: templateId,
          user_id: publicKey,
          // EmailJS's strict mode. Optional, and NOT a mail password.
          ...(configured(process.env.EMAILJS_PRIVATE_KEY)
            ? { accessToken: process.env.EMAILJS_PRIVATE_KEY }
            : {}),
          template_params: message.params,
        }),
        signal: AbortSignal.timeout(Number(process.env.MAIL_TIMEOUT_MS ?? 10_000)),
      });

      if (!response.ok) {
        // The status and nothing else. An EmailJS error body echoes the
        // template parameters, which carry the applicant's phone number.
        return { status: 'failed', detail: `EmailJS responded ${response.status}` };
      }

      return { status: 'sent', detail: 'accepted by EmailJS' };
    } catch (error) {
      const reason = error instanceof Error ? error.name : 'unknown error';
      return { status: 'failed', detail: `EmailJS request failed (${reason})` };
    }
  }
}

/**
 * What runs when EmailJS is not configured — development, and the test suite.
 *
 * Reports `skipped`, so the row records honestly that no mail went out rather
 * than claiming a send that never happened.
 */
class NoopMailer implements Mailer {
  readonly name = 'noop';

  send(message: MailMessage): Promise<MailDispatchResult> {
    return Promise.resolve({
      status: 'skipped',
      detail: `no mailer configured; ${message.templateEnvVar} not dispatched`,
    });
  }
}

let cached: Mailer | null = null;

export function getMailer(): Mailer {
  if (cached) return cached;
  cached = configured(process.env.EMAILJS_SERVICE_ID) ? new EmailJsMailer() : new NoopMailer();
  return cached;
}

/** Test seam. */
export function setMailer(mailer: Mailer | null): void {
  cached = mailer;
}

/* -------------------------------------------------------------------------
 * Dispatch
 * ---------------------------------------------------------------------- */

/**
 * Send one or more messages and report the worst outcome.
 *
 * Both the team notification and the applicant acknowledgement go out in the
 * same dispatch (FR-33.7). "Worst" is deliberate: if the team was notified but
 * the applicant was not, the row must not read `sent`, because the applicant is
 * the person waiting and they heard nothing.
 *
 * **Never throws.** See the header.
 */
export async function dispatch(messages: MailMessage[]): Promise<MailDispatchResult> {
  if (messages.length === 0) return { status: 'skipped', detail: 'nothing to send' };

  const mailer = getMailer();
  const results: MailDispatchResult[] = [];

  for (const message of messages) {
    try {
      results.push(await mailer.send(message));
    } catch (error) {
      // A mailer that throws despite the contract. Still not the caller's
      // problem: the row is already written and this becomes a recorded
      // failure like any other.
      const reason = error instanceof Error ? error.name : 'unknown error';
      results.push({ status: 'failed', detail: `mailer threw (${reason})` });
    }
  }

  const failed = results.filter((r) => r.status === 'failed');
  if (failed.length > 0) {
    return {
      status: 'failed',
      detail: failed.map((f) => f.detail).join('; ').slice(0, 300),
    };
  }

  const skipped = results.filter((r) => r.status === 'skipped');
  if (skipped.length > 0) {
    return { status: 'skipped', detail: skipped[0]!.detail.slice(0, 300) };
  }

  return { status: 'sent', detail: `dispatched ${results.length} message(s)` };
}
