import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

import '@testing-library/jest-dom/vitest';

/**
 * Unmount between tests.
 *
 * Testing Library registers this itself only when `globals: true`. This suite
 * runs with explicit imports, so the hook has to be registered here — without
 * it every render accumulates in the same document and `getByText` fails with
 * "found multiple elements", which reads like a component bug and is not one.
 */
afterEach(cleanup);
