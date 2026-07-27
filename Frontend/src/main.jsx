import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';

import './index.css';
// Imported for its side effect: initialises i18next and stamps lang/dir on
// <html> before the first render, so the page never flashes the wrong direction.
import './i18n';
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
