import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../app';
import { createTestConfig } from '../../config';
import { AppContainer, createContainer } from '../../container';
import { TeamRole } from '../../shared/types/auth';
import { WorkItemPriority, WorkItemType } from './work-item.entity';

const PASSWORD = 'a-long-test-password';
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';
const TIMEOUT_MINUTES = 10;

describe('Work item locking', () => {
  const config = createTestConfig({ LOCK_TIMEOUT_MINUTES: TIMEOUT_MINUTES });
  let app: FastifyInstance;
  let container: AppContainer;

  // Controllable clock so expiry is tested without sleeping
  let nowMs = Date.parse('2026-03-01T09:00:00.000Z');
  const clock = { now: () => new Date(nowMs) };
  const advanceMinutes = (minutes: number) => {
    nowMs += minutes * 60_000;
  };

  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  let alphaTeam: string;
  let betaTeam: string;

  const as = (who: string) => ({ authorization: `Bearer ${tokens[who]}` });
  const api = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, who: string, payload?: Record<string, unknown>) =>
    app.inject({ method, url, headers: as(who), payload });

  const lockUrl = (itemId: string) => `/api/work-items/${itemId}/lock`;
  const iso = (offsetMinutes: number) => new Date(nowMs + offsetMinutes * 60_000).toISOString();

  /** Each test gets its own item so lock state never leaks between tests. */
  async function newItem(teamId = alphaTeam): Promise<string> {
    const item = await container.workItemRepository.create({
      title: 'Payment stuck in pending',
      description: '',
      type: WorkItemType.PAYMENT_INVESTIGATION,
      priority: WorkItemPriority.MEDIUM,
      teamId,
      createdBy: ids.mo,
      assigneeId: null,
    });
    return item.id;
  }

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
    betaTeam = beta.id;
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

  describe('acquiring', () => {
    it('LOCK-001: lock endpoints require authentication', async () => {
      const id = await newItem();
      const response = await app.inject({ method: 'POST', url: lockUrl(id) });
      expect(response.statusCode).toBe(401);
    });

    it('LOCK-002: a member acquires the lock; it expires after the configured timeout', async () => {
      const id = await newItem();
      const response = await api('POST', lockUrl(id), 'mo');

      expect(response.statusCode).toBe(200);
      expect(response.json().data).toMatchObject({
        workItemId: id,
        lockedBy: ids.mo,
        acquiredAt: iso(0),
        expiresAt: iso(TIMEOUT_MINUTES),
      });
    });

    it('LOCK-003: outsiders are refused, unknown items are 404, admins may lock', async () => {
      const id = await newItem();

      const outsider = await api('POST', lockUrl(id), 'olga');
      expect(outsider.statusCode).toBe(403);
      expect(outsider.json().error.code).toBe('NOT_TEAM_MEMBER');

      const missing = await api('POST', lockUrl(UNKNOWN_ID), 'admin');
      expect(missing.statusCode).toBe(404);
      expect(missing.json().error.code).toBe('WORK_ITEM_NOT_FOUND');

      expect((await api('POST', lockUrl(id), 'admin')).statusCode).toBe(200);
      expect((await api('POST', lockUrl('not-a-uuid'), 'admin')).statusCode).toBe(400);
    });

    it('LOCK-004: a second user is refused with 423 and told who holds the lock until when', async () => {
      const id = await newItem();
      await api('POST', lockUrl(id), 'mo');

      const response = await api('POST', lockUrl(id), 'max');
      const body = response.json();

      expect(response.statusCode).toBe(423);
      expect(body.error.code).toBe('WORK_ITEM_LOCKED');
      expect(body.error.message).toContain('currently being edited by another user');
      expect(body.error.lockInfo).toEqual({ lockedBy: ids.mo, expiresAt: iso(TIMEOUT_MINUTES) });
    });

    it('LOCK-005: the holder re-acquiring renews the lock and keeps acquiredAt', async () => {
      const id = await newItem();
      const first = (await api('POST', lockUrl(id), 'mo')).json().data;

      advanceMinutes(4);
      const second = await api('POST', lockUrl(id), 'mo');

      expect(second.statusCode).toBe(200);
      expect(second.json().data.acquiredAt).toBe(first.acquiredAt);
      expect(second.json().data.expiresAt).toBe(iso(TIMEOUT_MINUTES));
    });

    it('LOCK-006: of two users acquiring simultaneously exactly one wins', async () => {
      const id = await newItem();
      const [a, b] = await Promise.all([
        api('POST', lockUrl(id), 'mo'),
        api('POST', lockUrl(id), 'max'),
      ]);

      expect([a.statusCode, b.statusCode].sort()).toEqual([200, 423]);
      const winner = a.statusCode === 200 ? ids.mo : ids.max;
      const current = await api('GET', lockUrl(id), 'mia');
      expect(current.json().data.lockedBy).toBe(winner);
    });

    it('LOCK-007: locks are per item — locking one item does not block another', async () => {
      const first = await newItem();
      const second = await newItem();
      await api('POST', lockUrl(first), 'mo');

      expect((await api('POST', lockUrl(second), 'max')).statusCode).toBe(200);
    });
  });

  describe('inspecting', () => {
    it('LOCK-008: members can see the current lock, or null when there is none', async () => {
      const id = await newItem();
      const none = await api('GET', lockUrl(id), 'max');
      expect(none.statusCode).toBe(200);
      expect(none.json().data).toBeNull();

      await api('POST', lockUrl(id), 'mo');
      const held = await api('GET', lockUrl(id), 'max');
      expect(held.json().data).toMatchObject({ lockedBy: ids.mo });
    });

    it('LOCK-009: outsiders cannot inspect a lock; reading the item itself is unaffected by locks', async () => {
      const id = await newItem();
      await api('POST', lockUrl(id), 'mo');

      expect((await api('GET', lockUrl(id), 'olga')).statusCode).toBe(403);
      expect((await api('GET', `/api/work-items/${id}`, 'max')).statusCode).toBe(200);
    });
  });

  describe('heartbeat and expiry', () => {
    it('LOCK-010: a heartbeat pushes the expiry out from now', async () => {
      const id = await newItem();
      await api('POST', lockUrl(id), 'mo');

      advanceMinutes(8);
      const response = await api('POST', `${lockUrl(id)}/heartbeat`, 'mo');

      expect(response.statusCode).toBe(200);
      expect(response.json().data.expiresAt).toBe(iso(TIMEOUT_MINUTES));

      advanceMinutes(8); // would have expired without the heartbeat
      expect((await api('GET', lockUrl(id), 'mo')).json().data).not.toBeNull();
    });

    it('LOCK-011: a heartbeat from a non-holder is refused with 423', async () => {
      const id = await newItem();
      await api('POST', lockUrl(id), 'mo');

      const response = await api('POST', `${lockUrl(id)}/heartbeat`, 'max');
      expect(response.statusCode).toBe(423);
      expect(response.json().error.lockInfo.lockedBy).toBe(ids.mo);
    });

    it('LOCK-012: a heartbeat with no lock held is 409 LOCK_NOT_HELD', async () => {
      const id = await newItem();
      const response = await api('POST', `${lockUrl(id)}/heartbeat`, 'mo');

      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe('LOCK_NOT_HELD');
    });

    it('LOCK-013: an expired lock disappears and someone else can take it', async () => {
      const id = await newItem();
      await api('POST', lockUrl(id), 'mo');

      advanceMinutes(TIMEOUT_MINUTES - 1);
      expect((await api('POST', lockUrl(id), 'max')).statusCode).toBe(423); // still held

      advanceMinutes(1); // exactly at expiry
      expect((await api('GET', lockUrl(id), 'max')).json().data).toBeNull();
      const taken = await api('POST', lockUrl(id), 'max');
      expect(taken.statusCode).toBe(200);
      expect(taken.json().data.lockedBy).toBe(ids.max);
    });

    it('LOCK-014: the original holder cannot revive an expired lock', async () => {
      const id = await newItem();
      await api('POST', lockUrl(id), 'mo');
      advanceMinutes(TIMEOUT_MINUTES + 1);

      // nobody else took it: heartbeat is still rejected, it must be re-acquired
      const stale = await api('POST', `${lockUrl(id)}/heartbeat`, 'mo');
      expect(stale.statusCode).toBe(409);
      expect(stale.json().error.code).toBe('LOCK_NOT_HELD');

      // someone else took it: heartbeat reports the new holder
      await api('POST', lockUrl(id), 'max');
      const taken = await api('POST', `${lockUrl(id)}/heartbeat`, 'mo');
      expect(taken.statusCode).toBe(423);
      expect(taken.json().error.lockInfo.lockedBy).toBe(ids.max);
    });
  });

  describe('releasing', () => {
    it('LOCK-015: the holder releases, after which others can lock', async () => {
      const id = await newItem();
      await api('POST', lockUrl(id), 'mo');

      const released = await api('DELETE', lockUrl(id), 'mo');
      expect(released.statusCode).toBe(200);
      expect((await api('GET', lockUrl(id), 'mo')).json().data).toBeNull();
      expect((await api('POST', lockUrl(id), 'max')).statusCode).toBe(200);
    });

    it('LOCK-016: another member cannot release your lock', async () => {
      const id = await newItem();
      await api('POST', lockUrl(id), 'mo');

      const response = await api('DELETE', lockUrl(id), 'max');
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe('NOT_LOCK_HOLDER');
      expect((await api('GET', lockUrl(id), 'mo')).json().data.lockedBy).toBe(ids.mo);
    });

    it('LOCK-017: a team manager or admin can force-release a lock', async () => {
      const first = await newItem();
      await api('POST', lockUrl(first), 'mo');
      expect((await api('DELETE', lockUrl(first), 'mia')).statusCode).toBe(200);
      expect((await api('GET', lockUrl(first), 'mo')).json().data).toBeNull();

      const second = await newItem();
      await api('POST', lockUrl(second), 'mo');
      expect((await api('DELETE', lockUrl(second), 'admin')).statusCode).toBe(200);
    });

    it('LOCK-018: a manager of another team cannot touch the lock', async () => {
      const id = await newItem();
      await api('POST', lockUrl(id), 'mo');

      const response = await api('DELETE', lockUrl(id), 'olga');
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe('NOT_TEAM_MEMBER');
    });

    it('LOCK-019: releasing when nothing is locked is 409 LOCK_NOT_HELD', async () => {
      const id = await newItem();
      const response = await api('DELETE', lockUrl(id), 'mo');

      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe('LOCK_NOT_HELD');
    });
  });

  describe('enforcement on edits', () => {
    const patch = (id: string, who: string, payload: Record<string, unknown>) =>
      api('PATCH', `/api/work-items/${id}`, who, payload);

    it('LOCK-020: editing without holding the lock is rejected with 409 LOCK_REQUIRED', async () => {
      const id = await newItem();
      const response = await patch(id, 'mo', { version: 1, title: 'No lock taken' });

      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe('LOCK_REQUIRED');
      expect((await container.workItemRepository.findById(id))!.title).toBe(
        'Payment stuck in pending',
      );
    });

    it('LOCK-021: editing while someone else holds the lock is 423 with lock details', async () => {
      const id = await newItem();
      await api('POST', lockUrl(id), 'mo');

      const response = await patch(id, 'max', { version: 1, title: 'Stomping on mo' });
      expect(response.statusCode).toBe(423);
      expect(response.json().error.code).toBe('WORK_ITEM_LOCKED');
      expect(response.json().error.lockInfo.lockedBy).toBe(ids.mo);
      expect((await container.workItemRepository.findById(id))!.version).toBe(1);
    });

    it('LOCK-022: the holder can edit repeatedly and keeps the lock afterwards', async () => {
      const id = await newItem();
      await api('POST', lockUrl(id), 'mo');

      expect((await patch(id, 'mo', { version: 1, title: 'First edit' })).statusCode).toBe(200);
      expect((await patch(id, 'mo', { version: 2, priority: 'HIGH' })).statusCode).toBe(200);
      expect((await api('GET', lockUrl(id), 'mo')).json().data.lockedBy).toBe(ids.mo);
    });

    it('LOCK-023: an expired lock no longer allows editing', async () => {
      const id = await newItem();
      await api('POST', lockUrl(id), 'mo');
      advanceMinutes(TIMEOUT_MINUTES + 1);

      const response = await patch(id, 'mo', { version: 1, title: 'Too late' });
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe('LOCK_REQUIRED');
    });

    it('LOCK-024: after a lock expires and another user saves, the first user is locked out and their stale version could not win anyway', async () => {
      const id = await newItem();
      await api('POST', lockUrl(id), 'mo'); // mo reads version 1 and starts editing
      advanceMinutes(TIMEOUT_MINUTES + 1); // mo goes idle past the timeout

      await api('POST', lockUrl(id), 'max');
      expect((await patch(id, 'max', { version: 1, title: "max's edit" })).statusCode).toBe(200);

      const moSave = await patch(id, 'mo', { version: 1, title: "mo's late edit" });
      expect(moSave.statusCode).toBe(423); // max holds the lock now
      expect((await container.workItemRepository.findById(id))!.title).toBe("max's edit");
    });

    it('LOCK-025: the version check still protects a lock holder with a stale version', async () => {
      const id = await newItem();
      await api('POST', lockUrl(id), 'mo');
      await patch(id, 'mo', { version: 1, title: 'v2' });

      const stale = await patch(id, 'mo', { version: 1, title: 'based on old data' });
      expect(stale.statusCode).toBe(409);
      expect(stale.json().error.code).toBe('VERSION_CONFLICT');
    });

    it('LOCK-026: after releasing, the next edit needs the lock again', async () => {
      const id = await newItem();
      await api('POST', lockUrl(id), 'mo');
      expect((await patch(id, 'mo', { version: 1, title: 'edit one' })).statusCode).toBe(200);
      await api('DELETE', lockUrl(id), 'mo');

      const response = await patch(id, 'mo', { version: 2, title: 'edit two' });
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe('LOCK_REQUIRED');
    });

    it('LOCK-027: a lock on one item does not allow or block edits to another', async () => {
      const locked = await newItem();
      const other = await newItem();
      await api('POST', lockUrl(locked), 'mo');

      const response = await patch(other, 'mo', { version: 1, title: 'wrong item' });
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe('LOCK_REQUIRED');
    });

    it('LOCK-028: permission checks still apply to the lock holder', async () => {
      const id = await newItem();
      await api('POST', lockUrl(id), 'mo');

      // holding the lock does not let a member close an item or assign it
      const assign = await patch(id, 'mo', { version: 1, assigneeId: ids.mo });
      expect(assign.statusCode).toBe(403);
      expect(assign.json().error.code).toBe('TEAM_MANAGER_REQUIRED');
    });

    it('LOCK-029: locks cannot be used across teams', async () => {
      const betaItem = await newItem(betaTeam);
      expect((await api('POST', lockUrl(betaItem), 'mo')).statusCode).toBe(403);
      expect((await api('POST', lockUrl(betaItem), 'olga')).statusCode).toBe(200);
    });
  });
});
