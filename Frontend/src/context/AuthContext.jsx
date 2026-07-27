/**
 * Who is signed in, and what they may see.
 *
 * ── The auth call is stubbed, and the stub has a shape ─────────────────────
 * `USE_STUB` swaps a fixture for `GET /api/auth/me`. The fixture returns the
 * **same shape the real endpoint returns**, so switching it off is a one-line
 * change rather than a refactor. Set `localStorage.ustaadStubRole` in the
 * console to walk the interface as any role.
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

/** Flip to `false` once the login screen is built. */
const USE_STUB = true;

/**
 * The fixture. Matches `GET /api/auth/me` exactly — see `docs/API.md`.
 *
 * `null` means anonymous, which is a real state the interface must handle:
 * browsing and search require no login (FR-1.6).
 */
function stubUser() {
  const role = globalThis.localStorage?.getItem('ustaadStubRole') ?? 'parent';
  if (role === 'anonymous') return null;

  return {
    id: `stub-${role}`,
    email: `${role}@demo.ustaad.test`,
    role,
    displayName: { parent: 'IQRA SHAHID', tutor: 'Ayesha Siddiqui', student: 'Hira Yousuf', organisation: 'Al-Noor Academy', admin: 'Platform Administrator' }[role] ?? 'Guest',
    preferredLang: 'en',
  };
}

export function AuthProvider({ children }) {
  const queryClient = useQueryClient();

  const { data, isPending, isError, error } = useQuery({
    queryKey: keys.me,
    queryFn: async () => {
      if (USE_STUB) return stubUser();

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
    mutationFn: () => (USE_STUB ? Promise.resolve() : api.post('/auth/logout')),
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
