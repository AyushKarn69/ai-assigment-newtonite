import { ForbiddenError } from '../../shared/errors/index';
import { AuthenticatedUser, GlobalRole, TeamRole } from '../../shared/types/auth';

/**
 * Minimal read-side view of team membership needed for authorization decisions.
 * TeamRepository satisfies this structurally.
 */
export interface MembershipLookup {
  findMember(teamId: string, userId: string): Promise<{ role: TeamRole } | null>;
}

/**
 * Central authorization policy.
 *
 * - Global ADMIN bypasses all team-level checks.
 * - Team-scoped permissions come from the user's TeamRole in that team.
 */
export class AuthorizationService {
  constructor(private readonly memberships: MembershipLookup) {}

  isAdmin(user: AuthenticatedUser): boolean {
    return user.role === GlobalRole.ADMIN;
  }

  async getTeamRole(user: AuthenticatedUser, teamId: string): Promise<TeamRole | null> {
    const member = await this.memberships.findMember(teamId, user.id);
    return member?.role ?? null;
  }

  assertAdmin(user: AuthenticatedUser): void {
    if (!this.isAdmin(user)) {
      throw new ForbiddenError('Administrator access required', 'ADMIN_REQUIRED');
    }
  }

  /** Admin, or any member of the team. */
  async assertTeamMember(user: AuthenticatedUser, teamId: string): Promise<void> {
    if (this.isAdmin(user)) return;
    if ((await this.getTeamRole(user, teamId)) === null) {
      throw new ForbiddenError('You are not a member of this team', 'NOT_TEAM_MEMBER');
    }
  }

  /** Admin, or a MANAGER of the team. */
  async assertTeamManager(user: AuthenticatedUser, teamId: string): Promise<void> {
    if (this.isAdmin(user)) return;
    if ((await this.getTeamRole(user, teamId)) !== TeamRole.MANAGER) {
      throw new ForbiddenError('Team manager access required', 'TEAM_MANAGER_REQUIRED');
    }
  }
}
