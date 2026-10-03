import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from './app';
import { createTestConfig } from './config';
import { NotFoundError } from './shared/errors/index';
import { z } from 'zod';

describe('App – Health & Readiness', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const config = createTestConfig();
    app = await buildApp({ config });

    // Register test routes before the app is ready
    app.get('/api/test-error', async () => {
      throw new NotFoundError('Test item not found', 'TEST_NOT_FOUND');
    });

    app.get('/api/test-zod-error', async () => {
      z.object({ name: z.string().min(1) }).parse({});
    });

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('SETUP-016: GET /api/health returns 200 with status ok', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/health',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('ok');
    expect(body.data.timestamp).toBeDefined();
    expect(body.data.uptime).toBeGreaterThanOrEqual(0);
  });

  it('SETUP-017: GET /api/ready returns 200 with status ready', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/ready',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('ready');
  });

  it('SETUP-018: Unknown route returns 404', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/nonexistent',
    });

    expect(response.statusCode).toBe(404);
  });

  it('SETUP-019: Error handler formats AppError correctly', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/test-error',
    });

    expect(response.statusCode).toBe(404);
    const body = response.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('TEST_NOT_FOUND');
    expect(body.error.message).toBe('Test item not found');
  });

  it('SETUP-020: Error handler formats ZodError correctly', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/test-zod-error',
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details).toBeDefined();
    expect(Array.isArray(body.error.details)).toBe(true);
  });
});
