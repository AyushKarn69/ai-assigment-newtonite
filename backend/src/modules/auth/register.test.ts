import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHarness, Harness, UNKNOWN_ID } from '../../test-utils/harness';

describe('Self-service registration', () => {
  let h: Harness;
  let nowMs = Date.parse('2026-09-01T09:00:00.000Z');
  const clock = { now: () => new Date(nowMs) };

  beforeEach(async () => {
    h = await createHarness({ clock, config: { REGISTRATION_LIMIT_PER_HOUR: 1000 } });
  });
  afterEach(async () => {
    await h.close();
  });

  const register = (body: Record<string, unknown>) =>
    h.app.inject({ method: 'POST', url: '/api/auth/register', payload: body });
  const valid = (overrides: Record<string, unknown> = {}) => ({
    name: 'Nora New',
    email: 'nora@example.com',
    password: 'a-good-password',
    ...overrides,
  });
  const asUser = (token: string, method: 'GET' | 'POST', url: string, payload?: Record<string, unknown>) =>
    h.app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, payload });

  it('REG-001: signing up creates the account and signs the person in', async () => {
    const response = await register(valid());
    const body = response.json();

    expect(response.statusCode).toBe(201);
    expect(body.data.user).toMatchObject({ name: 'Nora New', email: 'nora@example.com', role: 'USER' });
    expect(body.data.token).toEqual(expect.any(String));
    expect(JSON.stringify(body)).not.toMatch(/password|hash/i);

    const me = await asUser(body.data.token, 'GET', '/api/users/me');
    expect(me.statusCode).toBe(200);
    expect(me.json().data).toMatchObject({ id: body.data.user.id, name: 'Nora New' });
  });

  it('REG-002: nobody can sign up as an administrator, whatever they send', async () => {
    const response = await register(valid({ role: 'ADMIN', isActive: true, id: UNKNOWN_ID }));
    expect(response.statusCode).toBe(201);
    expect(response.json().data.user.role).toBe('USER');

    const token = response.json().data.token;
    const createTeam = await asUser(token, 'POST', '/api/teams', { name: 'Sneaky' });
    expect(createTeam.statusCode).toBe(403);
    expect(createTeam.json().error.code).toBe('ADMIN_REQUIRED');
  });

  it('REG-003: the email is trimmed and stored in lower case; the name is trimmed', async () => {
    const response = await register(valid({ email: '  Nora.New@Example.COM ', name: '  Nora  ' }));
    expect(response.json().data.user).toMatchObject({ email: 'nora.new@example.com', name: 'Nora' });
  });

  it('REG-004: an email that is already registered is refused, in any letter case', async () => {
    await register(valid());
    for (const email of ['nora@example.com', 'NORA@EXAMPLE.COM', 'mo@example.com']) {
      const response = await register(valid({ email }));
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe('EMAIL_ALREADY_EXISTS');
    }
  });

  it('REG-005: two simultaneous sign-ups with the same email produce exactly one account', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => register(valid({ name: `Racer ${i}` }))),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409, 409, 409, 409]);
    const all = await h.container.userRepository.findAll();
    expect(all.filter((u) => u.email === 'nora@example.com')).toHaveLength(1);
  });

  it('REG-006: invalid details are rejected and create nothing', async () => {
    const before = (await h.container.userRepository.findAll()).length;
    const bad: Array<Record<string, unknown>> = [
      valid({ email: 'not-an-email' }),
      valid({ email: '' }),
      valid({ password: 'short7!' }), // 7 characters
      valid({ password: 'x'.repeat(73) }), // over bcrypt's 72-byte limit
      valid({ password: 'é'.repeat(37) }), // 74 bytes although only 37 characters
      valid({ name: '' }),
      valid({ name: '   ' }),
      valid({ name: 'n'.repeat(101) }),
      { email: 'a@b.co', password: 'a-good-password' }, // no name
      { name: 'x', password: 'a-good-password' }, // no email
      { name: 'x', email: 'a@b.co' }, // no password
      valid({ password: 12345678 }),
    ];
    for (const payload of bad) {
      const response = await register(payload);
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
      expect(response.json().error.code).toBe('VALIDATION_ERROR');
    }
    expect((await h.container.userRepository.findAll()).length).toBe(before);

    // boundary values are accepted
    expect((await register(valid({ email: 'a@example.com', password: 'x'.repeat(8) }))).statusCode).toBe(201);
    expect((await register(valid({ email: 'b@example.com', password: 'x'.repeat(72) }))).statusCode).toBe(201);
  });

  it('REG-007: the new account can sign in later, only with the right password', async () => {
    await register(valid());
    const good = await h.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'NORA@example.com', password: 'a-good-password' } });
    expect(good.statusCode).toBe(200);
    const bad = await h.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'nora@example.com', password: 'wrong-password' } });
    expect(bad.statusCode).toBe(401);
  });

  it('REG-008: the password is stored only as a hash', async () => {
    await register(valid());
    const stored = await h.container.userRepository.findByEmail('nora@example.com');
    expect(stored!.passwordHash).not.toBe('a-good-password');
    expect(stored!.passwordHash).toMatch(/^\$2[aby]\$/);
  });

  it('REG-009: a new account starts with no team and can see nothing of anyone else', async () => {
    const { token } = (await register(valid())).json().data;
    const itemId = await h.createItem('mo');

    expect((await asUser(token, 'GET', '/api/teams')).json().data).toEqual([]);
    expect((await asUser(token, 'GET', '/api/work-items')).json().data).toEqual([]);
    const dash = (await asUser(token, 'GET', '/api/dashboard')).json().data;
    expect(dash.counts.total).toBe(0);
    expect(dash.teamLoad).toEqual([]);
    expect((await asUser(token, 'GET', `/api/work-items/${itemId}`)).statusCode).toBe(403);
    const create = await asUser(token, 'POST', '/api/work-items', { title: 'x', type: 'CUSTOMER_ISSUE', teamId: h.teams.alpha });
    expect(create.statusCode).toBe(403);
  });

  it('REG-010: a team manager can add the new person by email, and then they can work', async () => {
    const { token, user } = (await register(valid())).json().data;
    const add = await h.api('POST', `/api/teams/${h.teams.alpha}/members`, 'mia', { email: 'NORA@example.com' });

    expect(add.statusCode).toBe(201);
    expect(add.json().data).toMatchObject({ userId: user.id, name: 'Nora New', role: 'MEMBER' });
    const teams = (await asUser(token, 'GET', '/api/teams')).json().data;
    expect(teams.map((t: { name: string; myRole: string }) => [t.name, t.myRole])).toEqual([['Alpha', 'MEMBER']]);
    const created = await asUser(token, 'POST', '/api/work-items', { title: 'First task', type: 'CUSTOMER_ISSUE', teamId: h.teams.alpha });
    expect(created.statusCode).toBe(201);
  });

  it('REG-011: adding by email: unknown email, duplicate, both/neither fields, and who may ask', async () => {
    const { user } = (await register(valid())).json().data;
    const add = (who: string, payload: Record<string, unknown>) =>
      h.api('POST', `/api/teams/${h.teams.alpha}/members`, who, payload);

    const unknown = await add('mia', { email: 'nobody@example.com' });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error.code).toBe('USER_NOT_FOUND');

    expect((await add('mia', { email: 'nora@example.com' })).statusCode).toBe(201);
    const again = await add('mia', { email: 'nora@example.com' });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('ALREADY_TEAM_MEMBER');

    expect((await add('mia', { email: 'a@b.co', userId: user.id })).statusCode).toBe(400);
    expect((await add('mia', {})).statusCode).toBe(400);
    expect((await add('mia', { email: 'not-an-email' })).statusCode).toBe(400);

    // a plain member cannot probe which emails exist: refused before the lookup
    for (const email of ['nobody@example.com', 'mia@example.com']) {
      const refused = await add('mo', { email });
      expect(refused.statusCode).toBe(403);
      expect(refused.json().error.code).toBe('TEAM_MANAGER_REQUIRED');
    }
    // adding by userId still works as before
    const byId = await h.api('POST', `/api/teams/${h.teams.beta}/members`, 'olga', { userId: user.id });
    expect(byId.statusCode).toBe(201);
  });

  it('REG-012: the number of sign-ups per address is limited, and the limit resets', async () => {
    await h.close();
    h = await createHarness({ clock, config: { REGISTRATION_LIMIT_PER_HOUR: 3 } });

    for (let i = 0; i < 3; i++) {
      expect((await register(valid({ email: `limit${i}@example.com` }))).statusCode).toBe(201);
    }
    const blocked = await register(valid({ email: 'limit3@example.com' }));
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.code).toBe('TOO_MANY_REGISTRATIONS');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(await h.container.userRepository.findByEmail('limit3@example.com')).toBeNull();

    nowMs += 61 * 60 * 1000; // an hour later
    expect((await register(valid({ email: 'limit3@example.com' }))).statusCode).toBe(201);
  });

  it('REG-013: registration can be switched off', async () => {
    await h.close();
    h = await createHarness({ clock, config: { ALLOW_REGISTRATION: false } });

    const response = await register(valid());
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('REGISTRATION_DISABLED');
    expect(await h.container.userRepository.findByEmail('nora@example.com')).toBeNull();
  });

  it('REG-014: a new account can sign out like any other', async () => {
    const { token } = (await register(valid())).json().data;
    expect((await asUser(token, 'POST', '/api/auth/logout')).statusCode).toBe(200);
    expect((await asUser(token, 'GET', '/api/users/me')).statusCode).toBe(401);
  });
});
