import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from './app';
import { createTestConfig } from './config';
import { createContainer } from './container';
import { DEMO_PASSWORD, seedDemoData } from './seed';
import { FastifyInstance } from 'fastify';

describe('Demo seed data', () => {
  const config = createTestConfig();
  const container = createContainer(config);
  let app: FastifyInstance;
  let summary: { users: number; teams: number; items: number };
  const tokens: Record<string, string> = {};

  const api = (url: string, who: string) =>
    app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${tokens[who]}` } });

  beforeAll(async () => {
    summary = await seedDemoData(container);
    app = await buildApp({ config, container });
    await app.ready();
    for (const who of ['ananya', 'rohan', 'priya']) {
      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: `${who}@newtonite.test`, password: DEMO_PASSWORD },
      });
      tokens[who] = login.json().data.token;
    }
  });
  afterAll(async () => {
    await app.close();
  });

  it('SEED-001: creates the documented users, teams and items', () => {
    expect(summary).toEqual({ users: 6, teams: 4, items: 14 });
  });

  it('SEED-002: demo accounts can log in; the admin is a real administrator', async () => {
    expect((await api('/api/users/me', 'ananya')).json().data).toMatchObject({ name: 'Ananya Iyer', role: 'ADMIN' });
    expect((await api('/api/users/me', 'rohan')).json().data).toMatchObject({ name: 'Rohan Sharma', role: 'USER' });
  });

  it('SEED-003: people only see their own teams; the admin sees all', async () => {
    const teamNames = async (who: string) =>
      (await api('/api/teams', who)).json().data.map((t: { name: string }) => t.name).sort();

    expect(await teamNames('ananya')).toHaveLength(4);
    expect(await teamNames('priya')).toEqual(['Data Streaming', 'Logistics & Billing', 'Platform Engineering']);
  });

  it('SEED-004: the work items span every status and priority', async () => {
    const all = (await api('/api/work-items?pageSize=100', 'ananya')).json();
    expect(all.meta.totalCount).toBe(14);
    const statuses = new Set(all.data.map((i: { status: string }) => i.status));
    const priorities = new Set(all.data.map((i: { priority: string }) => i.priority));
    expect([...statuses].sort()).toEqual(['BLOCKED', 'CLOSED', 'IN_PROGRESS', 'IN_REVIEW', 'OPEN']);
    expect([...priorities].sort()).toEqual(['CRITICAL', 'HIGH', 'LOW', 'MEDIUM']);
  });

  it('SEED-005: history is genuine — a worked item has creation, lock, update and comment events', async () => {
    const lag = (await api('/api/work-items?search=consumer%20lag', 'ananya')).json().data[0];
    const history = (await api(`/api/work-items/${lag.id}/activity?order=asc&pageSize=100`, 'ananya')).json().data;
    const types = history.map((e: { type: string }) => e.type);

    expect(types[0]).toBe('CREATED');
    expect(types).toEqual(expect.arrayContaining(['LOCK_ACQUIRED', 'UPDATED', 'LOCK_RELEASED', 'COMMENT_ADDED']));
    expect(lag.status).toBe('BLOCKED');
  });

  it('SEED-006: notifications from the demo history were delivered without failures', async () => {
    expect(container.jobQueue.failedJobs()).toEqual([]);
    const priya = (await api('/api/notifications/unread-count', 'priya')).json().data.count;
    expect(priya).toBeGreaterThan(0);
  });

  it('SEED-007: no demo item is left locked', async () => {
    const all = (await api('/api/work-items?pageSize=100', 'ananya')).json().data as Array<{ id: string }>;
    for (const item of all) {
      expect((await api(`/api/work-items/${item.id}/lock`, 'ananya')).json().data).toBeNull();
    }
  });

  it('SEED-008: the dashboard has something to show', async () => {
    const dash = (await api('/api/dashboard', 'rohan')).json().data;
    expect(dash.counts.total).toBeGreaterThan(0);
    expect(dash.teamLoad.length).toBeGreaterThan(0);
    expect(dash.recentActivity.length).toBeGreaterThan(0);
  });
});
