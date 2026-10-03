import { AuthorizationService } from '../authorization/authorization.service';
import { NotFoundError } from '../../shared/errors/index';
import { AuthenticatedUser } from '../../shared/types/auth';
import { Clock } from '../../shared/utils/clock';
import {
  ActivityEntry,
  ActivityQuery,
  ActivityRepository,
  NewActivity,
} from './activity.entity';

/**
 * What other modules need from the activity log: a way to record events.
 */
export interface ActivityRecorder {
  record(input: NewActivity): Promise<void>;
}

/** Minimal views of other modules, satisfied structurally (keeps module dependencies one-way). */
export interface WorkItemLookup {
  findById(id: string): Promise<{ teamId: string } | null>;
}
export interface UserLookup {
  findByIdInternal(id: string): Promise<{ name: string } | null>;
}

export interface ActivityEntryView extends ActivityEntry {
  actorName: string | null;
}

export interface ActivityViewPage {
  items: ActivityEntryView[];
  totalCount: number;
}

export type ListActivityCommand = Omit<ActivityQuery, 'workItemId'>;

export class ActivityService implements ActivityRecorder {
  constructor(
    private readonly repo: ActivityRepository,
    private readonly workItems: WorkItemLookup,
    private readonly authorization: AuthorizationService,
    private readonly users: UserLookup,
    private readonly clock: Clock,
  ) {}

  async record(input: NewActivity): Promise<void> {
    await this.repo.append({ ...input, createdAt: this.clock.now() });
  }

  /** Team member (or admin). */
  async list(
    actor: AuthenticatedUser,
    workItemId: string,
    command: ListActivityCommand,
  ): Promise<ActivityViewPage> {
    const item = await this.workItems.findById(workItemId);
    if (!item) throw new NotFoundError('Work item not found', 'WORK_ITEM_NOT_FOUND');
    await this.authorization.assertTeamMember(actor, item.teamId);

    const page = await this.repo.list({ ...command, workItemId });

    const names = new Map<string, string | null>();
    for (const actorId of new Set(page.items.map((e) => e.actorId))) {
      names.set(actorId, (await this.users.findByIdInternal(actorId))?.name ?? null);
    }
    return {
      items: page.items.map((e) => ({ ...e, actorName: names.get(e.actorId) ?? null })),
      totalCount: page.totalCount,
    };
  }
}
