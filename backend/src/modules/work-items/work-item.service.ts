import { ActivityRecorder } from '../activity/activity.service';
import { ActivityType, FieldChange } from '../activity/activity.entity';
import { AuthorizationService } from '../authorization/authorization.service';
import { TeamRepository } from '../teams/team.entity';
import {
  ConflictError,
  NotFoundError,
  UnprocessableEntityError,
} from '../../shared/errors/index';
import { AuthenticatedUser } from '../../shared/types/auth';
import {
  WorkItem,
  WorkItemPatch,
  WorkItemPage,
  WorkItemPriority,
  WorkItemQuery,
  WorkItemRepository,
  WorkItemType,
  WorkItemStatus,
} from './work-item.entity';
import { allowedTransitions, canTransition, requiresManager } from './work-item.workflow';
import { EditLockGuard } from './work-item-lock.service';

export interface CreateWorkItemCommand {
  title: string;
  description?: string;
  type: WorkItemType;
  priority?: WorkItemPriority;
  teamId: string;
  assigneeId?: string | null;
}

export interface UpdateWorkItemCommand {
  /** The version the client last read; the update fails with 409 if it is stale. */
  version: number;
  title?: string;
  description?: string;
  type?: WorkItemType;
  priority?: WorkItemPriority;
  status?: WorkItemStatus;
  assigneeId?: string | null;
}

export interface ListWorkItemsCommand {
  teamId?: string;
  status?: WorkItemStatus;
  type?: WorkItemType;
  priority?: WorkItemPriority;
  assigneeId?: string;
  sortBy: WorkItemQuery['sortBy'];
  sortOrder: WorkItemQuery['sortOrder'];
  page: number;
  pageSize: number;
}

export class WorkItemService {
  constructor(
    private readonly workItemRepo: WorkItemRepository,
    private readonly teamRepo: TeamRepository,
    private readonly authorization: AuthorizationService,
    private readonly editLocks: EditLockGuard,
    private readonly activity: ActivityRecorder,
  ) {}

  /** Team member (or admin). Setting an assignee at creation requires a manager. */
  async create(actor: AuthenticatedUser, input: CreateWorkItemCommand): Promise<WorkItem> {
    await this.requireTeam(input.teamId);
    await this.authorization.assertTeamMember(actor, input.teamId);

    const assigneeId = input.assigneeId ?? null;
    if (assigneeId !== null) {
      await this.authorization.assertTeamManager(actor, input.teamId);
      await this.assertAssigneeInTeam(input.teamId, assigneeId);
    }

    const item = await this.workItemRepo.create({
      title: input.title,
      description: input.description ?? '',
      type: input.type,
      priority: input.priority ?? WorkItemPriority.MEDIUM,
      teamId: input.teamId,
      createdBy: actor.id,
      assigneeId,
    });

    const initial: Array<keyof WorkItem> = [
      'title',
      'description',
      'type',
      'priority',
      'status',
      'teamId',
      'assigneeId',
    ];
    await this.activity.record({
      workItemId: item.id,
      type: ActivityType.CREATED,
      actorId: actor.id,
      changes: initial.map((field) => ({ field, from: null, to: item[field] })),
      metadata: { version: item.version },
    });
    return item;
  }

  /** Admin sees everything; everyone else only items of teams they belong to. */
  async list(actor: AuthenticatedUser, command: ListWorkItemsCommand): Promise<WorkItemPage> {
    const { teamId, ...rest } = command;
    let teamIds: string[] | undefined;

    if (teamId !== undefined) {
      await this.authorization.assertTeamMember(actor, teamId);
      teamIds = [teamId];
    } else if (!this.authorization.isAdmin(actor)) {
      const memberships = await this.teamRepo.listMembershipsForUser(actor.id);
      if (memberships.length === 0) return { items: [], totalCount: 0 };
      teamIds = memberships.map((m) => m.teamId);
    }

    return this.workItemRepo.query({ ...rest, teamIds });
  }

  /** Team member (or admin). */
  async getById(actor: AuthenticatedUser, id: string): Promise<WorkItem> {
    const item = await this.requireItem(id);
    await this.authorization.assertTeamMember(actor, item.teamId);
    return item;
  }

  /**
   * Update. The caller must hold the work item's exclusive edit lock
   * (409 LOCK_REQUIRED if nobody does, 423 WORK_ITEM_LOCKED if someone else does).
   * The version check is kept as a second line of defence, e.g. if a lock
   * expired and another user saved in the meantime.
   *
   * - Content fields and ordinary status transitions: team member.
   * - Changing the assignee, closing, or reopening a closed item: team manager.
   */
  async update(
    actor: AuthenticatedUser,
    id: string,
    command: UpdateWorkItemCommand,
  ): Promise<WorkItem> {
    const item = await this.requireItem(id);
    await this.authorization.assertTeamMember(actor, item.teamId);
    await this.editLocks.assertHeldBy(actor.id, id);

    const patch = this.diff(item, command);
    if (Object.keys(patch).length === 0) return item; // nothing to change

    if (patch.status !== undefined) {
      if (!canTransition(item.status, patch.status)) {
        throw new UnprocessableEntityError(
          `Cannot move from ${item.status} to ${patch.status}. Allowed: ${allowedTransitions(item.status).join(', ')}`,
          'INVALID_STATUS_TRANSITION',
        );
      }
      if (requiresManager(item.status, patch.status)) {
        await this.authorization.assertTeamManager(actor, item.teamId);
      }
    }

    if (patch.assigneeId !== undefined) {
      await this.authorization.assertTeamManager(actor, item.teamId);
      if (patch.assigneeId !== null) {
        await this.assertAssigneeInTeam(item.teamId, patch.assigneeId);
      }
    }

    // Early, friendly check; the repository's compare-and-set below is the real guard.
    if (item.version !== command.version) {
      throw this.versionConflict(item.version, command.version);
    }
    const updated = await this.workItemRepo.update(id, command.version, patch);
    if (!updated) {
      const current = await this.workItemRepo.findById(id);
      throw this.versionConflict(current?.version, command.version);
    }

    const changes: FieldChange[] = (Object.keys(patch) as Array<keyof WorkItemPatch>).map(
      (field) => ({ field, from: item[field], to: patch[field] }),
    );
    await this.activity.record({
      workItemId: id,
      type: ActivityType.UPDATED,
      actorId: actor.id,
      changes,
      metadata: { version: updated.version },
    });
    return updated;
  }

  /** Only the fields that actually differ from the stored item. */
  private diff(item: WorkItem, command: UpdateWorkItemCommand): WorkItemPatch {
    const patch: WorkItemPatch = {};
    if (command.title !== undefined && command.title !== item.title) patch.title = command.title;
    if (command.description !== undefined && command.description !== item.description) {
      patch.description = command.description;
    }
    if (command.type !== undefined && command.type !== item.type) patch.type = command.type;
    if (command.priority !== undefined && command.priority !== item.priority) {
      patch.priority = command.priority;
    }
    if (command.status !== undefined && command.status !== item.status) {
      patch.status = command.status;
    }
    if (command.assigneeId !== undefined && command.assigneeId !== item.assigneeId) {
      patch.assigneeId = command.assigneeId;
    }
    return patch;
  }

  private versionConflict(currentVersion: number | undefined, sent: number): ConflictError {
    return new ConflictError(
      `Work item was modified by someone else (your version ${sent}, current version ${currentVersion ?? 'unknown'}). Reload and retry.`,
      'VERSION_CONFLICT',
    );
  }

  private async requireItem(id: string): Promise<WorkItem> {
    const item = await this.workItemRepo.findById(id);
    if (!item) throw new NotFoundError('Work item not found', 'WORK_ITEM_NOT_FOUND');
    return item;
  }

  private async requireTeam(teamId: string): Promise<void> {
    if (!(await this.teamRepo.findById(teamId))) {
      throw new NotFoundError('Team not found', 'TEAM_NOT_FOUND');
    }
  }

  private async assertAssigneeInTeam(teamId: string, assigneeId: string): Promise<void> {
    if (!(await this.teamRepo.findMember(teamId, assigneeId))) {
      throw new UnprocessableEntityError(
        'Assignee must be a member of the work item\'s team',
        'ASSIGNEE_NOT_TEAM_MEMBER',
      );
    }
  }
}
