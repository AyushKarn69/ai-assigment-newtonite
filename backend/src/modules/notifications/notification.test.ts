import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHarness, Harness, UNKNOWN_ID } from '../../test-utils/harness';
import { InMemoryJobQueue } from '../../shared/queue/index';
import { TeamRole } from '../../shared/types/auth';

type N = {
  id: string;
  type: string;
  message: string;
  workItemKey: string;
  workItemTitle: string;
  actorName: string | null;
  readAt: string | null;
};

describe('Notifications (asynchronous)', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await createHarness({ jobQueue: new InMemoryJobQueue({ maxAttempts: 3, backoffMs: 0 }) });
  });
  afterEach(async () => {
    await h.close();
  });

  /** Wait for background processing, then fetch a user's notifications (newest first). */
  async function inbox(who: string, query = ''): Promise<N[]> {
    await h.container.jobQueue.drain();
    const response = await h.api('GET', `/api/notifications?pageSize=100${query}`, who);
    expect(response.statusCode).toBe(200);
    return response.json().data;
  }
  const types = (items: N[]) => items.map((n) => n.type);

  const assign = async (itemId: string, who: string, assigneeId: string | null, version = 1) => {
    await h.api('POST', `/api/work-items/${itemId}/lock`, who);
    const response = await h.api('PATCH', `/api/work-items/${itemId}`, who, { version, assigneeId });
    expect(response.statusCode).toBe(200);
    return response;
  };
  const edit = async (itemId: string, who: string, payload: Record<string, unknown>) => {
    await h.api('POST', `/api/work-items/${itemId}/lock`, who); // acquire, or renew our own
    return h.api('PATCH', `/api/work-items/${itemId}`, who, payload);
  };

  it('NOTIF-001: all endpoints require authentication', async () => {
    for (const [method, url] of [
      ['GET', '/api/notifications'],
      ['GET', '/api/notifications/unread-count'],
      ['POST', '/api/notifications/read-all'],
      ['POST', `/api/notifications/${UNKNOWN_ID}/read`],
    ] as const) {
      expect((await h.app.inject({ method, url })).statusCode).toBe(401);
    }
  });

  it('NOTIF-002: assigning an item notifies the new assignee, not the person who assigned it', async () => {
    const id = await h.createItem('mo', { title: 'Reconcile ledger' });
    await assign(id, 'mia', h.ids.max);

    const [n] = await inbox('max');
    expect(n).toMatchObject({
      type: 'ASSIGNED',
      workItemTitle: 'Reconcile ledger',
      actorName: 'mia',
      readAt: null,
    });
    expect(n.message).toBe(`mia assigned ${n.workItemKey} to you`);
    expect(await inbox('mia')).toEqual([]);
  });

  it('NOTIF-003: creating an item with an assignee notifies that assignee', async () => {
    await h.createItem('mia', { assigneeId: h.ids.mo });
    expect(types(await inbox('mo'))).toEqual(['ASSIGNED']);
  });

  it('NOTIF-004: reassigning notifies both the new and the previous assignee', async () => {
    const id = await h.createItem('mo');
    await assign(id, 'mia', h.ids.mo);
    await assign(id, 'mia', h.ids.max, 2);

    expect(types(await inbox('max'))).toEqual(['ASSIGNED']);
    const moInbox = await inbox('mo');
    expect(types(moInbox)).toEqual(['UNASSIGNED', 'ASSIGNED']); // newest first
    expect(moInbox[0].message).toContain('unassigned you from');
  });

  it('NOTIF-005: a status change notifies the assignee and the reporter but not the actor', async () => {
    const id = await h.createItem('mo'); // mo reports
    await assign(id, 'mia', h.ids.max); // max is assignee
    await h.container.jobQueue.drain();

    await edit(id, 'mia', { version: 2, status: 'IN_PROGRESS' });

    const maxInbox = await inbox('max');
    expect(maxInbox[0]).toMatchObject({ type: 'STATUS_CHANGED' });
    expect(maxInbox[0].message).toContain('moved');
    expect(maxInbox[0].message).toContain('In Progress');
    expect(types(await inbox('mo'))).toEqual(['STATUS_CHANGED']);
    expect(types(await inbox('mia'))).toEqual([]);
  });

  it('NOTIF-006: assignment and status changed in one save give the assignee only the assignment notice', async () => {
    const id = await h.createItem('mo');
    await h.api('POST', `/api/work-items/${id}/lock`, 'mia');
    await h.api('PATCH', `/api/work-items/${id}`, 'mia', {
      version: 1,
      assigneeId: h.ids.max,
      status: 'IN_PROGRESS',
    });

    expect(types(await inbox('max'))).toEqual(['ASSIGNED']);
    expect(types(await inbox('mo'))).toEqual(['STATUS_CHANGED']); // the reporter still hears about the status
  });

  it('NOTIF-007: a comment notifies the assignee and reporter, but not the commenter', async () => {
    const id = await h.createItem('mo');
    await assign(id, 'mia', h.ids.max);
    await h.container.jobQueue.drain();

    await h.api('POST', `/api/work-items/${id}/comments`, 'mia', { body: 'please look' });

    expect((await inbox('max'))[0]).toMatchObject({ type: 'COMMENT_ADDED' });
    expect((await inbox('mo'))[0]).toMatchObject({ type: 'COMMENT_ADDED' });
    expect(types(await inbox('mia'))).toEqual([]);
  });

  it('NOTIF-008: someone who is both assignee and reporter gets one notification, not two', async () => {
    const id = await h.createItem('mo');
    await assign(id, 'mia', h.ids.mo); // mo reports and owns it
    await h.container.jobQueue.drain();
    const before = (await inbox('mo')).length;

    await h.api('POST', `/api/work-items/${id}/comments`, 'max', { body: 'hello' });
    expect(await inbox('mo')).toHaveLength(before + 1);
  });

  it('NOTIF-009: force-releasing a lock notifies the holder', async () => {
    const id = await h.createItem('mo');
    await h.api('POST', `/api/work-items/${id}/lock`, 'max');
    await h.api('DELETE', `/api/work-items/${id}/lock`, 'mia');

    const [n] = await inbox('max');
    expect(n.type).toBe('LOCK_FORCE_RELEASED');
    expect(n.message).toContain('released your edit lock');
  });

  it('NOTIF-010: your own actions and routine events create no notifications', async () => {
    const id = await h.createItem('mo');
    await h.api('POST', `/api/work-items/${id}/lock`, 'mo');
    await h.api('PATCH', `/api/work-items/${id}`, 'mo', { version: 1, title: 'renamed', priority: 'HIGH' });
    await h.api('PATCH', `/api/work-items/${id}`, 'mo', { version: 2, title: 'renamed' }); // no-op
    await h.api('POST', `/api/work-items/${id}/comments`, 'mo', { body: 'my own note' });
    await h.api('DELETE', `/api/work-items/${id}/lock`, 'mo'); // own release

    for (const who of ['mo', 'max', 'mia', 'admin']) expect(await inbox(who)).toEqual([]);
  });

  it('NOTIF-011: rejected requests create no notifications', async () => {
    const id = await h.createItem('mo');
    await h.api('POST', `/api/work-items/${id}/lock`, 'mo');
    const denied = await h.api('PATCH', `/api/work-items/${id}`, 'mo', { version: 1, assigneeId: h.ids.max });
    expect(denied.statusCode).toBe(403);

    expect(await inbox('max')).toEqual([]);
  });

  it('NOTIF-012: people who can no longer see the item are not notified', async () => {
    const id = await h.createItem('max'); // max reports it
    await h.container.teamRepository.removeMember(h.teams.alpha, h.ids.max);

    await h.api('POST', `/api/work-items/${id}/comments`, 'mo', { body: 'ping' });
    expect(await inbox('max')).toEqual([]);
  });

  it('NOTIF-013: admins are notified when they are the assignee, even outside the team', async () => {
    const id = await h.createItem('mo');
    await assign(id, 'mia', h.ids.max);
    // admin is not a member of alpha, but can be reporter of an item they create
    const adminItem = await h.createItem('admin', { title: 'admin reported' });
    await h.api('POST', `/api/work-items/${adminItem}/comments`, 'mo', { body: 'for admin' });

    expect((await inbox('admin'))[0]).toMatchObject({ type: 'COMMENT_ADDED', workItemTitle: 'admin reported' });
  });

  it('NOTIF-014: the inbox is private — each user sees only their own', async () => {
    const id = await h.createItem('mo');
    await assign(id, 'mia', h.ids.max);

    expect(await inbox('max')).toHaveLength(1);
    expect(await inbox('mo')).toEqual([]);
    expect(await inbox('olga')).toEqual([]);
  });

  it('NOTIF-015: lists newest first, paginates, and can show unread only', async () => {
    const id = await h.createItem('mo');
    await assign(id, 'mia', h.ids.max);
    for (const s of ['a', 'b', 'c']) await h.api('POST', `/api/work-items/${id}/comments`, 'mia', { body: s });
    await h.container.jobQueue.drain();

    const page1 = await h.api('GET', '/api/notifications?page=1&pageSize=2', 'max');
    expect(page1.json().meta).toMatchObject({ totalCount: 4, totalPages: 2, hasNext: true });
    expect(page1.json().data.map((n: N) => n.type)).toEqual(['COMMENT_ADDED', 'COMMENT_ADDED']);

    const first = (await inbox('max')).at(-1)!;
    await h.api('POST', `/api/notifications/${first.id}/read`, 'max');
    expect(await inbox('max', '&unread=true')).toHaveLength(3);
    expect((await h.api('GET', '/api/notifications?unread=maybe', 'max')).statusCode).toBe(400);
  });

  it('NOTIF-016: unread count follows reading', async () => {
    const id = await h.createItem('mo');
    await assign(id, 'mia', h.ids.max);
    await h.api('POST', `/api/work-items/${id}/comments`, 'mia', { body: 'x' });
    await h.container.jobQueue.drain();

    const count = async () => (await h.api('GET', '/api/notifications/unread-count', 'max')).json().data.count;
    expect(await count()).toBe(2);
    const [newest] = await inbox('max');
    await h.api('POST', `/api/notifications/${newest.id}/read`, 'max');
    expect(await count()).toBe(1);
  });

  it('NOTIF-017: marking read is idempotent and keeps the first read time', async () => {
    const id = await h.createItem('mo');
    await assign(id, 'mia', h.ids.max);
    const [n] = await inbox('max');

    const first = await h.api('POST', `/api/notifications/${n.id}/read`, 'max');
    expect(first.statusCode).toBe(200);
    expect(first.json().data.readAt).not.toBeNull();
    const second = await h.api('POST', `/api/notifications/${n.id}/read`, 'max');
    expect(second.json().data.readAt).toBe(first.json().data.readAt);
  });

  it("NOTIF-018: you cannot read someone else's notification — it looks like it does not exist", async () => {
    const id = await h.createItem('mo');
    await assign(id, 'mia', h.ids.max);
    const [n] = await inbox('max');

    const response = await h.api('POST', `/api/notifications/${n.id}/read`, 'mo');
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NOTIFICATION_NOT_FOUND');
    expect((await inbox('max'))[0].readAt).toBeNull(); // untouched
    expect((await h.api('POST', `/api/notifications/${UNKNOWN_ID}/read`, 'max')).statusCode).toBe(404);
    expect((await h.api('POST', '/api/notifications/nope/read', 'max')).statusCode).toBe(400);
  });

  it('NOTIF-019: read-all marks only my notifications and reports how many changed', async () => {
    const id = await h.createItem('mo');
    await assign(id, 'mia', h.ids.max);
    await h.api('POST', `/api/work-items/${id}/comments`, 'mia', { body: 'x' });
    await h.container.jobQueue.drain();
    const moBefore = await h.api('GET', '/api/notifications/unread-count', 'mo');

    const response = await h.api('POST', '/api/notifications/read-all', 'max');
    expect(response.json().data).toEqual({ updated: 2 });
    expect((await h.api('GET', '/api/notifications/unread-count', 'max')).json().data.count).toBe(0);
    expect((await h.api('GET', '/api/notifications/unread-count', 'mo')).json().data.count).toBe(
      moBefore.json().data.count,
    );
    expect((await h.api('POST', '/api/notifications/read-all', 'max')).json().data).toEqual({ updated: 0 });
  });

  describe('reliability', () => {
    it('NOTIF-020: delivery is in the background — the request is answered before notifications exist', async () => {
      const id = await h.createItem('mo');
      await h.api('POST', `/api/work-items/${id}/lock`, 'mia');
      await h.api('PATCH', `/api/work-items/${id}`, 'mia', { version: 1, assigneeId: h.ids.max });

      // straight after the response nothing has been delivered yet…
      const early = await h.container.notificationRepository.countUnread(h.ids.max);
      expect(early).toBe(0);
      // …but it arrives once the queue has run
      await h.container.jobQueue.drain();
      expect(await h.container.notificationRepository.countUnread(h.ids.max)).toBe(1);
    });

    it('NOTIF-021: a replayed job does not create duplicate notifications', async () => {
      const id = await h.createItem('mo');
      await assign(id, 'mia', h.ids.max);
      await h.container.jobQueue.drain();

      const history = (await h.api('GET', `/api/work-items/${id}/activity?order=asc`, 'mia')).json().data;
      const assignment = history.find((e: { type: string }) => e.type === 'UPDATED');
      await h.container.jobQueue.enqueue('activity.recorded', {
        ...assignment,
        createdAt: new Date(assignment.createdAt),
      });
      await h.container.jobQueue.drain();

      expect(types(await inbox('max'))).toEqual(['ASSIGNED']);
    });

    it('NOTIF-022: a transient failure is retried and the notification still arrives exactly once', async () => {
      const repo = h.container.notificationRepository;
      const original = repo.create.bind(repo);
      let failures = 0;
      repo.create = async (input) => {
        if (failures < 2) {
          failures += 1;
          throw new Error('database blip');
        }
        return original(input);
      };

      const id = await h.createItem('mo');
      await assign(id, 'mia', h.ids.max);

      expect(types(await inbox('max'))).toEqual(['ASSIGNED']);
      expect(failures).toBe(2);
      expect(h.container.jobQueue.failedJobs()).toEqual([]);
    });

    it('NOTIF-023: a permanent notification failure never fails or alters the user request', async () => {
      h.container.notificationRepository.create = async () => {
        throw new Error('notifications are down');
      };

      const id = await h.createItem('mo');
      await h.api('POST', `/api/work-items/${id}/lock`, 'mia');
      const response = await h.api('PATCH', `/api/work-items/${id}`, 'mia', { version: 1, assigneeId: h.ids.max });
      expect(response.statusCode).toBe(200);
      expect(response.json().data.assigneeId).toBe(h.ids.max);

      await h.container.jobQueue.drain();
      expect(h.container.jobQueue.failedJobs().length).toBeGreaterThan(0); // dead-lettered, visible to operators
      const history = (await h.api('GET', `/api/work-items/${id}/activity`, 'mia')).json().data;
      expect(history.some((e: { type: string }) => e.type === 'UPDATED')).toBe(true);
    });

    it('NOTIF-024: if the queue itself is unavailable the request still succeeds', async () => {
      const broken = await createHarness({
        jobQueue: {
          register: () => {},
          enqueue: async () => {
            throw new Error('queue down');
          },
          drain: async () => {},
          close: async () => {},
          failedJobs: () => [],
          setLogger: () => {},
        },
      });
      try {
        const id = await broken.createItem('mo');
        await broken.api('POST', `/api/work-items/${id}/lock`, 'mia');
        const response = await broken.api('PATCH', `/api/work-items/${id}`, 'mia', { version: 1, assigneeId: broken.ids.max });
        expect(response.statusCode).toBe(200);
        await broken.container.teamRepository.addMember(broken.teams.beta, broken.ids.mo, TeamRole.MEMBER);
      } finally {
        await broken.close();
      }
    });
  });
});
