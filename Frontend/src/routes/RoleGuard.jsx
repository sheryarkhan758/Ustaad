/**
 * Role-guarded route wrapper.
 *
 * ── This is a courtesy, not a control ──────────────────────────────────────
 * Anyone can edit the guard out in devtools. What they reach is an API that
 * checks role *and* resource ownership on every mutating endpoint (NFR-6) and
 * refuses them anyway. So this exists for one honest reason: an ordinary user
 * should never be shown a door that will not open.
 *
 * Treat it accordingly. **Never** put a secret behind it, and never skip the
 * server check because the route is guarded.
 *
 * ── Three states, not two ──────────────────────────────────────────────────
 * Loading is a real state and rendering the redirect during it is the most
 * common bug in this pattern: a signed-in user lands on `/parent/bookings`,
 * the auth query has not resolved, and they are bounced to a login screen they
 * did not need. So loading renders a placeholder and decides nothing.
 */

import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { useAuth } from '../context/AuthContext';
import { SkeletonCard } from '../components/ui/Card';

export function RoleGuard({ allow = [], children }) {
  const { isAuthenticated, isLoading, role } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="mx-auto max-w-prose space-y-3 p-4">
        <SkeletonCard label="Checking your session" />
      </div>
    );
  }

  if (!isAuthenticated) {
    // `state.from` so the login screen can return them where they meant to go.
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }

  if (allow.length > 0 && !allow.includes(role)) {
    /**
     * A signed-in user in the wrong place is sent home, not to login — asking
     * someone to re-authenticate when they are already authenticated tells them
     * their session is broken, which is a different and more alarming problem
     * than the one they have.
     */
    return <Navigate to="/" replace />;
  }

  return children ?? <Outlet />;
}
