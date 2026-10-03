import { TeamRole } from '../../shared/types/auth';

export interface Team {
  id: string;
  name: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TeamMember {
  teamId: string;
  userId: string;
  role: TeamRole;
  joinedAt: Date;
}

export interface CreateTeamInput {
  name: string;
  description?: string;
}

/**
 * Persistence abstraction for teams and their memberships.
 * Implemented in-memory now; a Prisma implementation will replace it later.
 */
export interface TeamRepository {
  create(input: CreateTeamInput): Promise<Team>;
  findById(id: string): Promise<Team | null>;
  findByName(name: string): Promise<Team | null>;
  findAll(): Promise<Team[]>;

  addMember(teamId: string, userId: string, role: TeamRole): Promise<TeamMember>;
  findMember(teamId: string, userId: string): Promise<TeamMember | null>;
  updateMemberRole(teamId: string, userId: string, role: TeamRole): Promise<TeamMember>;
  removeMember(teamId: string, userId: string): Promise<boolean>;
  listMembers(teamId: string): Promise<TeamMember[]>;
  listMembershipsForUser(userId: string): Promise<TeamMember[]>;
}
