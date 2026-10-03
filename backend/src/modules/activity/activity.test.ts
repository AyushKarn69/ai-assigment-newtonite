import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../app';
import { createTestConfig } from '../../config';
import { AppContainer, createContainer } from '../../container';
import { TeamRole } from '../../shared/types/auth';

const PASSWORD = 'a-long-test-password';
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

type Entry = Record<string, any>;

describe('Work item activity history', () => {
  const config = createTestConfig({ LOCK_TIMEOUT_MINUTES: 10 });
  let app: FastifyInstance;
  let container: AppContainer;

  let nowMs = Date.parse('2026-04-01T08:00:00.000Z');
  const clock = { now: () => new Date(nowMs) };
  const advanceMinutes = (minutes: number) => {
    nowMs += minutes * 60_000;
  };

  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  let alphaTeam: string;

  const as = (who: string) => ({ authorization: `Bearer ${tokens[who]}` });
  const api = (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    who: string,
    payload?: Record<string, unknown>,
  ) => app.inject({ method, url, headers: as(who), payload });

  async function createItem(who = 'mo', overrides: Record<string, unknown> = {}): Promise<string> {
    const response = await api('POST', '/api/work-items', who, {
      title: 'Refund not received',
      description: 'Customer waiting 5 days',
      type: 'CUSTOMER_ISSUE',
      priority: 'LOW',
      teamId: alphaTeam,
      ...overrides,
    });
    expect(response.statusCode).toBe(201);
    return response.json().data.id;
  }

  const lock = (id: string, who: string) => api('POST', `/api/work-items/${id}/lock`, who);
  const unlock = (id: string, who: string) => api('DELETE', `/api/work-items/${id}/lock`, who);
  const patch = (id: string, who: string, payload: Record<string, unknown>) =>
    api('PATCH', `/api/work-items/${id}`, who, payload);

  /** Full history, oldest first. */
  async function history(id: string, who = 'mo', query = 'order=asc&pageSize=100'): Promise<Entry[]> {
    const response = await api('GET', `/api/work-items/${id}/activity?${query}`, who);
    expect(response.statusCode).toBe(200);
    return response.json().data;
  }
  const types = (entries: Entry[]) => entries.map((e) => e.type);

  beforeAll(async () => {
    container = createContainer(config, { clock });

    const people: Array<[string, 'ADMIN' | 'USER']> = [
      ['admin', 'ADMIN'],
      ['mia', 'USER'], // alpha manager
      ['mo', 'USER'], // alpha member
      ['max', 'USER'], // alpha member
      ['olga', 'USER'], // beta manager, outsider to alpha
    ];
    for (const [name, role] of people) {
      const user = await container.userService.createUser({
        email: `${name}@example.com`,
        name,
        password: PASSWORD,
        role,
      });
      ids[name] = user.id;
    }

    const alpha = await container.teamRepository.create({ name: 'Alpha' });
    alphaTeam = alpha.id;
    await container.teamRepository.addMember(alpha.id, ids.mia, TeamRole.MANAGER);
    await container.teamRepository.addMember(alpha.id, ids.mo, TeamRole.MEMBER);
    await container.teamRepository.addMember(alpha.id, ids.max, TeamRole.MEMBER);
    const beta = await container.teamRepository.create({ name: 'Beta' });
    await container.teamRepository.addMember(beta.id, ids.olga, TeamRole.MANAGER);

    app = await buildApp({ config, container });
    await app.ready();

    for (const [name] of people) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: `${name}@example.com`, password: PASSWORD },
      });
      tokens[name] = res.json().data.token;
    }
  });

  afterAll(async () => {
    await app.close();
  });

  describe('what gets recorded', () => {
    it('ACT-001: creating an item records CREATED with the initial values and who did it', async () => {
      const id = await createItem('mo');
      const [entry] = await history(id);

      expect(entry).toMatchObject({
        workItemId: id,
        sequence: 1,
        type: 'CREATED',
        actorId: ids.mo,
        actorName: 'mo',
        metadata: { version: 1 },
      });
      const changed = Object.fromEntries(entry.changes.map((c: Entry) => [c.field, c]));
      expect(changed.title).toEqual({ field: 'title', from: null, to: 'Refund not received' });
      expect(changed.status.to).toBe('OPEN');
      expect(changed.priority.to).toBe('LOW');
      expect(changed.teamId.to).toBe(alphaTeam);
      expect(changed.assigneeId.to).toBeNull();
    });

    it('ACT-002: a save records one UPDATED entry listing every changed field with before and after', async () => {
      const id = await createItem('mo');
      await lock(id, 'mo');
      const response = await patch(id, 'mo', {
        version: 1,
        title: 'Refund missing after 5 days',
        priority: 'HIGH',
      });
      expect(response.statusCode).toBe(200);

      const entries = await history(id);
      const updates = entries.filter((e) => e.type === 'UPDATED');
      expect(updates).toHaveLength(1);
      expect(updates[0]).toMatchObject({ actorId: ids.mo, metadata: { version: 2 } });
      expect(updates[0].changes).toEqual(
        expect.arrayContaining([
          { field: 'title', from: 'Refund not received', to: 'Refund missing after 5 days' },
          { field: 'priority', from: 'LOW', to: 'HIGH' },
        ]),
      );
      expect(updates[0].changes).toHaveLength(2); // untouched fields are not listed
    });

    it('ACT-003: status and assignment changes are recorded, attributed to whoever made them', async () => {
      const id = await createItem('mo');
      await lock(id, 'mia');
      await patch(id, 'mia', { version: 1, status: 'IN_PROGRESS', assigneeId: ids.max });

      const update = (await history(id)).find((e) => e.type === 'UPDATED')!;
      expect(update.actorId).toBe(ids.mia);
      expect(update.changes).toEqual(
        expect.arrayContaining([
          { field: 'status', from: 'OPEN', to: 'IN_PROGRESS' },
          { field: 'assigneeId', from: null, to: ids.max },
        ]),
      );
    });

    it('ACT-004: successive edits chain — each "from" is the previous "to"', async () => {
      const id = await createItem('mo', { title: 'v0' });
      await lock(id, 'mo');
      await patch(id, 'mo', { version: 1, title: 'v1' });
      await patch(id, 'mo', { version: 2, title: 'v2' });
      await patch(id, 'mo', { version: 3, title: 'v3' });

      const titles = (await history(id))
        .filter((e) => e.type === 'UPDATED')
        .map((e) => e.changes[0]);
      expect(titles).toEqual([
        { field: 'title', from: 'v0', to: 'v1' },
        { field: 'title', from: 'v1', to: 'v2' },
        { field: 'title', from: 'v2', to: 'v3' },
      ]);
    });

    it('ACT-005: a no-op save (same values) records nothing', async () => {
      const id = await createItem('mo');
      await lock(id, 'mo');
      const before = (await history(id)).length;

      const response = await patch(id, 'mo', { version: 1, title: 'Refund not received' });
      expect(response.statusCode).toBe(200);
      expect(await history(id)).toHaveLength(before);
    });

    it('ACT-006: rejected requests record nothing', async () => {
      const id = await createItem('mo');
      await lock(id, 'mo');
      const before = (await history(id)).length;

      const denied = await patch(id, 'mo', { version: 1, assigneeId: ids.mo }); // manager only
      const invalid = await patch(id, 'mo', { version: 1, status: 'RESOLVED' }); // bad transition
      await patch(id, 'mo', { version: 1, title: 'ok' }); // succeeds → v2 (1 new entry)
      const stale = await patch(id, 'mo', { version: 1, title: 'stale' });
      const lockedOut = await patch(id, 'max', { version: 2, title: 'no lock' });
      const lockBlocked = await lock(id, 'max');

      expect([denied.statusCode, invalid.statusCode]).toEqual([403, 422]);
      expect([stale.statusCode, lockedOut.statusCode, lockBlocked.statusCode]).toEqual([
        409, 423, 423,
      ]);
      expect(await history(id)).toHaveLength(before + 1);
    });
  });

  describe('lock events', () => {
    it('ACT-007: acquiring a lock is recorded once — renewals and heartbeats are not', async () => {
      const id = await createItem('mo');
      await lock(id, 'mo');
      await lock(id, 'mo'); // renew
      await api('POST', `/api/work-items/${id}/lock/heartbeat`, 'mo');
      await api('POST', `/api/work-items/${id}/lock/heartbeat`, 'mo');

      const entries = await history(id);
      expect(types(entries)).toEqual(['CREATED', 'LOCK_ACQUIRED']);
      expect(entries[1]).toMatchObject({ actorId: ids.mo, actorName: 'mo' });
      expect(entries[1].metadata.expiresAt).toBe(new Date(nowMs + 10 * 60_000).toISOString());
    });

    it('ACT-008: releasing your lock is recorded', async () => {
      const id = await createItem('mo');
      await lock(id, 'mo');
      await unlock(id, 'mo');

      const entries = await history(id);
      expect(types(entries)).toEqual(['CREATED', 'LOCK_ACQUIRED', 'LOCK_RELEASED']);
      expect(entries[2].actorId).toBe(ids.mo);
    });

    it("ACT-009: a manager force-releasing someone's lock is recorded with who held it", async () => {
      const id = await createItem('mo');
      await lock(id, 'mo');
      await unlock(id, 'mia');

      const entry = (await history(id)).find((e) => e.type === 'LOCK_FORCE_RELEASED')!;
      expect(entry.actorId).toBe(ids.mia);
      expect(entry.metadata.previousHolderId).toBe(ids.mo);
    });

    it('ACT-010: failed lock attempts and refused releases record nothing', async () => {
      const id = await createItem('mo');
      await lock(id, 'mo');
      const before = (await history(id)).length;

      expect((await lock(id, 'max')).statusCode).toBe(423);
      expect((await unlock(id, 'max')).statusCode).toBe(403);
      expect((await lock(id, 'olga')).statusCode).toBe(403);

      expect(await history(id)).toHaveLength(before);
    });

    it('ACT-011: a lock taken over after expiry is recorded as a new acquisition', async () => {
      const id = await createItem('mo');
      await lock(id, 'mo');
      advanceMinutes(11);
      await lock(id, 'max');

      const acquisitions = (await history(id)).filter((e) => e.type === 'LOCK_ACQUIRED');
      expect(acquisitions.map((e) => e.actorId)).toEqual([ids.mo, ids.max]);
    });
  });

  describe('reading the history', () => {
    it('ACT-012: a full editing session reads as a coherent story', async () => {
      const id = await createItem('mo');
      await lock(id, 'mo');
      await patch(id, 'mo', { version: 1, status: 'IN_PROGRESS' });
      await patch(id, 'mo', { version: 2, description: 'Escalated to payments' });
      await unlock(id, 'mo');

      const entries = await history(id);
      expect(types(entries)).toEqual([
        'CREATED',
        'LOCK_ACQUIRED',
        'UPDATED',
        'UPDATED',
        'LOCK_RELEASED',
      ]);
      expect(entries.map((e) => e.sequence)).toEqual([1, 2, 3, 4, 5]);
    });

    it('ACT-013: newest first by default; order=asc gives oldest first', async () => {
      const id = await createItem('mo');
      await lock(id, 'mo');
      await unlock(id, 'mo');

      const defaultOrder = await history(id, 'mo', 'pageSize=100');
      expect(defaultOrder.map((e) => e.sequence)).toEqual([3, 2, 1]);
      const asc = await history(id, 'mo', 'order=asc');
      expect(asc.map((e) => e.sequence)).toEqual([1, 2, 3]);
    });

    it('ACT-014: timestamps come from the clock and never go backwards', async () => {
      const id = await createItem('mo');
      advanceMinutes(3);
      await lock(id, 'mo');
      advanceMinutes(2);
      await unlock(id, 'mo');

      const entries = await history(id);
      const times = entries.map((e) => Date.parse(e.createdAt));
      expect(times[1] - times[0]).toBe(3 * 60_000);
      expect(times[2] - times[1]).toBe(2 * 60_000);
    });

    it('ACT-015: entries can be filtered by type', async () => {
      const id = await createItem('mo');
      await lock(id, 'mo');
      await patch(id, 'mo', { version: 1, title: 'a' });
      await patch(id, 'mo', { version: 2, title: 'b' });

      const updates = await history(id, 'mo', 'type=UPDATED&order=asc');
      expect(types(updates)).toEqual(['UPDATED', 'UPDATED']);

      const bad = await api('GET', `/api/work-items/${id}/activity?type=BOGUS`, 'mo');
      expect(bad.statusCode).toBe(400);
    });

    it('ACT-016: results are paginated with correct metadata', async () => {
      const id = await createItem('mo');
      await lock(id, 'mo');
      await patch(id, 'mo', { version: 1, title: 'a' });
      await patch(id, 'mo', { version: 2, title: 'b' });
      await unlock(id, 'mo'); // 5 entries in total

      const first = await api('GET', `/api/work-items/${id}/activity?order=asc&page=1&pageSize=2`, 'mo');
      const last = await api('GET', `/api/work-items/${id}/activity?order=asc&page=3&pageSize=2`, 'mo');

      expect(first.json().data.map((e: Entry) => e.sequence)).toEqual([1, 2]);
      expect(first.json().meta).toMatchObject({
        page: 1,
        pageSize: 2,
        totalCount: 5,
        totalPages: 3,
        hasNext: true,
        hasPrev: false,
      });
      expect(last.json().data.map((e: Entry) => e.sequence)).toEqual([5]);
      expect(last.json().meta).toMatchObject({ hasNext: false, hasPrev: true });
      expect(
        (await api('GET', `/api/work-items/${id}/activity?pageSize=101`, 'mo')).statusCode,
      ).toBe(400);
    });

    it("ACT-017: each item has its own history — one item's events never appear in another's", async () => {
      const a = await createItem('mo');
      const b = await createItem('max');
      await lock(a, 'mo');
      await patch(a, 'mo', { version: 1, title: 'only on A' });

      const historyB = await history(b);
      expect(types(historyB)).toEqual(['CREATED']);
      expect(historyB[0].actorId).toBe(ids.max);
      expect(historyB[0].sequence).toBe(1);
    });
  });

  describe('access control', () => {
    it('ACT-018: requires authentication', async () => {
      const id = await createItem('mo');
      const response = await app.inject({ method: 'GET', url: `/api/work-items/${id}/activity` });
      expect(response.statusCode).toBe(401);
    });

    it('ACT-019: team members and admins can read it; other teams cannot', async () => {
      const id = await createItem('mo');

      expect((await api('GET', `/api/work-items/${id}/activity`, 'max')).statusCode).toBe(200);
      expect((await api('GET', `/api/work-items/${id}/activity`, 'mia')).statusCode).toBe(200);
      expect((await api('GET', `/api/work-items/${id}/activity`, 'admin')).statusCode).toBe(200);

      const outsider = await api('GET', `/api/work-items/${id}/activity`, 'olga');
      expect(outsider.statusCode).toBe(403);
      expect(outsider.json().error.code).toBe('NOT_TEAM_MEMBER');
    });

    it('ACT-020: unknown item is 404 and a malformed id is 400', async () => {
      const missing = await api('GET', `/api/work-items/${UNKNOWN_ID}/activity`, 'admin');
      expect(missing.statusCode).toBe(404);
      expect(missing.json().error.code).toBe('WORK_ITEM_NOT_FOUND');
      expect((await api('GET', '/api/work-items/nope/activity', 'admin')).statusCode).toBe(400);
    });

    it('ACT-021: there is no way to write, change or delete history through the API', async () => {
      const id = await createItem('mo');
      for (const method of ['POST', 'PATCH', 'PUT', 'DELETE'] as const) {
        const response = await app.inject({
          method,
          url: `/api/work-items/${id}/activity`,
          headers: as('admin'),
          payload: { type: 'CREATED' },
        });
        expect(response.statusCode).toBe(404);
      }
      expect(await history(id)).toHaveLength(1);
    });
  });
});
