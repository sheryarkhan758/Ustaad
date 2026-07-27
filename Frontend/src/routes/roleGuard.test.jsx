/**
 * Role routing — the "bounced from another role's route" requirement.
 *
 * ── What is and is not being tested ────────────────────────────────────────
 * That an honest user is never shown a door that will not open. **Not** that
 * the guard is a security control — it is not, and the comment in `RoleGuard`
 * says so: anyone can edit it out in devtools, and what they reach is an API
 * that checks role *and* resource ownership on every mutating endpoint.
 *
 * The three states matter separately. Rendering the redirect during *loading*
 * is the classic bug in this pattern: a signed-in user lands on a guarded
 * route, the auth query has not resolved, and they are bounced to a login
 * screen they did not need.
 */

import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RoleGuard } from './RoleGuard';
import * as access from './access';
import * as authContext from '../context/AuthContext';

/**
 * `OPEN_NAVIGATION` is a demonstration convenience that lets one signed-in
 * person walk every screen (see `access.js`). It changes what this guard does,
 * so these tests pin **both** behaviours rather than only whichever is
 * currently switched on — the restrictive path is the one that ships, and a
 * suite that stopped covering it would let it rot while the flag was up.
 */
function openNavigation(open) {
  vi.spyOn(access, 'OPEN_NAVIGATION', 'get').mockReturnValue(open);
}

beforeEach(() => {
  // Default the whole suite to the restrictive behaviour, then opt in below.
  openNavigation(false);
});

function mockAuth({ role, isAuthenticated = Boolean(role), isLoading = false }) {
  vi.spyOn(authContext, 'useAuth').mockReturnValue({
    user: role ? { id: 'x', role, displayName: 'Test' } : null,
    role: role ?? null,
    isAuthenticated,
    isLoading,
    isError: false,
    error: null,
    hasRole: (...roles) => roles.includes(role),
    logout: vi.fn(),
    isLoggingOut: false,
  });
}

function renderAt(path, { allow }) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<p>Home</p>} />
        <Route path="/login" element={<p>Sign in</p>} />
        <Route element={<RoleGuard allow={allow} />}>
          <Route path="/guarded" element={<p>Guarded content</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('RoleGuard', () => {
  it('renders the route for a permitted role', () => {
    mockAuth({ role: 'tutor' });
    renderAt('/guarded', { allow: ['tutor'] });
    expect(screen.getByText('Guarded content')).toBeInTheDocument();
  });

  it('bounces a signed-in user in the wrong area home, not to login', () => {
    mockAuth({ role: 'parent' });
    renderAt('/guarded', { allow: ['admin'] });

    // Asking somebody to re-authenticate when they are already authenticated
    // tells them their session is broken, which is a different and more
    // alarming problem than the one they actually have.
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.queryByText('Guarded content')).not.toBeInTheDocument();
  });

  it('sends an anonymous visitor to sign in', () => {
    mockAuth({ role: null });
    renderAt('/guarded', { allow: ['parent'] });

    expect(screen.getByText('Sign in')).toBeInTheDocument();
  });

  it('decides nothing while the session is still being checked', () => {
    mockAuth({ role: null, isLoading: true });
    renderAt('/guarded', { allow: ['parent'] });

    // Neither the content nor a redirect. Rendering the redirect here would
    // bounce a signed-in user to login on every hard refresh.
    expect(screen.queryByText('Guarded content')).not.toBeInTheDocument();
    expect(screen.queryByText('Sign in')).not.toBeInTheDocument();
  });

  it('admits any signed-in role when no list is given', () => {
    mockAuth({ role: 'organisation' });
    renderAt('/guarded', { allow: [] });
    expect(screen.getByText('Guarded content')).toBeInTheDocument();
  });

  it.each(['parent', 'student', 'tutor', 'organisation', 'admin'])(
    'lets %s into its own area and keeps it out of the others',
    (role) => {
      mockAuth({ role });
      const { unmount } = renderAt('/guarded', { allow: [role] });
      expect(screen.getByText('Guarded content')).toBeInTheDocument();
      unmount();

      const others = ['parent', 'student', 'tutor', 'organisation', 'admin'].filter(
        (other) => other !== role,
      );
      renderAt('/guarded', { allow: others });
      expect(screen.queryByText('Guarded content')).not.toBeInTheDocument();
    },
  );

  /* ---------------------------------------------------------------------
   * The demonstration switch
   * ------------------------------------------------------------------ */

  it('lets any signed-in role open any screen when navigation is open', () => {
    openNavigation(true);
    mockAuth({ role: 'parent' });
    renderAt('/guarded', { allow: ['admin'] });

    // The screen opens. What it *shows* is still decided by the API, which
    // checks role and ownership on every request (NFR-6) — so a parent here
    // gets the shell and an error state, not an administrator's data.
    expect(screen.getByText('Guarded content')).toBeInTheDocument();
  });

  it('still requires a session when navigation is open', () => {
    // The switch relaxes *role*, never authentication. Anonymous visitors keep
    // exactly what FR-1.6 promises and nothing beyond it.
    openNavigation(true);
    mockAuth({ role: null, isAuthenticated: false });
    renderAt('/guarded', { allow: ['admin'] });

    expect(screen.getByText('Sign in')).toBeInTheDocument();
    expect(screen.queryByText('Guarded content')).toBeNull();
  });

});
