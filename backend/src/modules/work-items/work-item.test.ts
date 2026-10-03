import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../app';
import { createTestConfig } from '../../config';
import { AppContainer, createContainer } from '../../container';
import { TeamRole } from '../../shared/types/auth';

const PASSWORD = 'a-long-test-password';
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

describe('Work items – CRUD, workflow, authorization, concurrency', () => {
  const config = createTestConfig();
  let app: FastifyInstance;
  let container: AppContainer;

  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const teams: Record<string, string> = {};

  const as = (who: string) => ({ authorization: `Bearer ${tokens[who]}` });

  const ITEM_URL = /^\/api\/work-items\/[^/]+$/;

  /**
   * Thin wrapper over app.inject. Editing a work item requires holding its lock,
   * so a PATCH first takes the lock for `who` (an admin force-releases anyone
   * else's lock). Lock behaviour itself is tested in work-item-lock.test.ts;
   * the lock responses are deliberately ignored here so the PATCH result is what
   * the tests assert on (e.g. a non-member's PATCH still fails on its own merits).
   */
  async function api(
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    who: string,
    payload?: Record<string, unknown>,
  ) {
    if (method === 'PATCH' && ITEM_URL.test(url)) {
      await app.inject({ method: 'DELETE', url: `${url}/lock`, headers: as('admin') });
      await app.inject({ method: 'POST', url: `${url}/lock`, headers: as(who) });
    }
    return app.inject({ method, url, headers: as(who), payload });
  }

  /** Create a work item through the API and return its body. */
  async function createItem(
    who: string,
    overrides: Record<string, unknown> = {},
  ): Promise<Record<string, any>> {
    const response = await api('POST', '/api/work-items', who, {
      title: 'Customer cannot log in',
      type: 'CUSTOMER_ISSUE',
      teamId: teams.alpha,
      ...overrides,
    });
    expect(response.statusCode).toBe(201);
    return response.json().data;
  }

  beforeAll(async () => {
    container = createContainer(config);

    const people: Array<[string, 'ADMIN' | 'USER']> = [
      ['admin', 'ADMIN'],
      ['mia', 'USER'], // alpha manager
      ['mo', 'USER'], // alpha member
      ['max', 'USER'], // alpha member
      ['olga', 'USER'], // beta manager (outsider to alpha)
      ['nina', 'USER'], // belongs to no team
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

    const seedTeam = async (key: string, name: string, members: Array<[string, TeamRole]>) => {
      const team = await container.teamRepository.create({ name });
      teams[key] = team.id;
      for (const [who, role] of members) {
        await container.teamRepository.addMember(team.id, ids[who], role);
      }
    };
    await seedTeam('alpha', 'Alpha', [
      ['mia', TeamRole.MANAGER],
      ['mo', TeamRole.MEMBER],
      ['max', TeamRole.MEMBER],
    ]);
    await seedTeam('beta', 'Beta', [['olga', TeamRole.MANAGER]]);
    await seedTeam('gamma', 'Gamma', [
      ['mia', TeamRole.MANAGER],
      ['mo', TeamRole.MEMBER],
    ]); // reserved for list tests so counts are deterministic

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

  describe('creating', () => {
    it('WI-001: endpoints require authentication', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/work-items' });
      expect(response.statusCode).toBe(401);
    });

    it('WI-002: a team member creates an item with sensible defaults', async () => {
      const item = await createItem('mo', { description: 'Reset email never arrives' });

      expect(item).toMatchObject({
        title: 'Customer cannot log in',
        description: 'Reset email never arrives',
        type: 'CUSTOMER_ISSUE',
        status: 'OPEN',
        priority: 'MEDIUM',
        teamId: teams.alpha,
        createdBy: ids.mo,
        assigneeId: null,
        version: 1,
      });
      expect(item.id).toBeTruthy();
    });

    it('WI-003: a non-member cannot create an item in the team', async () => {
      const response = await api('POST', '/api/work-items', 'olga', {
        title: 'Sneaky',
        type: 'APPROVAL_TASK',
        teamId: teams.alpha,
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe('NOT_TEAM_MEMBER');
    });

    it('WI-004: creating in an unknown team is 404', async () => {
      const response = await api('POST', '/api/work-items', 'admin', {
        title: 'Orphan',
        type: 'APPROVAL_TASK',
        teamId: UNKNOWN_ID,
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('TEAM_NOT_FOUND');
    });

    it('WI-005: create validates its input', async () => {
      const base = { title: 'ok', type: 'CUSTOMER_ISSUE', teamId: teams.alpha };
      for (const bad of [
        { ...base, title: '   ' },
        { ...base, title: 'x'.repeat(201) },
        { ...base, type: 'NOT_A_TYPE' },
        { ...base, priority: 'URGENT' },
        { ...base, teamId: 'not-a-uuid' },
      ]) {
        const response = await api('POST', '/api/work-items', 'mo', bad);
        expect(response.statusCode).toBe(400);
        expect(response.json().error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('WI-006: only a manager can set the assignee at creation, and it must be a team member', async () => {
      const denied = await api('POST', '/api/work-items', 'mo', {
        title: 'Assigned',
        type: 'ENGINEERING_PROBLEM',
        teamId: teams.alpha,
        assigneeId: ids.max,
      });
      expect(denied.statusCode).toBe(403);
      expect(denied.json().error.code).toBe('TEAM_MANAGER_REQUIRED');

      const item = await createItem('mia', { assigneeId: ids.max });
      expect(item.assigneeId).toBe(ids.max);

      const outsider = await api('POST', '/api/work-items', 'mia', {
        title: 'Bad assignee',
        type: 'ENGINEERING_PROBLEM',
        teamId: teams.alpha,
        assigneeId: ids.olga,
      });
      expect(outsider.statusCode).toBe(422);
      expect(outsider.json().error.code).toBe('ASSIGNEE_NOT_TEAM_MEMBER');
    });
  });

  describe('reading', () => {
    it('WI-007: members and admins can get an item; outsiders cannot', async () => {
      const item = await createItem('mo');

      expect((await api('GET', `/api/work-items/${item.id}`, 'max')).statusCode).toBe(200);
      expect((await api('GET', `/api/work-items/${item.id}`, 'admin')).statusCode).toBe(200);

      const outsider = await api('GET', `/api/work-items/${item.id}`, 'olga');
      expect(outsider.statusCode).toBe(403);
      expect(outsider.json().error.code).toBe('NOT_TEAM_MEMBER');
    });

    it('WI-008: unknown item is 404 and a malformed id is 400', async () => {
      const missing = await api('GET', `/api/work-items/${UNKNOWN_ID}`, 'admin');
      expect(missing.statusCode).toBe(404);
      expect(missing.json().error.code).toBe('WORK_ITEM_NOT_FOUND');

      expect((await api('GET', '/api/work-items/nope', 'admin')).statusCode).toBe(400);
    });
  });

  describe('updating', () => {
    it('WI-009: a member edits content; version and updatedAt advance', async () => {
      const item = await createItem('mo');
      await new Promise((resolve) => setTimeout(resolve, 5));

      const response = await api('PATCH', `/api/work-items/${item.id}`, 'max', {
        version: 1,
        title: 'Login broken for SSO users',
        priority: 'HIGH',
        description: 'Affects all SSO tenants',
      });
      const updated = response.json().data;

      expect(response.statusCode).toBe(200);
      expect(updated).toMatchObject({
        title: 'Login broken for SSO users',
        priority: 'HIGH',
        description: 'Affects all SSO tenants',
        version: 2,
      });
      expect(new Date(updated.updatedAt).getTime()).toBeGreaterThan(
        new Date(item.updatedAt).getTime(),
      );
      expect(updated.createdBy).toBe(ids.mo); // immutable
    });

    it('WI-010: re-sending identical values is a no-op and does not bump the version', async () => {
      const item = await createItem('mo');
      const response = await api('PATCH', `/api/work-items/${item.id}`, 'mo', {
        version: 1,
        title: item.title,
        priority: item.priority,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data.version).toBe(1);
    });

    it('WI-011: update requires a version and at least one field', async () => {
      const item = await createItem('mo');

      const noFields = await api('PATCH', `/api/work-items/${item.id}`, 'mo', { version: 1 });
      expect(noFields.statusCode).toBe(400);

      const noVersion = await api('PATCH', `/api/work-items/${item.id}`, 'mo', { title: 'x' });
      expect(noVersion.statusCode).toBe(400);

      const blankTitle = await api('PATCH', `/api/work-items/${item.id}`, 'mo', {
        version: 1,
        title: '  ',
      });
      expect(blankTitle.statusCode).toBe(400);
    });

    it('WI-012: a stale version is rejected with 409 and nothing changes', async () => {
      const item = await createItem('mo');
      await api('PATCH', `/api/work-items/${item.id}`, 'mo', { version: 1, priority: 'LOW' });

      const stale = await api('PATCH', `/api/work-items/${item.id}`, 'max', {
        version: 1,
        title: 'Overwrites mo?',
      });
      expect(stale.statusCode).toBe(409);
      expect(stale.json().error.code).toBe('VERSION_CONFLICT');

      const current = (await api('GET', `/api/work-items/${item.id}`, 'mo')).json().data;
      expect(current).toMatchObject({ title: item.title, priority: 'LOW', version: 2 });
    });

    it('WI-013: the repository compare-and-set lets exactly one of two racing writers win', async () => {
      const item = await createItem('mo');
      const [a, b] = await Promise.all([
        container.workItemRepository.update(item.id, 1, { title: 'Writer A' }),
        container.workItemRepository.update(item.id, 1, { title: 'Writer B' }),
      ]);

      expect([a, b].filter((r) => r !== null)).toHaveLength(1);
      const current = await container.workItemRepository.findById(item.id);
      expect(current!.version).toBe(2);
      expect(current!.title).toBe((a ?? b)!.title);
    });

    it('WI-014: outsiders cannot update, and the team cannot be changed', async () => {
      const item = await createItem('mo');

      const outsider = await api('PATCH', `/api/work-items/${item.id}`, 'olga', {
        version: 1,
        title: 'Hijacked',
      });
      expect(outsider.statusCode).toBe(403);

      // teamId is not an updatable field: it is ignored, leaving nothing to update
      const move = await api('PATCH', `/api/work-items/${item.id}`, 'mo', {
        version: 1,
        teamId: teams.beta,
      });
      expect(move.statusCode).toBe(400);
      expect((await api('GET', `/api/work-items/${item.id}`, 'mo')).json().data.teamId).toBe(
        teams.alpha,
      );
    });

    it('WI-015: updating an unknown item is 404', async () => {
      const response = await api('PATCH', `/api/work-items/${UNKNOWN_ID}`, 'admin', {
        version: 1,
        title: 'x',
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('workflow', () => {
    it('WI-016: a member walks an item through the normal workflow', async () => {
      const item = await createItem('mo');
      let version = 1;

      for (const status of ['IN_PROGRESS', 'BLOCKED', 'IN_PROGRESS', 'IN_REVIEW', 'RESOLVED']) {
        const response = await api('PATCH', `/api/work-items/${item.id}`, 'mo', {
          version,
          status,
        });
        expect(response.statusCode).toBe(200);
        expect(response.json().data.status).toBe(status);
        version = response.json().data.version;
      }
      expect(version).toBe(6);
    });

    it('WI-017: invalid transitions are rejected with 422 and the allowed options', async () => {
      const item = await createItem('mo');
      const response = await api('PATCH', `/api/work-items/${item.id}`, 'mia', {
        version: 1,
        status: 'RESOLVED',
      });

      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe('INVALID_STATUS_TRANSITION');
      expect(response.json().error.message).toContain('IN_PROGRESS');
    });

    it('WI-018: closing and reopening a closed item need a manager', async () => {
      const item = await createItem('mo');
      let version = 1;
      const move = async (who: string, status: string) => {
        const response = await api('PATCH', `/api/work-items/${item.id}`, who, { version, status });
        if (response.statusCode === 200) version = response.json().data.version;
        return response;
      };

      expect((await move('mo', 'IN_PROGRESS')).statusCode).toBe(200);
      expect((await move('mo', 'RESOLVED')).statusCode).toBe(200);

      const memberClose = await move('mo', 'CLOSED');
      expect(memberClose.statusCode).toBe(403);
      expect(memberClose.json().error.code).toBe('TEAM_MANAGER_REQUIRED');

      expect((await move('mia', 'CLOSED')).statusCode).toBe(200);
      expect((await move('mo', 'OPEN')).statusCode).toBe(403);
      expect((await move('mia', 'OPEN')).statusCode).toBe(200);
    });

    it('WI-019: an invalid transition is reported even for a manager before any change', async () => {
      const item = await createItem('mo');
      await api('PATCH', `/api/work-items/${item.id}`, 'mia', { version: 1, status: 'CLOSED' });

      // CLOSED -> IN_PROGRESS is not allowed, only CLOSED -> OPEN
      const response = await api('PATCH', `/api/work-items/${item.id}`, 'mia', {
        version: 2,
        status: 'IN_PROGRESS',
      });
      expect(response.statusCode).toBe(422);
    });
  });

  describe('assignment', () => {
    it('WI-020: only a manager can assign, unassign or reassign', async () => {
      const item = await createItem('mo');

      const denied = await api('PATCH', `/api/work-items/${item.id}`, 'mo', {
        version: 1,
        assigneeId: ids.mo,
      });
      expect(denied.statusCode).toBe(403);
      expect(denied.json().error.code).toBe('TEAM_MANAGER_REQUIRED');

      const assigned = await api('PATCH', `/api/work-items/${item.id}`, 'mia', {
        version: 1,
        assigneeId: ids.mo,
      });
      expect(assigned.statusCode).toBe(200);
      expect(assigned.json().data.assigneeId).toBe(ids.mo);

      const unassigned = await api('PATCH', `/api/work-items/${item.id}`, 'mia', {
        version: 2,
        assigneeId: null,
      });
      expect(unassigned.statusCode).toBe(200);
      expect(unassigned.json().data.assigneeId).toBeNull();
    });

    it('WI-021: the assignee must belong to the item\'s team', async () => {
      const item = await createItem('mo');
      const response = await api('PATCH', `/api/work-items/${item.id}`, 'mia', {
        version: 1,
        assigneeId: ids.olga,
      });

      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe('ASSIGNEE_NOT_TEAM_MEMBER');
    });

    it('WI-022: a failed manager-only change does not apply the member-level changes in the same request', async () => {
      const item = await createItem('mo');
      const response = await api('PATCH', `/api/work-items/${item.id}`, 'mo', {
        version: 1,
        title: 'Sneaky rename',
        assigneeId: ids.mo,
      });
      expect(response.statusCode).toBe(403);

      const current = (await api('GET', `/api/work-items/${item.id}`, 'mo')).json().data;
      expect(current).toMatchObject({ title: item.title, assigneeId: null, version: 1 });
    });
  });

  describe('listing', () => {
    let gammaIds: Record<string, string>;

    beforeAll(async () => {
      const low = await createItem('mo', {
        teamId: teams.gamma,
        title: 'low old',
        priority: 'LOW',
        type: 'COMPLIANCE_REQUEST',
      });
      await new Promise((resolve) => setTimeout(resolve, 5));
      const crit = await createItem('mo', {
        teamId: teams.gamma,
        title: 'critical',
        priority: 'CRITICAL',
        type: 'PRODUCTION_INCIDENT',
      });
      await new Promise((resolve) => setTimeout(resolve, 5));
      const med = await createItem('mia', {
        teamId: teams.gamma,
        title: 'medium assigned',
        type: 'PAYMENT_INVESTIGATION',
        assigneeId: ids.mo,
      });
      await api('PATCH', `/api/work-items/${crit.id}`, 'mo', { version: 1, status: 'IN_PROGRESS' });
      gammaIds = { low: low.id, crit: crit.id, med: med.id };
    });

    const titles = (response: { json(): any }) =>
      (response.json().data as Array<{ title: string }>).map((i) => i.title);

    it('WI-023: a user sees only items from teams they belong to', async () => {
      const response = await api('GET', '/api/work-items?pageSize=100', 'olga');
      const teamIds = new Set(
        (response.json().data as Array<{ teamId: string }>).map((i) => i.teamId),
      );

      expect(response.statusCode).toBe(200);
      expect(teamIds.has(teams.alpha)).toBe(false);
      expect(teamIds.has(teams.gamma)).toBe(false);
    });

    it('WI-024: a user with no teams gets an empty page; admin sees every team', async () => {
      const none = await api('GET', '/api/work-items', 'nina');
      expect(none.json().data).toEqual([]);
      expect(none.json().meta.totalCount).toBe(0);

      const all = await api('GET', '/api/work-items?pageSize=100', 'admin');
      const teamIds = new Set(
        (all.json().data as Array<{ teamId: string }>).map((i) => i.teamId),
      );
      expect(teamIds.has(teams.alpha)).toBe(true);
      expect(teamIds.has(teams.gamma)).toBe(true);
    });

    it('WI-025: filtering by team requires membership', async () => {
      const denied = await api('GET', `/api/work-items?teamId=${teams.gamma}`, 'olga');
      expect(denied.statusCode).toBe(403);

      const ok = await api('GET', `/api/work-items?teamId=${teams.gamma}`, 'mo');
      expect(ok.statusCode).toBe(200);
      expect(ok.json().meta.totalCount).toBe(3);
    });

    it('WI-026: filters by status, type, priority and assignee', async () => {
      const base = `/api/work-items?teamId=${teams.gamma}`;

      expect(titles(await api('GET', `${base}&status=IN_PROGRESS`, 'mo'))).toEqual(['critical']);
      expect(titles(await api('GET', `${base}&type=COMPLIANCE_REQUEST`, 'mo'))).toEqual(['low old']);
      expect(titles(await api('GET', `${base}&priority=MEDIUM`, 'mo'))).toEqual(['medium assigned']);
      expect(titles(await api('GET', `${base}&assigneeId=${ids.mo}`, 'mo'))).toEqual([
        'medium assigned',
      ]);
      expect((await api('GET', `${base}&status=BOGUS`, 'mo')).statusCode).toBe(400);
    });

    it('WI-027: sorts by priority and by creation time in both directions', async () => {
      const base = `/api/work-items?teamId=${teams.gamma}`;

      expect(titles(await api('GET', `${base}&sortBy=priority&sortOrder=desc`, 'mo'))).toEqual([
        'critical',
        'medium assigned',
        'low old',
      ]);
      expect(titles(await api('GET', `${base}&sortBy=createdAt&sortOrder=asc`, 'mo'))).toEqual([
        'low old',
        'critical',
        'medium assigned',
      ]);
      // default: most recently updated first (critical was updated last)
      expect((await api('GET', base, 'mo')).json().data[0].id).toBe(gammaIds.crit);
      expect((await api('GET', `${base}&sortBy=title`, 'mo')).statusCode).toBe(400);
    });

    it('WI-028: results are paginated with correct metadata', async () => {
      const base = `/api/work-items?teamId=${teams.gamma}&sortBy=createdAt&sortOrder=asc`;
      const first = await api('GET', `${base}&page=1&pageSize=2`, 'mo');
      const second = await api('GET', `${base}&page=2&pageSize=2`, 'mo');

      expect(titles(first)).toEqual(['low old', 'critical']);
      expect(first.json().meta).toMatchObject({
        page: 1,
        pageSize: 2,
        totalCount: 3,
        totalPages: 2,
        hasNext: true,
        hasPrev: false,
      });
      expect(titles(second)).toEqual(['medium assigned']);
      expect(second.json().meta).toMatchObject({ hasNext: false, hasPrev: true });

      expect((await api('GET', `${base}&pageSize=101`, 'mo')).statusCode).toBe(400);
    });
  });
});
