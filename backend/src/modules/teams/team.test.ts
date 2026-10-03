import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../app';
import { createTestConfig } from '../../config';
import { createContainer } from '../../container';

const PASSWORD = 'a-long-test-password';
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

describe('Teams – roles and authorization', () => {
  const config = createTestConfig();
  let app: FastifyInstance;

  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};

  const as = (who: string) => ({ authorization: `Bearer ${tokens[who]}` });

  async function api(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    who: string,
    payload?: Record<string, unknown>,
  ) {
    return app.inject({ method, url, headers: as(who), payload });
  }

  /** Create a team through the API as admin, with `alice` as manager and `bob` as member. */
  async function seedTeam(name: string): Promise<string> {
    const created = await api('POST', '/api/teams', 'admin', { name, managerId: ids.alice });
    expect(created.statusCode).toBe(201);
    const teamId = created.json().data.id as string;
    const added = await api('POST', `/api/teams/${teamId}/members`, 'alice', { userId: ids.bob });
    expect(added.statusCode).toBe(201);
    return teamId;
  }

  beforeAll(async () => {
    const container = createContainer(config);
    const people: Array<[string, 'ADMIN' | 'USER']> = [
      ['admin', 'ADMIN'],
      ['alice', 'USER'], // team manager
      ['bob', 'USER'], // team member
      ['carol', 'USER'], // outsider
      ['dave', 'USER'], // outsider, target for add-member
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

  describe('creating teams', () => {
    it('TEAM-001: endpoints require authentication', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/teams' });
      expect(response.statusCode).toBe(401);
    });

    it('TEAM-002: admin creates a team with an initial manager', async () => {
      const created = await api('POST', '/api/teams', 'admin', {
        name: 'Engineering',
        description: 'Builds things',
        managerId: ids.alice,
      });
      const body = created.json();

      expect(created.statusCode).toBe(201);
      expect(body.data).toMatchObject({ name: 'Engineering', description: 'Builds things' });
      expect(body.data.myRole).toBeNull(); // admin is not a member

      const members = await api('GET', `/api/teams/${body.data.id}/members`, 'admin');
      expect(members.json().data).toHaveLength(1);
      expect(members.json().data[0]).toMatchObject({ userId: ids.alice, role: 'MANAGER' });
    });

    it('TEAM-003: a non-admin cannot create a team', async () => {
      const response = await api('POST', '/api/teams', 'alice', { name: 'Rogue' });

      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe('ADMIN_REQUIRED');
    });

    it('TEAM-004: duplicate team names are rejected case-insensitively', async () => {
      await api('POST', '/api/teams', 'admin', { name: 'Support' });
      const response = await api('POST', '/api/teams', 'admin', { name: 'SUPPORT' });

      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe('TEAM_NAME_TAKEN');
    });

    it('TEAM-005: create validates input and the manager must exist', async () => {
      const blank = await api('POST', '/api/teams', 'admin', { name: '   ' });
      expect(blank.statusCode).toBe(400);
      expect(blank.json().error.code).toBe('VALIDATION_ERROR');

      const ghost = await api('POST', '/api/teams', 'admin', {
        name: 'Ghost Manager Team',
        managerId: UNKNOWN_ID,
      });
      expect(ghost.statusCode).toBe(404);
      expect(ghost.json().error.code).toBe('USER_NOT_FOUND');

      // The failed create must not have left a team behind
      const retry = await api('POST', '/api/teams', 'admin', { name: 'Ghost Manager Team' });
      expect(retry.statusCode).toBe(201);
    });
  });

  describe('reading teams', () => {
    let teamId: string;
    let otherTeamId: string;

    beforeAll(async () => {
      teamId = await seedTeam('Read Team');
      const other = await api('POST', '/api/teams', 'admin', { name: 'Read Other Team' });
      otherTeamId = other.json().data.id;
    });

    it('TEAM-006: a user lists only the teams they belong to, with their role', async () => {
      const response = await api('GET', '/api/teams', 'bob');
      const teams = response.json().data as Array<{ id: string; myRole: string }>;

      expect(response.statusCode).toBe(200);
      expect(teams.map((t) => t.id)).toContain(teamId);
      expect(teams.map((t) => t.id)).not.toContain(otherTeamId);
      expect(teams.find((t) => t.id === teamId)!.myRole).toBe('MEMBER');
    });

    it('TEAM-007: a user with no teams gets an empty list', async () => {
      const response = await api('GET', '/api/teams', 'carol');

      expect(response.statusCode).toBe(200);
      expect(response.json().data).toEqual([]);
      expect(response.json().meta.totalCount).toBe(0);
    });

    it('TEAM-008: admin lists every team', async () => {
      const response = await api('GET', '/api/teams?pageSize=100', 'admin');
      const ids = (response.json().data as Array<{ id: string }>).map((t) => t.id);

      expect(ids).toContain(teamId);
      expect(ids).toContain(otherTeamId);
    });

    it('TEAM-009: team list is paginated', async () => {
      const first = await api('GET', '/api/teams?page=1&pageSize=2', 'admin');
      const body = first.json();

      expect(body.data).toHaveLength(2);
      expect(body.meta).toMatchObject({ page: 1, pageSize: 2, hasPrev: false, hasNext: true });
      expect(body.meta.totalPages).toBe(Math.ceil(body.meta.totalCount / 2));

      const bad = await api('GET', '/api/teams?pageSize=1000', 'admin');
      expect(bad.statusCode).toBe(400);
    });

    it('TEAM-010: members and admins can get a team; outsiders cannot', async () => {
      const asMember = await api('GET', `/api/teams/${teamId}`, 'bob');
      expect(asMember.statusCode).toBe(200);
      expect(asMember.json().data).toMatchObject({ id: teamId, myRole: 'MEMBER' });

      const asManager = await api('GET', `/api/teams/${teamId}`, 'alice');
      expect(asManager.json().data.myRole).toBe('MANAGER');

      expect((await api('GET', `/api/teams/${teamId}`, 'admin')).statusCode).toBe(200);

      const outsider = await api('GET', `/api/teams/${teamId}`, 'carol');
      expect(outsider.statusCode).toBe(403);
      expect(outsider.json().error.code).toBe('NOT_TEAM_MEMBER');
    });

    it('TEAM-011: unknown team is 404 and a malformed id is 400', async () => {
      const missing = await api('GET', `/api/teams/${UNKNOWN_ID}`, 'admin');
      expect(missing.statusCode).toBe(404);
      expect(missing.json().error.code).toBe('TEAM_NOT_FOUND');

      const malformed = await api('GET', '/api/teams/not-a-uuid', 'admin');
      expect(malformed.statusCode).toBe(400);
    });

    it('TEAM-012: member list shows names and roles but never password data', async () => {
      const response = await api('GET', `/api/teams/${teamId}/members`, 'bob');
      const members = response.json().data as Array<Record<string, unknown>>;

      expect(response.statusCode).toBe(200);
      expect(members.map((m) => m.name)).toEqual(['alice', 'bob']);
      expect(members.find((m) => m.name === 'alice')).toMatchObject({
        email: 'alice@example.com',
        role: 'MANAGER',
      });
      expect(JSON.stringify(response.json())).not.toMatch(/password/i);
    });

    it('TEAM-013: outsiders cannot list members', async () => {
      const response = await api('GET', `/api/teams/${teamId}/members`, 'carol');
      expect(response.statusCode).toBe(403);
    });
  });

  describe('managing members', () => {
    it('TEAM-014: a manager adds a member, defaulting to the MEMBER role', async () => {
      const teamId = await seedTeam('Add Team');
      const response = await api('POST', `/api/teams/${teamId}/members`, 'alice', {
        userId: ids.dave,
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().data).toMatchObject({ userId: ids.dave, role: 'MEMBER' });
      expect((await api('GET', `/api/teams/${teamId}`, 'dave')).statusCode).toBe(200);
    });

    it('TEAM-015: a plain member cannot add members', async () => {
      const teamId = await seedTeam('Add Denied Team');
      const response = await api('POST', `/api/teams/${teamId}/members`, 'bob', {
        userId: ids.dave,
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe('TEAM_MANAGER_REQUIRED');
    });

    it('TEAM-016: a manager of another team has no rights here', async () => {
      const teamId = await seedTeam('Isolated Team');
      const other = await api('POST', '/api/teams', 'admin', {
        name: 'Isolated Other Team',
        managerId: ids.carol,
      });
      expect(other.statusCode).toBe(201);

      const response = await api('POST', `/api/teams/${teamId}/members`, 'carol', {
        userId: ids.dave,
      });
      expect(response.statusCode).toBe(403);
    });

    it('TEAM-017: admin can manage a team they do not belong to', async () => {
      const teamId = await seedTeam('Admin Managed Team');
      const response = await api('POST', `/api/teams/${teamId}/members`, 'admin', {
        userId: ids.dave,
        role: 'MANAGER',
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().data.role).toBe('MANAGER');
    });

    it('TEAM-018: adding a duplicate or unknown user is rejected', async () => {
      const teamId = await seedTeam('Add Errors Team');

      const duplicate = await api('POST', `/api/teams/${teamId}/members`, 'alice', {
        userId: ids.bob,
      });
      expect(duplicate.statusCode).toBe(409);
      expect(duplicate.json().error.code).toBe('ALREADY_TEAM_MEMBER');

      const unknown = await api('POST', `/api/teams/${teamId}/members`, 'alice', {
        userId: UNKNOWN_ID,
      });
      expect(unknown.statusCode).toBe(404);
      expect(unknown.json().error.code).toBe('USER_NOT_FOUND');

      const badRole = await api('POST', `/api/teams/${teamId}/members`, 'alice', {
        userId: ids.dave,
        role: 'OWNER',
      });
      expect(badRole.statusCode).toBe(400);
    });

    it('TEAM-019: a manager changes a member role; a member cannot', async () => {
      const teamId = await seedTeam('Role Team');

      const denied = await api('PATCH', `/api/teams/${teamId}/members/${ids.bob}`, 'bob', {
        role: 'MANAGER',
      });
      expect(denied.statusCode).toBe(403);

      const promoted = await api('PATCH', `/api/teams/${teamId}/members/${ids.bob}`, 'alice', {
        role: 'MANAGER',
      });
      expect(promoted.statusCode).toBe(200);
      expect(promoted.json().data.role).toBe('MANAGER');

      // bob now has manager powers
      const added = await api('POST', `/api/teams/${teamId}/members`, 'bob', { userId: ids.dave });
      expect(added.statusCode).toBe(201);
    });

    it('TEAM-020: changing the role of a non-member is 404', async () => {
      const teamId = await seedTeam('Role Missing Team');
      const response = await api('PATCH', `/api/teams/${teamId}/members/${ids.dave}`, 'alice', {
        role: 'MANAGER',
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('MEMBER_NOT_FOUND');
    });

    it('TEAM-021: the last manager cannot be demoted or removed', async () => {
      const teamId = await seedTeam('Last Manager Team');

      const demote = await api('PATCH', `/api/teams/${teamId}/members/${ids.alice}`, 'alice', {
        role: 'MEMBER',
      });
      expect(demote.statusCode).toBe(422);
      expect(demote.json().error.code).toBe('TEAM_REQUIRES_MANAGER');

      const remove = await api('DELETE', `/api/teams/${teamId}/members/${ids.alice}`, 'admin');
      expect(remove.statusCode).toBe(422);
      expect(remove.json().error.code).toBe('TEAM_REQUIRES_MANAGER');
    });

    it('TEAM-022: a manager can step down once another manager exists', async () => {
      const teamId = await seedTeam('Step Down Team');
      await api('PATCH', `/api/teams/${teamId}/members/${ids.bob}`, 'alice', { role: 'MANAGER' });

      const stepDown = await api('DELETE', `/api/teams/${teamId}/members/${ids.alice}`, 'alice');
      expect(stepDown.statusCode).toBe(200);

      const members = await api('GET', `/api/teams/${teamId}/members`, 'bob');
      expect(members.json().data).toHaveLength(1);
      expect(members.json().data[0]).toMatchObject({ userId: ids.bob, role: 'MANAGER' });
    });

    it('TEAM-023: a removed member loses access immediately', async () => {
      const teamId = await seedTeam('Remove Team');
      expect((await api('GET', `/api/teams/${teamId}`, 'bob')).statusCode).toBe(200);

      const removed = await api('DELETE', `/api/teams/${teamId}/members/${ids.bob}`, 'alice');
      expect(removed.statusCode).toBe(200);

      const after = await api('GET', `/api/teams/${teamId}`, 'bob');
      expect(after.statusCode).toBe(403);
    });

    it('TEAM-024: a member cannot remove others; removing a non-member is 404', async () => {
      const teamId = await seedTeam('Remove Denied Team');

      const denied = await api('DELETE', `/api/teams/${teamId}/members/${ids.alice}`, 'bob');
      expect(denied.statusCode).toBe(403);

      const missing = await api('DELETE', `/api/teams/${teamId}/members/${ids.dave}`, 'alice');
      expect(missing.statusCode).toBe(404);
      expect(missing.json().error.code).toBe('MEMBER_NOT_FOUND');
    });
  });
});
