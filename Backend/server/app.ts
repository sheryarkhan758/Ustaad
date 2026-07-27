/**
 * Express application factory.
 *
 * Takes the database handle as a parameter rather than importing `db`, so the
 * integration suite can mount the real application over an in-memory database
 * and exercise the same middleware chain, the same cookies and the same
 * handlers that production runs. A test that stubs the app is a test of the
 * stub.
 */

import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';

import { authenticate, errorHandler } from './middleware/auth';
import { createGeneralLimiter } from './middleware/rate-limit';
import type { Executor } from './repositories/_base';
import { createAiRouter } from './routes/ai';
import { createAdminRouter } from './routes/admin';
import { createAuthRouter } from './routes/auth';
import { createAdminVerificationRouter } from './routes/admin-verification';
import { createBookingRouter } from './routes/bookings';
import { createDemoRouter } from './routes/demo';
import { createFeedbackRouter } from './routes/feedback';
import { createDemandRouter, createGroupRouter } from './routes/groups';
import { createFlagsRouter } from './routes/flags';
import {
  createAdminOrganisationRouter,
  createOrganisationRouter,
  createVacancyRouter,
} from './routes/organisations';
import { createPaymentRouter } from './routes/payments';
import { createProgressRouter } from './routes/progress';
import { createReferenceRouter } from './routes/reference';
import { createReviewRouter } from './routes/reviews';
import { createSearchRouter } from './routes/search';
import { createStudentProfileRouter } from './routes/student-profiles';
import { createTutorRouter } from './routes/tutors';
import { createLocalUploadRouter } from './routes/uploads';
import { createVolunteerRouter } from './routes/volunteers';
import { isEncryptionConfigured } from './services/crypto';

export function createApp(db: Executor): Express {
  const app = express();

  // Behind Netlify/Vercel the client address arrives in X-Forwarded-For; without
  // this the rate limiter keys every request to the proxy and limits everyone
  // as one caller.
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(cors({ origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173', credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(createGeneralLimiter());

  // One handle per request, so a future transaction-scoped executor can be
  // swapped in without touching a route.
  app.use((req, _res, next) => {
    req.db = db;
    next();
  });

  app.use(authenticate);

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      version: process.env.APP_VERSION ?? '0.0.0',
      // Reported because an address cannot be stored or read without it, and
      // discovering that after a family has typed one in is too late.
      addressEncryption: isEncryptionConfigured() ? 'configured' : 'MISSING',
    });
  });

  // §6.15. Anonymous by requirement (FR-15.1) and reaches no provider
  // (FR-15.7) — mounted before the authenticated routers to make that plain.
  app.use('/api/demo', createDemoRouter());
  app.use('/api/auth', createAuthRouter());
  // Taxonomies the pickers are built from. Anonymous and heavily cached —
  // static data, seeded from committed files (§6.2, §6.3, §12).
  app.use('/api/reference', createReferenceRouter());
  app.use('/api/search', createSearchRouter());
  app.use('/api/bookings', createBookingRouter());
  app.use('/api/reviews', createReviewRouter());
  app.use('/api/payments', createPaymentRouter());
  app.use('/api/tutors', createTutorRouter());
  app.use('/api/ai', createAiRouter());
  app.use('/api/groups', createGroupRouter());
  app.use('/api/demand', createDemandRouter());
  app.use('/api/flags', createFlagsRouter());
  app.use('/api/organisations', createOrganisationRouter());
  // Browsing the board needs no account (FR-13.6); expressing interest does.
  app.use('/api/vacancies', createVacancyRouter());
  // Both reachable without an account (FR-32.6, FR-33.1). Each mounts its own
  // larger JSON body limit for attachments; the app-wide 1 MB stays in force
  // everywhere else.
  app.use('/api/feedback', createFeedbackRouter());
  app.use('/api/volunteers', createVolunteerRouter());
  app.use('/api/admin', createAdminRouter());
  app.use('/api/admin/verifications', createAdminVerificationRouter());
  app.use('/api/admin/organisations', createAdminOrganisationRouter());
  /*
   * Two routers share `/api/students`. The profile router is mounted first
   * and owns `/` and `/:id`; the progress router owns `/:id/progress`. Express
   * tries them in order and the paths do not overlap.
   */
  app.use('/api/students', createStudentProfileRouter());
  app.use('/api/students', createProgressRouter());

  // Development only. `createLocalUploadRouter` throws in production, and the
  // local storage backend refuses to construct there — a serverless filesystem
  // is ephemeral, so a CNIC image written to it is lost (SEC-7).
  if (process.env.NODE_ENV !== 'production') {
    app.use('/api/uploads', createLocalUploadRouter());
  }

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: 'No such endpoint.' } });
  });

  app.use(errorHandler);

  return app;
}
