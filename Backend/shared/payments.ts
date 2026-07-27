/**
 * Payment request contracts — §6.31.
 *
 * ── Why these live in `/shared` ────────────────────────────────────────────
 * They were route-local. That works until a client wants to validate a dispute
 * form before posting it, at which point the choice is to duplicate the rules
 * or to let the server be the only thing that knows them — the first drifts,
 * the second means a family writes 300 words and is told afterwards that the
 * reason line was two characters too long. Both sides now import the same
 * object, which is the arrangement the rest of this codebase already uses
 * (§5.2).
 *
 * ── What is not here, and never will be ────────────────────────────────────
 * There is no schema for a card number, a payment method, an amount to charge,
 * a payout, a refund or a wallet balance, because there is no endpoint that
 * would accept one (§2.6). A payment record is a **mutually acknowledged
 * statement about a cash transaction that happened between two people**. The
 * platform witnesses it; it never touches the money.
 */

import { z } from 'zod';

import { PAYMENT_STATUSES } from './payment-status';

/**
 * Raising a dispute — FR-31.6.
 *
 * `reason` is short and required: it is what an administrator reads first in
 * the queue, and a dispute with no stated reason cannot be triaged. `detail`
 * is optional and long, because the reason line is not the place to explain
 * a three-month disagreement.
 *
 * Both fields are user text: any script, stored unchanged, never translated
 * (§2.10).
 */
export const raiseDisputeSchema = z.object({
  reason: z.string().trim().min(3).max(80),
  detail: z.string().trim().max(2000).optional(),
});

export type RaiseDisputeInput = z.infer<typeof raiseDisputeSchema>;

/**
 * An administrator's resolution — FR-31.7.
 *
 * The 15-character floor on `reason` is deliberate. This writes to the
 * append-only log and decides a disagreement about money between two people;
 * "ok" is not a resolution anyone can later audit.
 */
export const resolveDisputeSchema = z.object({
  outcome: z.enum(PAYMENT_STATUSES),
  reason: z.string().trim().min(15).max(2000),
});

export type ResolveDisputeInput = z.infer<typeof resolveDisputeSchema>;

/**
 * Amending the agreed amount before both parties have confirmed — FR-31.1.
 *
 * The server refuses this with 409 `agreed_amount_immutable` once the record
 * has been acknowledged by both sides. The client may grey the field out on
 * the same rule (`isAgreedAmountLocked`), but that is a courtesy: the
 * enforcement is server-side and the UI is never relied upon (NFR-6).
 */
export const amendAgreedAmountSchema = z.object({
  /** Paisa. Integer, always — never a float and never a decimal string (§2.1). */
  agreedAmount: z.number().int().nonnegative(),
});

export type AmendAgreedAmountInput = z.infer<typeof amendAgreedAmountSchema>;
