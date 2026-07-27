/**
 * The single fetch wrapper. Every request to the API goes through here.
 *
 * ── `credentials: 'include'` is the whole point ────────────────────────────
 * The session is an httpOnly cookie and there is deliberately no
 * `Authorization` header path on the server. So a request that forgets this
 * option is not "slightly wrong" — it is anonymous, and the failure looks like
 * a permissions bug rather than a missing option. Putting it in one place is
 * the only way to be sure every call has it.
 *
 * **Never read a token in this file.** There is nothing to read: the cookie is
 * httpOnly, so JavaScript cannot see it, and that is the property that makes an
 * XSS bug survivable rather than fatal.
 *
 * ── Errors are values, not strings ─────────────────────────────────────────
 * The server answers every failure with `{ error: { code, message } }` where
 * `message` is written for a person and safe to display. `ApiError` carries
 * both, so a caller can branch on the stable `code` and render the `message`
 * without inventing its own copy for a case the server already worded.
 */

/** A deliberate refusal from the API, or a transport failure dressed as one. */
export class ApiError extends Error {
  constructor(status, code, message, issues) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    /** Stable machine-readable code, e.g. `flag_already_resolved`. */
    this.code = code;
    /** Field-level validation detail, when the server sent any. */
    this.issues = issues ?? [];
  }

  /** The session is gone or was never there. */
  get isUnauthenticated() {
    return this.status === 401;
  }

  /** Signed in, but not allowed. Distinct from 404, which hides existence. */
  get isForbidden() {
    return this.status === 403;
  }

  get isValidation() {
    return this.status === 400 && this.code === 'validation_failed';
  }
}

/**
 * A network failure is not a server error, and must not read like one.
 *
 * This audience is on patchy connections. "Something went wrong" for a dropped
 * connection sends someone hunting for a mistake they did not make; naming the
 * connection tells them to try again in a moment.
 */
const OFFLINE_MESSAGE =
  'Could not reach Ustaad.com. Check your connection and try again — nothing you entered has been lost.';

async function request(path, { method = 'GET', body, signal, headers } = {}) {
  let response;

  try {
    response = await fetch(`/api${path}`, {
      method,
      // The cookie is the only session carrier. See the note above.
      credentials: 'include',
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (cause) {
    // An aborted request is the caller changing their mind, not a failure.
    if (cause?.name === 'AbortError') throw cause;
    throw new ApiError(0, 'network_unavailable', OFFLINE_MESSAGE);
  }

  if (response.status === 204) return null;

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // A non-JSON body from a 5xx is a platform error page, not an API answer.
  }

  if (!response.ok) {
    const error = payload?.error ?? {};
    throw new ApiError(
      response.status,
      error.code ?? 'unexpected_error',
      error.message ?? 'Something went wrong. Please try again.',
      error.issues,
    );
  }

  return payload;
}

export const api = {
  get: (path, options) => request(path, { ...options, method: 'GET' }),
  post: (path, body, options) => request(path, { ...options, method: 'POST', body }),
  put: (path, body, options) => request(path, { ...options, method: 'PUT', body }),
  patch: (path, body, options) => request(path, { ...options, method: 'PATCH', body }),
  del: (path, options) => request(path, { ...options, method: 'DELETE' }),
};
