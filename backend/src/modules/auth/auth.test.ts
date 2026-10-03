import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { buildApp } from '../../app';
import { createTestConfig } from '../../config';
import { createContainer, AppContainer } from '../../container';

describe('Auth – login, logout, /users/me', () => {
  const config = createTestConfig();
  let app: FastifyInstance;
  let container: AppContainer;

  const credentials = { email: 'bob@example.com', password: 'a-long-test-password' };

  async function login(body: Record<string, unknown> = credentials) {
    return app.inject({ method: 'POST', url: '/api/auth/login', payload: body });
  }

  beforeAll(async () => {
    container = createContainer(config);
    await container.userService.createUser({ ...credentials, name: 'Bob' });
    await container.userService.createUser({
      email: 'disabled@example.com',
      name: 'Disabled',
      password: credentials.password,
    });
    const disabled = await container.userRepository.findByEmail('disabled@example.com');
    await container.userRepository.update(disabled!.id, { isActive: false });

    app = await buildApp({ config, container });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('AUTH-001: login with valid credentials returns a token and user info', async () => {
    const response = await login();
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.token).toEqual(expect.any(String));
    expect(body.data.user).toMatchObject({ email: 'bob@example.com', name: 'Bob', role: 'USER' });
    expect(JSON.stringify(body)).not.toContain('passwordHash');
  });

  it('AUTH-002: login email is case-insensitive', async () => {
    const response = await login({ ...credentials, email: 'BOB@Example.com' });
    expect(response.statusCode).toBe(200);
  });

  it('AUTH-003: wrong password returns 401 INVALID_CREDENTIALS', async () => {
    const response = await login({ ...credentials, password: 'wrong-password' });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('INVALID_CREDENTIALS');
  });

  it('AUTH-004: unknown email returns the same 401 as a wrong password', async () => {
    const response = await login({ email: 'nobody@example.com', password: 'whatever' });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('INVALID_CREDENTIALS');
  });

  it('AUTH-005: disabled account returns 401 ACCOUNT_DISABLED', async () => {
    const response = await login({ email: 'disabled@example.com', password: credentials.password });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('ACCOUNT_DISABLED');
  });

  it('AUTH-006: login validates the request body', async () => {
    const badEmail = await login({ email: 'not-an-email', password: 'x' });
    const missingPassword = await login({ email: 'bob@example.com' });

    expect(badEmail.statusCode).toBe(400);
    expect(badEmail.json().error.code).toBe('VALIDATION_ERROR');
    expect(missingPassword.statusCode).toBe(400);
  });

  it('AUTH-007: GET /api/users/me returns the authenticated user', async () => {
    const token = (await login()).json().data.token;
    const response = await app.inject({
      method: 'GET',
      url: '/api/users/me',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ email: 'bob@example.com', role: 'USER' });
  });

  it('AUTH-008: protected route without a token returns 401 MISSING_AUTH', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/users/me' });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('MISSING_AUTH');
  });

  it('AUTH-009: protected route with a malformed token returns 401 INVALID_TOKEN', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/users/me',
      headers: { authorization: 'Bearer not.a.jwt' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('INVALID_TOKEN');
  });

  it('AUTH-010: a token signed with a different secret is rejected', async () => {
    const forged = jwt.sign({ sub: 'x', email: 'x@example.com', role: 'ADMIN' }, 'another-secret-16-chars');
    const response = await app.inject({
      method: 'GET',
      url: '/api/users/me',
      headers: { authorization: `Bearer ${forged}` },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('INVALID_TOKEN');
  });

  it('AUTH-011: an expired token is rejected', async () => {
    const expired = jwt.sign(
      { sub: 'x', email: 'x@example.com', role: 'USER' },
      config.JWT_SECRET,
      { expiresIn: -10 },
    );
    const response = await app.inject({
      method: 'GET',
      url: '/api/users/me',
      headers: { authorization: `Bearer ${expired}` },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('INVALID_TOKEN');
  });

  it('AUTH-012: logout invalidates the token for later requests', async () => {
    const token = (await login()).json().data.token;
    const headers = { authorization: `Bearer ${token}` };

    const logout = await app.inject({ method: 'POST', url: '/api/auth/logout', headers });
    expect(logout.statusCode).toBe(200);

    const afterLogout = await app.inject({ method: 'GET', url: '/api/users/me', headers });
    expect(afterLogout.statusCode).toBe(401);
    expect(afterLogout.json().error.code).toBe('TOKEN_INVALIDATED');
  });

  it('AUTH-013: logout only invalidates the presented token, not other sessions', async () => {
    // iat has second resolution — wait so the two tokens differ
    const first = (await login()).json().data.token;
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const second = (await login()).json().data.token;
    expect(second).not.toBe(first);

    await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { authorization: `Bearer ${first}` },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/users/me',
      headers: { authorization: `Bearer ${second}` },
    });
    expect(response.statusCode).toBe(200);
  });

  it('AUTH-014: logout requires authentication', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/auth/logout' });
    expect(response.statusCode).toBe(401);
  });
});
