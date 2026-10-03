import { PrismaClient, Team as TeamRow, TeamMember as MemberRow } from '../../shared/db/prisma';
import { isRecordNotFound } from '../../shared/db/prisma';
import { TeamRole } from '../../shared/types/auth';
import { CreateTeamInput, Team, TeamMember, TeamRepository } from './team.entity';

const toTeam = (row: TeamRow): Team => ({
  id: row.id,
  name: row.name,
  description: row.description,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const toMember = (row: MemberRow): TeamMember => ({
  teamId: row.teamId,
  userId: row.userId,
  role: row.role as TeamRole,
  joinedAt: row.joinedAt,
});

/** PostgreSQL-backed teams and memberships. Team names are unique ignoring case. */
export class PrismaTeamRepository implements TeamRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(input: CreateTeamInput): Promise<Team> {
    const row = await this.db.team.create({
      data: {
        name: input.name,
        nameKey: input.name.toLowerCase(),
        description: input.description ?? '',
      },
    });
    return toTeam(row);
  }

  async findById(id: string): Promise<Team | null> {
    const row = await this.db.team.findUnique({ where: { id } });
    return row ? toTeam(row) : null;
  }

  async findByName(name: string): Promise<Team | null> {
    const row = await this.db.team.findUnique({ where: { nameKey: name.toLowerCase() } });
    return row ? toTeam(row) : null;
  }

  async findAll(): Promise<Team[]> {
    return (await this.db.team.findMany({ orderBy: { createdAt: 'asc' } })).map(toTeam);
  }

  async addMember(teamId: string, userId: string, role: TeamRole): Promise<TeamMember> {
    const row = await this.db.teamMember.upsert({
      where: { teamId_userId: { teamId, userId } },
      create: { teamId, userId, role },
      update: { role },
    });
    return toMember(row);
  }

  async findMember(teamId: string, userId: string): Promise<TeamMember | null> {
    const row = await this.db.teamMember.findUnique({ where: { teamId_userId: { teamId, userId } } });
    return row ? toMember(row) : null;
  }

  async updateMemberRole(teamId: string, userId: string, role: TeamRole): Promise<TeamMember> {
    try {
      const row = await this.db.teamMember.update({
        where: { teamId_userId: { teamId, userId } },
        data: { role },
      });
      return toMember(row);
    } catch (error) {
      if (isRecordNotFound(error)) throw new Error(`Membership not found: ${teamId}/${userId}`);
      throw error;
    }
  }

  async removeMember(teamId: string, userId: string): Promise<boolean> {
    const result = await this.db.teamMember.deleteMany({ where: { teamId, userId } });
    return result.count > 0;
  }

  async listMembers(teamId: string): Promise<TeamMember[]> {
    return (await this.db.teamMember.findMany({ where: { teamId }, orderBy: { joinedAt: 'asc' } })).map(toMember);
  }

  async listMembershipsForUser(userId: string): Promise<TeamMember[]> {
    return (await this.db.teamMember.findMany({ where: { userId } })).map(toMember);
  }
}
