import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHarness, Harness, PASSWORD, UNKNOWN_ID } from './test-utils/harness';
import { allowedTransitions } from './modules/work-items/work-item.workflow';
import { WorkItemStatus } from './modules/work-items/work-item.entity';
import { TeamRole } from './shared/types/auth';

type Json = Record<string, any>;

describe('End-to-end integration', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h.close();
  });

  const settle = () => h.container.jobQueue.drain();

  /** Send a request and require a specific status; returns the parsed body. */
  async function ok(
    response: ReturnType<Harness['api']>,
    status = 200,
  ): Promise<Json> {
    const res = await response;
    expect(res.statusCode, res.body).toBe(status);
    return res.json();
  }
  const lock = (id: string, who: string) => h.api('POST', `/api/work-items/${id}/lock`, who);
  const unlock = (id: string, who: string) => h.api('DELETE', `/api/work-items/${id}/lock`, who);
  const patch = (id: string, who: string, payload: Json) =>
    h.api('PATCH', `/api/work-items/${id}`, who, payload);
  const history = async (id: string, who = 'admin'): Promise<Json[]> =>
    (await ok(h.api('GET', `/api/work-items/${id}/activity?order=asc&pageSize=100`, who))).data;

  it('INT-001: a work item lives its whole life and every part of the system agrees', async () => {
    // An admin creates a team with nina as manager; she adds mo as a member.
    const team = (await ok(h.api('POST', '/api/teams', 'admin', { name: 'Payments', managerId: h.ids.nina }), 201)).data;
    await ok(h.api('POST', `/api/teams/${team.id}/members`, 'nina', { userId: h.ids.mo }), 201);

    // mo reports a problem.
    const item = (
      await ok(
        h.api('POST', '/api/work-items', 'mo', {
          title: 'Refund batch stuck',
          description: 'Batch 4411 has not settled',
          type: 'PAYMENT_INVESTIGATION',
          priority: 'HIGH',
          teamId: team.id,
        }),
        201,
      )
    ).data;
    expect(item).toMatchObject({ status: 'OPEN', version: 1, createdBy: h.ids.mo });

    // Members cannot assign; the manager can, and starts the work in the same save.
    await lock(item.id, 'mo');
    expect((await patch(item.id, 'mo', { version: 1, assigneeId: h.ids.mo })).statusCode).toBe(403);
    await unlock(item.id, 'mo');
    await lock(item.id, 'nina');
    await ok(patch(item.id, 'nina', { version: 1, assigneeId: h.ids.mo, status: 'IN_PROGRESS' }));
    await unlock(item.id, 'nina');

    // mo is told about it, in the background.
    await settle();
    expect((await ok(h.api('GET', '/api/notifications/unread-count', 'mo'))).data.count).toBe(1);

    // mo edits; while mo holds the lock nina cannot edit and is told who does.
    await lock(item.id, 'mo');
    await ok(patch(item.id, 'mo', { version: 2, description: 'Batch 4411 stuck at the bank', status: 'IN_REVIEW' }));
    const blocked = await lock(item.id, 'nina');
    expect(blocked.statusCode).toBe(423);
    expect(blocked.json().error.lockInfo.lockedBy).toBe(h.ids.mo);
    await unlock(item.id, 'mo');

    // nina comments; mo is notified.
    await ok(h.api('POST', `/api/work-items/${item.id}/comments`, 'nina', { body: 'Bank confirmed the fix.' }), 201);

    // mo resolves it, nina closes it (closing is a manager decision).
    await lock(item.id, 'mo');
    await ok(patch(item.id, 'mo', { version: 3, status: 'RESOLVED' }));
    await unlock(item.id, 'mo');
    await lock(item.id, 'nina');
    await ok(patch(item.id, 'nina', { version: 4, status: 'CLOSED' }));
    await unlock(item.id, 'nina');

    // ---- everything agrees ----
    const final = (await ok(h.api('GET', `/api/work-items/${item.id}`, 'mo'))).data;
    expect(final).toMatchObject({ status: 'CLOSED', version: 5, assigneeId: h.ids.mo });

    const entries = await history(item.id);
    expect(entries.map((e) => `${e.type}:${e.actorName}`)).toEqual([
      'CREATED:mo',
      'LOCK_ACQUIRED:mo',
      'LOCK_RELEASED:mo',
      'LOCK_ACQUIRED:nina',
      'UPDATED:nina',
      'LOCK_RELEASED:nina',
      'LOCK_ACQUIRED:mo',
      'UPDATED:mo',
      'LOCK_RELEASED:mo',
      'COMMENT_ADDED:nina',
      'LOCK_ACQUIRED:mo',
      'UPDATED:mo',
      'LOCK_RELEASED:mo',
      'LOCK_ACQUIRED:nina',
      'UPDATED:nina',
      'LOCK_RELEASED:nina',
    ]);
    expect(entries.map((e) => e.sequence)).toEqual(entries.map((_, i) => i + 1));

    // search, dashboard and notifications reflect the same facts
    const found = await ok(h.api('GET', `/api/work-items?search=${final.key}`, 'nina'));
    expect(found.data.map((i: Json) => i.id)).toEqual([item.id]);

    const dash = (await ok(h.api('GET', '/api/dashboard', 'nina'))).data;
    expect(dash.counts).toMatchObject({ total: 1, open: 0, myWork: 0 });
    expect(dash.byStatus.CLOSED).toBe(1);
    expect(dash.recentActivity[0]).toMatchObject({ workItemId: item.id, type: 'LOCK_RELEASED' });

    await settle();
    const moInbox = (await ok(h.api('GET', '/api/notifications', 'mo'))).data as Json[];
    expect(moInbox.map((n) => n.type).sort()).toEqual(['ASSIGNED', 'COMMENT_ADDED', 'STATUS_CHANGED'].sort());
    // nina made the assignment, comment and close herself, so she heard about none of them
    expect((await ok(h.api('GET', '/api/notifications', 'nina'))).data).toEqual([]);

    // a stranger sees none of it
    expect((await h.api('GET', `/api/work-items/${item.id}`, 'olga')).statusCode).toBe(403);
    expect((await ok(h.api('GET', `/api/work-items?search=${final.key}`, 'olga'))).data).toEqual([]);
  });

  it('INT-002: twelve people race for one lock — exactly one wins each round', async () => {
    const racers = ['mia', 'mo', 'max'];
    for (let i = 0; i < 9; i++) {
      const name = `racer${i}`;
      const user = await h.container.userService.createUser({
        email: `${name}@example.com`,
        name,
        password: PASSWORD,
      });
      h.ids[name] = user.id;
      await h.container.teamRepository.addMember(h.teams.alpha, user.id, TeamRole.MEMBER);
      const login = await h.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: `${name}@example.com`, password: PASSWORD },
      });
      h.tokens[name] = login.json().data.token;
      racers.push(name);
    }
    const id = await h.createItem('mo', { title: 'Contended item' });

    const round1 = await Promise.all(racers.map((who) => lock(id, who)));
    const winners1 = racers.filter((_, i) => round1[i].statusCode === 200);
    expect(winners1).toHaveLength(1);
    const losers = round1.filter((r) => r.statusCode !== 200);
    expect(losers).toHaveLength(11);
    for (const loser of losers) {
      expect(loser.statusCode).toBe(423);
      expect(loser.json().error.lockInfo.lockedBy).toBe(h.ids[winners1[0]]);
    }

    // only the winner can save; everyone else is locked out
    const edits = await Promise.all(racers.map((who) => patch(id, who, { version: 1, title: `by ${who}` })));
    expect(edits.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(edits.filter((r) => r.statusCode === 423)).toHaveLength(11);
    const saved = (await ok(h.api('GET', `/api/work-items/${id}`, 'admin'))).data;
    expect(saved.version).toBe(2);
    expect(saved.title).toBe(`by ${winners1[0]}`);

    // release, race again
    await ok(unlock(id, winners1[0]));
    const round2 = await Promise.all(racers.map((who) => lock(id, who)));
    expect(round2.filter((r) => r.statusCode === 200)).toHaveLength(1);

    const entries = await history(id);
    const count = (type: string) => entries.filter((e) => e.type === type).length;
    expect(count('LOCK_ACQUIRED')).toBe(2);
    expect(count('LOCK_RELEASED')).toBe(1);
    expect(count('UPDATED')).toBe(1);
  });

  it('INT-003: replaying the history always reproduces the current item (random edit sequences)', async () => {
    // small deterministic pseudo-random generator so failures are reproducible
    let seed = 20260101;
    const rand = (n: number) => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed % n;
    };
    const pick = <T>(xs: readonly T[]): T => xs[rand(xs.length)];

    for (let run = 0; run < 3; run++) {
      const id = await h.createItem('mo', { title: `Random ${run}` });
      await ok(lock(id, 'mia'));
      let version = 1;
      let status: WorkItemStatus = WorkItemStatus.OPEN;

      for (let step = 0; step < 25; step++) {
        const change: Json = {};
        if (rand(2)) change.title = `title ${rand(1000)}`;
        if (rand(2)) change.description = `description ${rand(1000)}`;
        if (rand(2)) change.priority = pick(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
        if (rand(3) === 0) change.type = pick(['CUSTOMER_ISSUE', 'APPROVAL_TASK', 'COMPLIANCE_REQUEST']);
        if (rand(3) === 0) change.assigneeId = pick([null, h.ids.mo, h.ids.max]);
        if (rand(2)) {
          change.status = pick(allowedTransitions(status));
        }
        if (Object.keys(change).length === 0) change.title = `forced ${step}`;

        const res = await patch(id, 'mia', { version, ...change });
        expect(res.statusCode, res.body).toBe(200);
        version = res.json().data.version;
        status = res.json().data.status;
      }

      // reconstruct from history alone
      const rebuilt: Json = {};
      for (const entry of await history(id)) {
        for (const c of entry.changes) rebuilt[c.field] = c.to;
      }
      const current = (await ok(h.api('GET', `/api/work-items/${id}`, 'admin'))).data;
      for (const field of ['title', 'description', 'type', 'priority', 'status', 'teamId', 'assigneeId']) {
        expect(rebuilt[field], `${field} (run ${run})`).toEqual(current[field]);
      }
      // versions in history match the item's version, one per real change
      const updates = (await history(id)).filter((e) => e.type === 'UPDATED');
      expect(updates.map((e) => e.metadata.version)).toEqual(updates.map((_, i) => i + 2));
      expect(current.version).toBe(updates.length + 1);
    }
  });

  it('INT-004: someone outside the team is refused everywhere and nothing leaks', async () => {
    const id = await h.createItem('mo', { title: 'Strictly alpha only secret' });
    await lock(id, 'mo');
    await h.api('POST', `/api/work-items/${id}/comments`, 'mo', { body: 'secret comment' });
    await settle();

    const attempts: Array<[string, string, Json | undefined]> = [
      ['GET', `/api/work-items/${id}`, undefined],
      ['PATCH', `/api/work-items/${id}`, { version: 1, title: 'x' }],
      ['GET', `/api/work-items/${id}/lock`, undefined],
      ['POST', `/api/work-items/${id}/lock`, undefined],
      ['POST', `/api/work-items/${id}/lock/heartbeat`, undefined],
      ['DELETE', `/api/work-items/${id}/lock`, undefined],
      ['GET', `/api/work-items/${id}/activity`, undefined],
      ['GET', `/api/work-items/${id}/comments`, undefined],
      ['POST', `/api/work-items/${id}/comments`, { body: 'let me in' }],
      ['GET', `/api/teams/${h.teams.alpha}`, undefined],
      ['GET', `/api/teams/${h.teams.alpha}/members`, undefined],
    ];
    for (const who of ['olga', 'nina']) {
      for (const [method, url, payload] of attempts) {
        const res = await h.api(method as 'GET', url, who, payload);
        expect(res.statusCode, `${who} ${method} ${url}`).toBe(403);
      }
      // searches, lists, dashboard and inbox contain nothing from alpha
      const search = await ok(h.api('GET', '/api/work-items?search=secret&pageSize=100', who));
      expect(search.data).toEqual([]);
      const dash = JSON.stringify((await ok(h.api('GET', '/api/dashboard', who))).data);
      expect(dash).not.toContain(id);
      expect(dash).not.toContain('secret');
      const inbox = JSON.stringify((await ok(h.api('GET', '/api/notifications', who))).data);
      expect(inbox).not.toContain('secret');
    }
  });

  it('INT-005: removing someone from a team cuts off all their access at once', async () => {
    const id = await h.createItem('max', { title: 'Max holds this' });
    await ok(lock(id, 'max'));
    await ok(h.api('POST', `/api/work-items/${id}/comments`, 'max', { body: 'before removal' }), 201);

    await ok(h.api('DELETE', `/api/teams/${h.teams.alpha}/members/${h.ids.max}`, 'mia'));

    for (const [method, url, payload] of [
      ['GET', `/api/work-items/${id}`, undefined],
      ['PATCH', `/api/work-items/${id}`, { version: 1, title: 'still here?' }],
      ['POST', `/api/work-items/${id}/lock/heartbeat`, undefined],
      ['GET', `/api/work-items/${id}/comments`, undefined],
      ['POST', `/api/work-items/${id}/comments`, { body: 'after removal' }],
    ] as Array<[string, string, Json | undefined]>) {
      const res = await h.api(method as 'GET', url, 'max', payload);
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
    const list = await ok(h.api('GET', '/api/work-items?search=holds%20this', 'max'));
    expect(list.data).toEqual([]);

    // their lock does not strand the item: a manager clears it and someone else takes over
    await ok(unlock(id, 'mia'));
    await ok(lock(id, 'mo'));
  });

  it('INT-006: every response uses the standard envelope — successes and failures alike', async () => {
    const id = await h.createItem('mo');
    const requests: Array<[string, string, string, Json | undefined]> = [
      ['GET', '/api/health', 'mo', undefined],
      ['GET', '/api/users/me', 'mo', undefined],
      ['GET', '/api/teams', 'mo', undefined],
      ['GET', '/api/work-items', 'mo', undefined],
      ['GET', `/api/work-items/${id}`, 'mo', undefined],
      ['GET', '/api/dashboard', 'mo', undefined],
      ['GET', '/api/notifications', 'mo', undefined],
      ['GET', `/api/work-items/${UNKNOWN_ID}`, 'mo', undefined], // 404
      ['GET', `/api/work-items/${id}`, 'olga', undefined], // 403
      ['POST', '/api/work-items', 'mo', { title: '' }], // 400
      ['PATCH', `/api/work-items/${id}`, 'mo', { version: 1, title: 'x' }], // 409 lock required
      ['GET', '/api/work-items?status=NOPE', 'mo', undefined], // 400
      ['GET', '/api/nothing-here', 'mo', undefined], // 404 route
    ];
    for (const [method, url, who, payload] of requests) {
      const res = await h.api(method as 'GET', url, who, payload);
      const body = res.json();
      expect(typeof body.success, `${method} ${url}`).toBe('boolean');
      expect(res.headers['content-type']).toContain('application/json');
      if (body.success) {
        expect(body).toHaveProperty('data');
        expect(body).not.toHaveProperty('error');
      } else {
        expect(res.statusCode).toBeGreaterThanOrEqual(400);
        expect(typeof body.error.code).toBe('string');
        expect(typeof body.error.message).toBe('string');
        expect(JSON.stringify(body)).not.toMatch(/stack|node_modules|at .*\(.*:\d+:\d+\)/);
      }
    }
  });

  it('INT-007: many simultaneous creations stay consistent across list, dashboard and history', async () => {
    const before = (await ok(h.api('GET', '/api/dashboard', 'mia'))).data.counts.total;
    const results = await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        h.api('POST', '/api/work-items', i % 2 ? 'mo' : 'mia', {
          title: `Burst ${i}`,
          type: 'CUSTOMER_ISSUE',
          teamId: h.teams.alpha,
        }),
      ),
    );
    expect(results.every((r) => r.statusCode === 201)).toBe(true);

    const created = results.map((r) => r.json().data as Json);
    expect(new Set(created.map((i) => i.key)).size).toBe(25);
    expect(new Set(created.map((i) => i.id)).size).toBe(25);

    const list = await ok(h.api('GET', `/api/work-items?teamId=${h.teams.alpha}&search=Burst&pageSize=100`, 'mia'));
    expect(list.meta.totalCount).toBe(25);
    expect((await ok(h.api('GET', '/api/dashboard', 'mia'))).data.counts.total).toBe(before + 25);

    for (const item of created.slice(0, 5)) {
      const entries = await history(item.id);
      expect(entries.map((e) => [e.type, e.sequence])).toEqual([['CREATED', 1]]);
    }
  });

  it('INT-008: background work never leaves anything half-done after a full run', async () => {
    await settle();
    expect(h.container.jobQueue.failedJobs()).toEqual([]);
  });
});
