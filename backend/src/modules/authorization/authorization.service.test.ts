import { describe, it, expect } from 'vitest';
import { AuthorizationService, MembershipLookup } from './authorization.service';
import { ForbiddenError } from '../../shared/errors/index';
import { AuthenticatedUser, GlobalRole, TeamRole } from '../../shared/types/auth';

function lookup(roles: Record<string, TeamRole>): MembershipLookup {
  return {
    async findMember(teamId, userId) {
      const role = roles[`${teamId}:${userId}`];
      return role ? { role } : null;
    },
  };
}

const admin: AuthenticatedUser = { id: 'admin', email: 'admin@x.com', role: GlobalRole.ADMIN };
const manager: AuthenticatedUser = { id: 'mgr', email: 'mgr@x.com', role: GlobalRole.USER };
const member: AuthenticatedUser = { id: 'mem', email: 'mem@x.com', role: GlobalRole.USER };
const outsider: AuthenticatedUser = { id: 'out', email: 'out@x.com', role: GlobalRole.USER };

const authz = new AuthorizationService(
  lookup({ 't1:mgr': TeamRole.MANAGER, 't1:mem': TeamRole.MEMBER }),
);

describe('AuthorizationService', () => {
  it('AUTHZ-001: isAdmin is true only for the global ADMIN role', () => {
    expect(authz.isAdmin(admin)).toBe(true);
    expect(authz.isAdmin(manager)).toBe(false);
  });

  it('AUTHZ-002: assertAdmin throws ADMIN_REQUIRED for non-admins', () => {
    expect(() => authz.assertAdmin(admin)).not.toThrow();
    expect(() => authz.assertAdmin(manager)).toThrowError(ForbiddenError);
    try {
      authz.assertAdmin(member);
    } catch (e) {
      expect((e as ForbiddenError).code).toBe('ADMIN_REQUIRED');
    }
  });

  it('AUTHZ-003: getTeamRole returns the role in that team, or null', async () => {
    expect(await authz.getTeamRole(manager, 't1')).toBe(TeamRole.MANAGER);
    expect(await authz.getTeamRole(member, 't1')).toBe(TeamRole.MEMBER);
    expect(await authz.getTeamRole(outsider, 't1')).toBeNull();
    expect(await authz.getTeamRole(manager, 'other-team')).toBeNull();
  });

  it('AUTHZ-004: assertTeamMember allows members, managers and admins; rejects outsiders', async () => {
    await expect(authz.assertTeamMember(member, 't1')).resolves.toBeUndefined();
    await expect(authz.assertTeamMember(manager, 't1')).resolves.toBeUndefined();
    await expect(authz.assertTeamMember(admin, 't1')).resolves.toBeUndefined();
    await expect(authz.assertTeamMember(outsider, 't1')).rejects.toMatchObject({
      code: 'NOT_TEAM_MEMBER',
      statusCode: 403,
    });
  });

  it('AUTHZ-005: assertTeamManager allows managers and admins; rejects members and outsiders', async () => {
    await expect(authz.assertTeamManager(manager, 't1')).resolves.toBeUndefined();
    await expect(authz.assertTeamManager(admin, 't1')).resolves.toBeUndefined();
    await expect(authz.assertTeamManager(member, 't1')).rejects.toMatchObject({
      code: 'TEAM_MANAGER_REQUIRED',
    });
    await expect(authz.assertTeamManager(outsider, 't1')).rejects.toMatchObject({
      code: 'TEAM_MANAGER_REQUIRED',
    });
  });

  it('AUTHZ-006: a manager of one team has no rights in another', async () => {
    await expect(authz.assertTeamManager(manager, 't2')).rejects.toBeInstanceOf(ForbiddenError);
  });
});
