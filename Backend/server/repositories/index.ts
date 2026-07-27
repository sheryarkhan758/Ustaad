/**
 * The repository layer — the only code that builds queries.
 *
 * **Route handlers call repositories. Route handlers never import `db`.**
 *
 * That is the boundary the SQLite → Postgres move depends on. The set of SQL
 * this application can emit is confined to these modules, so it is small enough
 * to review in one sitting, and a query that would behave differently on the
 * two engines has exactly one place it can be written. See
 * `server/db/PORTABILITY.md`.
 *
 * Each module exports functions taking an `Executor` as their first argument —
 * the real `db`, a transaction, or the in-memory test database — so a caller
 * can compose several repository calls inside one transaction.
 */

export * as tutorsRepo from './tutors';
export * as bookingsRepo from './bookings';
export * as reviewsRepo from './reviews';
export * as paymentsRepo from './payments';
export * as feedbackRepo from './feedback';
export * as volunteersRepo from './volunteers';

export { NotFoundError, type Executor } from './_base';
