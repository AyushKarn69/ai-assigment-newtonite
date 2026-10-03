import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FastifyInstance } from 'fastify';
import { buildApp } from './app';
import { createTestConfig } from './config';

describe('Web app serving', () => {
  let app: FastifyInstance;
  let dir: string;
  let outside: string;

  beforeAll(async () => {
    outside = mkdtempSync(path.join(tmpdir(), 'outside-'));
    writeFileSync(path.join(outside, 'secret.txt'), 'top secret');
    dir = path.join(outside, 'site');
    mkdirSync(path.join(dir, 'js'), { recursive: true });
    writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>App</title>');
    writeFileSync(path.join(dir, 'js', 'main.js'), 'export const x = 1;');
    writeFileSync(path.join(dir, 'style.css'), 'body{}');
    writeFileSync(path.join(dir, '.env'), 'SECRET=1');
    app = await buildApp({ config: createTestConfig(), frontendDir: dir });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    rmSync(outside, { recursive: true, force: true });
  });

  it('WEB-001: / serves the app shell as HTML', async () => {
    const response = await app.inject({ method: 'GET', url: '/' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('<title>App</title>');
    expect(response.headers['cache-control']).toBe('no-cache');
  });

  it('WEB-002: scripts and styles are served with the right content type', async () => {
    const js = await app.inject({ method: 'GET', url: '/js/main.js' });
    expect(js.statusCode).toBe(200);
    expect(js.headers['content-type']).toContain('text/javascript');
    const css = await app.inject({ method: 'GET', url: '/style.css' });
    expect(css.headers['content-type']).toContain('text/css');
  });

  it('WEB-003: unknown files are 404 in the standard error format', async () => {
    const response = await app.inject({ method: 'GET', url: '/missing.js' });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NOT_FOUND');
  });

  it('WEB-004: path traversal cannot read files outside the app directory', async () => {
    for (const url of [
      '/../secret.txt',
      '/%2e%2e/secret.txt',
      '/js/../../secret.txt',
      '/..%2fsecret.txt',
      '/%2e%2e%2fsecret.txt',
    ]) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode, url).toBe(404);
      expect(response.body, url).not.toContain('top secret');
    }
  });

  it('WEB-005: dotfiles are never served', async () => {
    const response = await app.inject({ method: 'GET', url: '/.env' });
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain('SECRET');
  });

  it('WEB-006: a directory is not a file', async () => {
    expect((await app.inject({ method: 'GET', url: '/js' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/js/' })).statusCode).toBe(404);
  });

  it('WEB-007: the API is unaffected, and unknown /api paths stay JSON 404s', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/health' })).json().data.status).toBe('ok');
    const missing = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('NOT_FOUND');
  });

  it('WEB-008: malformed percent-encoding does not crash the server', async () => {
    const response = await app.inject({ method: 'GET', url: '/%E0%A4%A' });
    expect(response.statusCode).toBeLessThan(500);
  });

  it('WEB-009: without a frontend directory the app serves only the API', async () => {
    const apiOnly = await buildApp({ config: createTestConfig() });
    await apiOnly.ready();
    expect((await apiOnly.inject({ method: 'GET', url: '/' })).statusCode).toBe(404);
    await apiOnly.close();
  });
});
