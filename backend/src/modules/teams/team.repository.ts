import { randomUUID } from 'node:crypto';
import { TeamRole } from '../../shared/types/auth';
import { CreateTeamInput, Team, TeamMember, TeamRepository } from './team.entity';

/**
 * In-memory team repository for the pre-database phase.
 * Will be replaced by PrismaTeamRepository in the database phase.
 */
export class InMemoryTeamRepository implements TeamRepository {
  private teams: Map<string, Team> = new Map();
  private nameIndex: Map<string, string> = new Map(); // lowercased name -> id
  private members: Map<string, TeamMember> = new Map(); // `${teamId}:${userId}` -> member

  private static memberKey(teamId: string, userId: string): string {
    return `${teamId}:${userId}`;
  }

  async create(input: CreateTeamInput): Promise<Team> {
    const now = new Date();
    const team: Team = {
      id: randomUUID(),
      name: input.name,
      description: input.description ?? '',
      createdAt: now,
      updatedAt: now,
    };
    this.teams.set(team.id, team);
    this.nameIndex.set(team.name.toLowerCase(), team.id);
    return team;
  }

  async findById(id: string): Promise<Team | null> {
    return this.teams.get(id) ?? null;
  }

  async findByName(name: string): Promise<Team | null> {
    const id = this.nameIndex.get(name.toLowerCase());
    return id ? (this.teams.get(id) ?? null) : null;
  }

  async findAll(): Promise<Team[]> {
    return Array.from(this.teams.values());
  }

  async addMember(teamId: string, userId: string, role: TeamRole): Promise<TeamMember> {
    const member: TeamMember = { teamId, userId, role, joinedAt: new Date() };
    this.members.set(InMemoryTeamRepository.memberKey(teamId, userId), member);
    return member;
  }

  async findMember(teamId: string, userId: string): Promise<TeamMember | null> {
    return this.members.get(InMemoryTeamRepository.memberKey(teamId, userId)) ?? null;
  }

  async updateMemberRole(teamId: string, userId: string, role: TeamRole): Promise<TeamMember> {
    const key = InMemoryTeamRepository.memberKey(teamId, userId);
    const existing = this.members.get(key);
    if (!existing) throw new Error(`Membership not found: ${teamId}/${userId}`);
    const updated: TeamMember = { ...existing, role };
    this.members.set(key, updated);
    return updated;
  }

  async removeMember(teamId: string, userId: string): Promise<boolean> {
    return this.members.delete(InMemoryTeamRepository.memberKey(teamId, userId));
  }

  async listMembers(teamId: string): Promise<TeamMember[]> {
    return Array.from(this.members.values()).filter((m) => m.teamId === teamId);
  }

  async listMembershipsForUser(userId: string): Promise<TeamMember[]> {
    return Array.from(this.members.values()).filter((m) => m.userId === userId);
  }

  /** Test helper — reset all data */
  clear(): void {
    this.teams.clear();
    this.nameIndex.clear();
    this.members.clear();
  }
}
