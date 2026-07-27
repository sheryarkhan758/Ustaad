/**
 * Express bootstrap.  `npm run dev`.
 *
 * The application itself is built by `createApp` in `server/app.ts`; this file
 * only supplies the real database handle and listens. Route modules land in
 * `server/routes/` as the modules in docs/PROGRESS.md are built.
 */

import 'dotenv/config';

import { createApp } from './app';
import { DB_DIALECT, db } from './db/index';
import { isEncryptionConfigured } from './services/crypto';

const PORT = Number(process.env.PORT ?? 3000);

const app = createApp(db);

app.listen(PORT, () => {
  console.log(`Ustaad API listening on http://localhost:${PORT}  (db: ${DB_DIALECT})`);
  if (!isEncryptionConfigured()) {
    console.warn(
      '⚠ ADDRESS_ENCRYPTION_KEY is not set. Booking addresses cannot be stored or read ' +
        '(NFR-18). Generate one with:\n' +
        '  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
});
