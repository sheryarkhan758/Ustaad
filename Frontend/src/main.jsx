import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';

import './index.css';
// Initialises i18next and stamps lang/dir on <html> before the first render,
// so the page never flashes the wrong direction.
import i18n, { detectLanguage, loadLanguage } from './i18n';
import { AuthProvider } from './context/AuthContext';
import { ComparisonTrayProvider } from './context/ComparisonTrayContext';
import { ToastProvider } from './context/ToastContext';
import { createQueryClient } from './lib/queryClient';
import { registerServiceWorker } from './pwa/InstallPrompt';
import { router } from './routes';

const queryClient = createQueryClient();

/**
 * Provider order is load-bearing.
 *
 * `AuthProvider` uses `useQuery`, so it must sit inside `QueryClientProvider`.
 * `RouterProvider` sits inside both, because the route guards read auth state
 * and every page reads the query client.
 */
/**
 * Mount, once the reader's own dictionary is in.
 *
 * ── Why this is an async function and not a top-level await ────────────────
 * The build targets es2020, because the device this is built for is a
 * mid-range Android that may be several versions behind. Top-level await needs
 * es2022, and raising the target to save four lines here would drop the exact
 * browsers the target was chosen for.
 *
 * ── Why the dictionary is awaited at all ───────────────────────────────────
 * i18next would otherwise paint the first screen with raw keys in it, and the
 * screens most likely to be opened on a poor connection are the ones a parent
 * needs most. One language is one request, so this costs a single round trip
 * and saves every reader the entire dictionary of the language they do not
 * read.
 *
 * If it fails — an offline first visit against a cold cache — the app mounts
 * anyway. A screen showing keys is bad; a blank page is worse.
 */
async function start() {
  await loadLanguage(detectLanguage()).catch(() => undefined);

  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ComparisonTrayProvider>
            <ToastProvider>
              <RouterProvider router={router} />
            </ToastProvider>
          </ComparisonTrayProvider>
        </AuthProvider>
      </QueryClientProvider>
    </StrictMode>,
  );

  registerServiceWorker();
}

void start();

// Referenced so the side-effecting i18n module is not tree-shaken away.
export { i18n };
