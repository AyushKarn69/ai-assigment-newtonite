import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';
import { createHarness, Harness, PASSWORD, UNKNOWN_ID } from './test-utils/harness';
import { createTestConfig } from './config';
import { InMemorySessionStore } from './modules/auth/index';

describe('Request handling', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await createHarness();
  });
  afterEach(async () => {
    await h.close();
  });

  it('HARD-001: malformed JSON is a 400 INVALID_JSON, not a 500, and leaks no parser internals', async () => {
    const response = await h.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: '{not json',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      success: false,
      error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON' },
    });
  });

  it('HARD-002: unknown routes use the standard error envelope', async () => {
    const response = await h.app.inject({ method: 'GET', url: '/api/does-not-exist' });

    expect(response.statusCode).toBe(404);
    expect(response.json().success).toBe(false);
    expect(response.json().error.code).toBe('NOT_FOUND');
  });

  it('HARD-003: oversized request bodies are refused with 413', async () => {
    const response = await h.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ email: 'a@b.co', password: 'x'.repeat(2_000_000) }),
    });
    expect(response.statusCode).toBe(413);
    expect(response.json().success).toBe(false);
  });

  it('HARD-004: security headers are set on responses', async () => {
    const response = await h.app.inject({ method: 'GET', url: '/api/health' });
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBeDefined();
    expect(response.headers['strict-transport-security']).toBeDefined();
  });

  it('HARD-005: every response carries a request id, including errors', async () => {
    const ok = await h.app.inject({ method: 'GET', url: '/api/health' });
    const error = await h.app.inject({ method: 'GET', url: '/api/nope' });
    const another = await h.app.inject({ method: 'GET', url: '/api/health' });

    expect(ok.headers['x-request-id']).toBeTruthy();
    expect(error.headers['x-request-id']).toBeTruthy();
    expect(another.headers['x-request-id']).not.toBe(ok.headers['x-request-id']);
  });

  it('HARD-006: shutting the app down finishes queued background jobs first', async () => {
    const ran: string[] = [];
    h.container.jobQueue.register('probe', async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      ran.push('done');
    });
    await h.container.jobQueue.enqueue('probe', {});

    await h.app.close();
    expect(ran).toEqual(['done']);
    // afterEach closes again; closing twice must be harmless
  });
});

describe('Login brute-force protection', () => {
  let h: Harness;
  let nowMs = Date.parse('2026-07-01T09:00:00.000Z');
  const clock = { now: () => new Date(nowMs) };

  beforeEach(async () => {
    h = await createHarness({ clock });
  });
  afterEach(async () => {
    await h.close();
  });

  const login = (email: string, password: string) =>
    h.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  const failTimes = async (email: string, n: number) => {
    for (let i = 0; i < n; i++) expect((await login(email, 'wrong-password')).statusCode).toBe(401);
  };

  it('HARD-007: after 5 failures the account is locked out — even the right password is refused', async () => {
    await failTimes('mo@example.com', 5);

    const blocked = await login('mo@example.com', PASSWORD);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.code).toBe('TOO_MANY_LOGIN_ATTEMPTS');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(Number(blocked.headers['retry-after'])).toBeLessThanOrEqual(15 * 60);
  });

  it('HARD-008: the lockout is the same for emails that do not exist, so it reveals nothing', async () => {
    await failTimes('ghost@example.com', 5);
    const blocked = await login('ghost@example.com', 'whatever');

    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.code).toBe('TOO_MANY_LOGIN_ATTEMPTS');
  });

  it('HARD-009: lockout is per email (case-insensitive) — other users are unaffected', async () => {
    await failTimes('MO@Example.com', 5);

    expect((await login('mo@example.com', PASSWORD)).statusCode).toBe(429);
    expect((await login('max@example.com', PASSWORD)).statusCode).toBe(200);
  });

  it('HARD-010: a successful login clears the failure count', async () => {
    await failTimes('mo@example.com', 4);
    expect((await login('mo@example.com', PASSWORD)).statusCode).toBe(200);
    await failTimes('mo@example.com', 4); // would have been locked had the count carried over
    expect((await login('mo@example.com', PASSWORD)).statusCode).toBe(200);
  });

  it('HARD-011: the lockout lifts once the window has passed', async () => {
    await failTimes('mo@example.com', 5);
    expect((await login('mo@example.com', PASSWORD)).statusCode).toBe(429);

    nowMs += 14 * 60 * 1000;
    expect((await login('mo@example.com', PASSWORD)).statusCode).toBe(429);
    nowMs += 2 * 60 * 1000; // 16 minutes after the failures
    expect((await login('mo@example.com', PASSWORD)).statusCode).toBe(200);
  });

  it('HARD-012: failures spread over more than the window never accumulate', async () => {
    for (let i = 0; i < 8; i++) {
      await failTimes('mo@example.com', 1);
      nowMs += 4 * 60 * 1000; // at most ~3-4 failures are ever inside a 15 minute window
    }
    expect((await login('mo@example.com', PASSWORD)).statusCode).toBe(200);
  });
});

describe('Token and account checks on every request', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await createHarness();
  });
  afterEach(async () => {
    await h.close();
  });

  it('HARD-013: disabling an account blocks its existing tokens immediately', async () => {
    expect((await h.api('GET', '/api/users/me', 'mo')).statusCode).toBe(200);
    await h.container.userRepository.update(h.ids.mo, { isActive: false });

    const response = await h.api('GET', '/api/users/me', 'mo');
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('ACCOUNT_DISABLED');
  });

  it('HARD-014: role changes apply immediately — a demoted admin loses admin rights at once', async () => {
    const create = () => h.api('POST', '/api/teams', 'admin', { name: `Team ${Math.random()}` });
    expect((await create()).statusCode).toBe(201);

    await h.container.userRepository.update(h.ids.admin, { role: 'USER' });
    const response = await create();
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('ADMIN_REQUIRED');
  });

  it('HARD-015: a correctly signed token for a user that does not exist is rejected', async () => {
    const forged = jwt.sign(
      { sub: UNKNOWN_ID, email: 'ghost@example.com', role: 'ADMIN' },
      createTestConfig().JWT_SECRET,
    );
    const response = await h.app.inject({
      method: 'GET',
      url: '/api/users/me',
      headers: { authorization: `Bearer ${forged}` },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('INVALID_TOKEN');
  });

  it('HARD-016: logged-out tokens are forgotten once they would have expired anyway', async () => {
    let nowMs = Date.parse('2026-08-01T00:00:00.000Z');
    const store = new InMemorySessionStore({ now: () => new Date(nowMs) });

    await store.invalidate('token-a', 60);
    expect(await store.isInvalidated('token-a')).toBe(true);
    nowMs += 59_000;
    expect(await store.isInvalidated('token-a')).toBe(true);
    nowMs += 2_000;
    expect(await store.isInvalidated('token-a')).toBe(false);

    // old entries are also purged when new ones are added (no unbounded growth)
    await store.invalidate('token-b', 10);
    nowMs += 11_000;
    await store.invalidate('token-c', 10);
    expect((store as unknown as { invalidatedTokens: Map<string, number> }).invalidatedTokens.size).toBe(1);
  });
});
