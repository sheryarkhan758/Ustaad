/**
 * TanStack Query defaults, chosen for this audience rather than copied.
 *
 * The user is on a mid-range Android phone on a patchy connection, and may be
 * paying for the data. Every default below is a decision about *their* bytes
 * and *their* battery, not about developer convenience.
 */

import { QueryClient } from '@tanstack/react-query';

import { ApiError } from './api';

/**
 * Retrying a request the server deliberately refused is pointless and slow.
 *
 * A 401 means the session is gone — retrying twice more just delays the login
 * prompt by two round trips. A 403 and a 404 will not change. A 400 will not
 * change. Only a network failure and a 5xx are worth a second attempt.
 */
function shouldRetry(failureCount, error) {
  if (failureCount >= 2) return false;
  if (!(error instanceof ApiError)) return failureCount < 1;
  if (error.status === 0) return true; // transport failure — the connection dropped
  return error.status >= 500;
}

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: shouldRetry,
        // Exponential, capped. A phone that has lost signal should not hammer
        // the radio; the radio is what drains the battery.
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),

        /**
         * Two minutes. Search results, tutor profiles and reference data do not
         * change minute to minute, and a parent comparing four tutors should
         * not re-download each one every time they step back to the list.
         */
        staleTime: 2 * 60 * 1000,
        gcTime: 15 * 60 * 1000,

        /**
         * **Off.** Refetching whenever the window regains focus is the default
         * that costs a metered connection the most for the least benefit —
         * every app switch becomes a data charge. Data this product shows is
         * either slow-moving or explicitly refetched.
         */
        refetchOnWindowFocus: false,

        /** On, and the one refetch that earns its bytes: the tab was offline. */
        refetchOnReconnect: true,

        refetchOnMount: false,
        networkMode: 'offlineFirst',
      },
      mutations: {
        /**
         * **Never retried automatically.** A mutation here creates a booking,
         * resolves a report, or acknowledges a payment. Replaying one because a
         * response was slow to arrive risks doing it twice, and "your booking
         * was created twice" is a worse outcome than "please press it again".
         */
        retry: false,
        networkMode: 'offlineFirst',
      },
    },
  });
}

/**
 * Query keys in one place.
 *
 * A key typed inline in two components is two caches that look like one, and
 * the bug it produces — stale data in one view and fresh in another — is
 * miserable to track down.
 */
export const keys = {
  me: ['auth', 'me'],
  search: (params) => ['search', params],
  tutor: (slug) => ['tutor', slug],
  bookings: () => ['bookings'],
  booking: (id) => ['booking', id],
  progress: (studentProfileId) => ['progress', studentProfileId],
  reviews: (tutorId) => ['reviews', 'tutor', tutorId],
  payments: (bookingId) => ['payments', 'booking', bookingId],
  vacancies: (params) => ['vacancies', params],
  demandBoard: () => ['demand'],
  adminDashboard: () => ['admin', 'dashboard'],
  adminFlags: () => ['admin', 'flags'],
  demoScenarios: () => ['demo', 'scenarios'],
  demoScenario: (key) => ['demo', 'scenario', key],
};
