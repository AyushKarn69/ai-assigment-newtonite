// Thin client for the Newtonite Ops API.

const TOKEN_KEY = 'nw.token';

/** A failed API call (including network failures, status 0). */
export class ApiError extends Error {
  constructor({ status, code, message, details, lockInfo, retryAfter }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.lockInfo = lockInfo;
    /** Seconds the server asked us to wait (429), if any. */
    this.retryAfter = retryAfter;
  }
}

export const session = {
  get token() {
    try {
      return sessionStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token) {
    try {
      sessionStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* storage unavailable: the session just will not survive a reload */
    }
  },
  clear() {
    try {
      sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  },
};

let onUnauthorized = () => {};
/** Called when a signed-in request is refused with 401 (expired token, disabled account…). */
export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}

function toQuery(query) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

/** A fresh key for one user action; retries of that action reuse it. */
export function newIdempotencyKey() {
  return globalThis.crypto?.randomUUID?.() ?? `k-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Call the API.
 * @returns {{ data: any, meta: any }} on success; throws ApiError otherwise.
 */
export async function api(method, path, { body, query, idempotencyKey, auth = true, keepalive = false } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (auth && session.token) headers.authorization = `Bearer ${session.token}`;
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;

  let response;
  try {
    response = await fetch(`/api${path}${toQuery(query)}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      keepalive,
    });
  } catch {
    throw new ApiError({
      status: 0,
      code: 'NETWORK_ERROR',
      message: 'Could not reach the server. Check your connection and try again.',
    });
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    /* non-JSON body */
  }

  if (!response.ok || !payload || payload.success === false) {
    const error = payload?.error ?? {};
    const retryAfter = Number(response.headers.get('retry-after')) || undefined;
    const failure = new ApiError({
      status: response.status,
      code: error.code ?? 'UNKNOWN_ERROR',
      message: error.message ?? `Request failed (${response.status})`,
      details: error.details,
      lockInfo: error.lockInfo,
      retryAfter,
    });
    if (response.status === 401 && auth && path !== '/auth/login') onUnauthorized(failure);
    throw failure;
  }

  return { data: payload.data, meta: payload.meta };
}

/** Plain health probe (no auth, never throws). */
export async function checkHealth() {
  try {
    const started = performance.now();
    const response = await fetch('/api/health');
    const payload = await response.json();
    return { ok: response.ok && payload?.data?.status === 'ok', ms: Math.round(performance.now() - started), uptime: payload?.data?.uptime };
  } catch {
    return { ok: false, ms: null, uptime: null };
  }
}
