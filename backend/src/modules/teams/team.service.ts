import { AuthorizationService } from '../authorization/authorization.service';
import { UserService } from '../users/user.service';
import {
  ConflictError,
  NotFoundError,
  UnprocessableEntityError,
} from '../../shared/errors/index';
import { AuthenticatedUser, TeamRole } from '../../shared/types/auth';
import { PaginationInput } from '../../shared/validation/common-schemas';
import { CreateTeamInput, Team, TeamMember, TeamRepository } from './team.entity';

export interface TeamMemberView {
  userId: string;
  name: string;
  email: string;
  role: TeamRole;
  joinedAt: Date;
}

export interface TeamView extends Team {
  /** The requesting user's role in this team, or null (e.g. an admin who isn't a member). */
  myRole: TeamRole | null;
}

export interface TeamPage {
  items: TeamView[];
  totalCount: number;
}

export interface CreateTeamCommand extends CreateTeamInput {
  /** Optional initial manager. */
  managerId?: string;
}

export class TeamService {
  constructor(
    private readonly teamRepo: TeamRepository,
    private readonly userService: UserService,
    private readonly authorization: AuthorizationService,
  ) {}

  /** ADMIN only. */
  async createTeam(actor: AuthenticatedUser, input: CreateTeamCommand): Promise<TeamView> {
    this.authorization.assertAdmin(actor);

    if (await this.teamRepo.findByName(input.name)) {
      throw new ConflictError('A team with this name already exists', 'TEAM_NAME_TAKEN');
    }
    if (input.managerId) {
      await this.userService.findById(input.managerId); // throws USER_NOT_FOUND
    }

    const team = await this.teamRepo.create({ name: input.name, description: input.description });
    if (input.managerId) {
      await this.teamRepo.addMember(team.id, input.managerId, TeamRole.MANAGER);
    }
    return this.toView(actor, team);
  }

  /** Admins see every team; everyone else sees only teams they belong to. */
  async listTeams(actor: AuthenticatedUser, page: PaginationInput): Promise<TeamPage> {
    let teams: Team[];
    if (this.authorization.isAdmin(actor)) {
      teams = await this.teamRepo.findAll();
    } else {
      const memberships = await this.teamRepo.listMembershipsForUser(actor.id);
      const found = await Promise.all(memberships.map((m) => this.teamRepo.findById(m.teamId)));
      teams = found.filter((t): t is Team => t !== null);
    }

    teams.sort((a, b) => a.name.localeCompare(b.name));
    const start = (page.page - 1) * page.pageSize;
    const slice = teams.slice(start, start + page.pageSize);
    const items = await Promise.all(slice.map((t) => this.toView(actor, t)));
    return { items, totalCount: teams.length };
  }

  /** Admin or team member. */
  async getTeam(actor: AuthenticatedUser, teamId: string): Promise<TeamView> {
    const team = await this.requireTeam(teamId);
    await this.authorization.assertTeamMember(actor, teamId);
    return this.toView(actor, team);
  }

  /** Admin or team member. */
  async listMembers(actor: AuthenticatedUser, teamId: string): Promise<TeamMemberView[]> {
    await this.requireTeam(teamId);
    await this.authorization.assertTeamMember(actor, teamId);

    const members = await this.teamRepo.listMembers(teamId);
    const views = await Promise.all(members.map((m) => this.toMemberView(m)));
    return views
      .filter((v): v is TeamMemberView => v !== null)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Admin or team manager. */
  async addMember(
    actor: AuthenticatedUser,
    teamId: string,
    userId: string,
    role: TeamRole,
  ): Promise<TeamMemberView> {
    await this.requireTeam(teamId);
    await this.authorization.assertTeamManager(actor, teamId);
    await this.userService.findById(userId); // throws USER_NOT_FOUND

    if (await this.teamRepo.findMember(teamId, userId)) {
      throw new ConflictError('User is already a member of this team', 'ALREADY_TEAM_MEMBER');
    }

    const member = await this.teamRepo.addMember(teamId, userId, role);
    return (await this.toMemberView(member))!;
  }

  /**
   * Admin or team manager adds someone by email address. The permission check comes first,
   * so only managers can learn whether an email is registered.
   */
  async addMemberByEmail(
    actor: AuthenticatedUser,
    teamId: string,
    email: string,
    role: TeamRole,
  ): Promise<TeamMemberView> {
    await this.requireTeam(teamId);
    await this.authorization.assertTeamManager(actor, teamId);
    const user = await this.userService.findByEmail(email);
    if (!user) throw new NotFoundError('No user is registered with that email', 'USER_NOT_FOUND');
    return this.addMember(actor, teamId, user.id, role);
  }

  /** Admin or team manager. A team must always keep at least one manager. */
  async changeMemberRole(
    actor: AuthenticatedUser,
    teamId: string,
    userId: string,
    role: TeamRole,
  ): Promise<TeamMemberView> {
    await this.requireTeam(teamId);
    await this.authorization.assertTeamManager(actor, teamId);
    const existing = await this.requireMember(teamId, userId);

    if (existing.role === TeamRole.MANAGER && role !== TeamRole.MANAGER) {
      await this.assertNotLastManager(teamId);
    }

    const member = await this.teamRepo.updateMemberRole(teamId, userId, role);
    return (await this.toMemberView(member))!;
  }

  /** Admin or team manager. A team must always keep at least one manager. */
  async removeMember(actor: AuthenticatedUser, teamId: string, userId: string): Promise<void> {
    await this.requireTeam(teamId);
    await this.authorization.assertTeamManager(actor, teamId);
    const existing = await this.requireMember(teamId, userId);

    if (existing.role === TeamRole.MANAGER) {
      await this.assertNotLastManager(teamId);
    }

    await this.teamRepo.removeMember(teamId, userId);
  }

  private async requireTeam(teamId: string): Promise<Team> {
    const team = await this.teamRepo.findById(teamId);
    if (!team) throw new NotFoundError('Team not found', 'TEAM_NOT_FOUND');
    return team;
  }

  private async requireMember(teamId: string, userId: string): Promise<TeamMember> {
    const member = await this.teamRepo.findMember(teamId, userId);
    if (!member) throw new NotFoundError('User is not a member of this team', 'MEMBER_NOT_FOUND');
    return member;
  }

  private async assertNotLastManager(teamId: string): Promise<void> {
    const members = await this.teamRepo.listMembers(teamId);
    const managers = members.filter((m) => m.role === TeamRole.MANAGER).length;
    if (managers <= 1) {
      throw new UnprocessableEntityError(
        'A team must have at least one manager',
        'TEAM_REQUIRES_MANAGER',
      );
    }
  }

  private async toView(actor: AuthenticatedUser, team: Team): Promise<TeamView> {
    const myRole = await this.authorization.getTeamRole(actor, team.id);
    return { ...team, myRole };
  }

  private async toMemberView(member: TeamMember): Promise<TeamMemberView | null> {
    const user = await this.userService.findByIdInternal(member.userId);
    if (!user) return null;
    return {
      userId: user.id,
      name: user.name,
      email: user.email,
      role: member.role,
      joinedAt: member.joinedAt,
    };
  }
}
