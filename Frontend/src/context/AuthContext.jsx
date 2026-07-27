/**
 * Who is signed in, and what they may see.
 *
 * ── Anonymous is a state, not a failure ────────────────────────────────────
 * `GET /api/auth/me` answers **401 when nobody is signed in**, and that is the
 * ordinary case rather than an error: browsing, search, tutor profiles, the
 * vacancy board and the demonstration panel all require no account (FR-1.6).
 * So a 401 resolves to `null` and the interface renders its signed-out shell —
 * "Sign in" in the header, public routes reachable, guarded ones redirecting.
 *
 * Anything else — a 500, a dropped connection — is a real error and is left to
 * propagate. Treating those as "signed out" would sign a user out every time
 * their connection wobbled, on an audience whose connections wobble.
 *
 * ── There is no token here, and there never will be ────────────────────────
 * The session is an httpOnly cookie. JavaScript cannot read it, so this context
 * holds *who the server says you are*, not proof of it. That distinction is
 * what makes the client guard below a convenience rather than a control.
 *
 * **Every one of these checks is cosmetic.** The server checks role and
 * resource ownership on every mutating endpoint (NFR-6), and a client guard
 * that someone bypasses with devtools reaches an API that refuses them anyway.
 * What the guard buys is that an honest user is never shown a door that will
 * not open.
 */

import { createContext, useCallback, useContext, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError, api } from '../lib/api';
import { keys } from '../lib/queryClient';

/** §5.1. A minor is not among them, and never will be (§2.3). */
export const ROLES = ['parent', 'student', 'tutor', 'organisation', 'admin'];

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const queryClient = useQueryClient();

  const { data, isPending, isError, error } = useQuery({
    queryKey: keys.me,
    queryFn: async () => {
      try {
        const payload = await api.get('/auth/me');
        return payload?.user ?? null;
      } catch (cause) {
        // 401 is not an error condition — it is the anonymous state, and
        // anonymous is a first-class user of this product.
        if (cause instanceof ApiError && cause.isUnauthenticated) return null;
        throw cause;
      }
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const logout = useMutation({
    mutationFn: () => api.post('/auth/logout'),
    onSettled: () => {
      // Clear everything, not just the session. A cache left behind after a
      // logout can render the previous user's bookings to the next person at
      // the same phone — which on this platform is a family's data.
      queryClient.clear();
    },
  });

  const user = data ?? null;

  const hasRole = useCallback(
    (...roles) => (roles.length === 0 ? Boolean(user) : Boolean(user) && roles.includes(user.role)),
    [user],
  );

  const value = useMemo(
    () => ({
      user,
      role: user?.role ?? null,
      isAuthenticated: Boolean(user),
      isLoading: isPending,
      isError,
      error,
      hasRole,
      logout: logout.mutate,
      isLoggingOut: logout.isPending,
    }),
    [user, isPending, isError, error, hasRole, logout.mutate, logout.isPending],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>.');
  return context;
}
