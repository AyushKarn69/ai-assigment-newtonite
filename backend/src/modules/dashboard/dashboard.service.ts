import { ActivityEntry, ActivityRepository } from '../activity/activity.entity';
import { UserLookup } from '../activity/activity.service';
import { TeamRepository } from '../teams/team.entity';
import {
  WorkItemQuery,
  WorkItemRepository,
  WorkItemStatus,
  WorkItemPriority,
} from '../work-items/work-item.entity';
import { AuthenticatedUser } from '../../shared/types/auth';
import { AuthorizationService } from '../authorization/authorization.service';

const OPEN_STATUSES = [
  WorkItemStatus.OPEN,
  WorkItemStatus.IN_PROGRESS,
  WorkItemStatus.BLOCKED,
  WorkItemStatus.IN_REVIEW,
];

const RECENT_ACTIVITY_LIMIT = 10;

export interface TeamLoad {
  teamId: string;
  teamName: string;
  open: number;
  blocked: number;
  unassigned: number;
}

export interface RecentActivity extends ActivityEntry {
  actorName: string | null;
  workItemKey: string;
  workItemTitle: string;
}

export interface Dashboard {
  counts: {
    /** Open items assigned to me. */
    myWork: number;
    /** Open items with HIGH or CRITICAL priority. */
    highCritical: number;
    /** Open items nobody owns. */
    unassigned: number;
    blocked: number;
    open: number;
    total: number;
  };
  byStatus: Record<WorkItemStatus, number>;
  teamLoad: TeamLoad[];
  recentActivity: RecentActivity[];
}

type Filter = Partial<Pick<WorkItemQuery, 'status' | 'priority' | 'assigneeId' | 'teamIds'>>;

/**
 * Read-only overview for the signed-in user, limited to the teams they belong to
 * (admins see every team).
 */
export class DashboardService {
  constructor(
    private readonly workItemRepo: WorkItemRepository,
    private readonly teamRepo: TeamRepository,
    private readonly activityRepo: ActivityRepository,
    private readonly authorization: AuthorizationService,
    private readonly users: UserLookup,
  ) {}

  async get(actor: AuthenticatedUser): Promise<Dashboard> {
    const teams = await this.visibleTeams(actor);
    const teamIds = teams.map((t) => t.id);

    const count = async (filter: Filter = {}): Promise<number> => {
      if (teamIds.length === 0) return 0;
      const page = await this.workItemRepo.query({
        teamIds,
        ...filter,
        sortBy: 'updatedAt',
        sortOrder: 'desc',
        page: 1,
        pageSize: 1,
      });
      return page.totalCount;
    };

    const byStatus = {} as Record<WorkItemStatus, number>;
    for (const status of Object.values(WorkItemStatus)) {
      byStatus[status] = await count({ status: [status] });
    }

    const [myWork, highCritical, unassigned] = await Promise.all([
      count({ status: OPEN_STATUSES, assigneeId: actor.id }),
      count({ status: OPEN_STATUSES, priority: [WorkItemPriority.HIGH, WorkItemPriority.CRITICAL] }),
      count({ status: OPEN_STATUSES, assigneeId: null }),
    ]);

    const teamLoad: TeamLoad[] = [];
    for (const team of teams) {
      teamLoad.push({
        teamId: team.id,
        teamName: team.name,
        open: await count({ teamIds: [team.id], status: OPEN_STATUSES }),
        blocked: await count({ teamIds: [team.id], status: [WorkItemStatus.BLOCKED] }),
        unassigned: await count({ teamIds: [team.id], status: OPEN_STATUSES, assigneeId: null }),
      });
    }
    teamLoad.sort((a, b) => b.open - a.open || a.teamName.localeCompare(b.teamName));

    return {
      counts: {
        myWork,
        highCritical,
        unassigned,
        blocked: byStatus[WorkItemStatus.BLOCKED],
        open: OPEN_STATUSES.reduce((sum, s) => sum + byStatus[s], 0),
        total: await count(),
      },
      byStatus,
      teamLoad,
      recentActivity: await this.recentActivity(teamIds),
    };
  }

  private async visibleTeams(actor: AuthenticatedUser) {
    if (this.authorization.isAdmin(actor)) return this.teamRepo.findAll();
    const memberships = await this.teamRepo.listMembershipsForUser(actor.id);
    const teams = await Promise.all(memberships.map((m) => this.teamRepo.findById(m.teamId)));
    return teams.filter((t): t is NonNullable<typeof t> => t !== null);
  }

  private async recentActivity(teamIds: string[]): Promise<RecentActivity[]> {
    if (teamIds.length === 0) return [];
    const visible = await this.workItemRepo.query({
      teamIds,
      sortBy: 'updatedAt',
      sortOrder: 'desc',
      page: 1,
      pageSize: Number.MAX_SAFE_INTEGER,
    });
    const itemsById = new Map(visible.items.map((i) => [i.id, i]));

    const entries = await this.activityRepo.listRecent([...itemsById.keys()], RECENT_ACTIVITY_LIMIT);
    const names = new Map<string, string | null>();
    for (const actorId of new Set(entries.map((e) => e.actorId))) {
      names.set(actorId, (await this.users.findByIdInternal(actorId))?.name ?? null);
    }
    return entries.map((entry) => {
      const item = itemsById.get(entry.workItemId)!;
      return {
        ...entry,
        actorName: names.get(entry.actorId) ?? null,
        workItemKey: item.key,
        workItemTitle: item.title,
      };
    });
  }
}
