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
import { Clock } from '../../shared/utils/clock';
import {
  WorkItem,
  WorkItemPatch,
  WorkItemPage,
  WorkItemPriority,
  WorkItemQuery,
  WorkItemRepository,
  WorkItemType,
  WorkItemStatus,
  WorkItemTransactions,
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
  /** Optional extra proof of lock ownership (the `X-Lock-Token` header). */
  lockToken?: string;
  title?: string;
  description?: string;
  type?: WorkItemType;
  priority?: WorkItemPriority;
  status?: WorkItemStatus;
  assigneeId?: string | null;
}

export interface ListWorkItemsCommand {
  teamId?: string;
  status?: WorkItemStatus[];
  type?: WorkItemType[];
  priority?: WorkItemPriority[];
  /** 'me', 'unassigned', or a user id. */
  assignee?: string;
  createdBy?: string;
  search?: string;
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
    private readonly transactions: WorkItemTransactions,
    private readonly clock: Clock,
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

    const initial: Array<keyof WorkItem> = [
      'title',
      'description',
      'type',
      'priority',
      'status',
      'teamId',
      'assigneeId',
    ];
    // The item and its CREATED entry are stored in one transaction
    const { item, activity } = await this.transactions.createWithActivity(
      {
        title: input.title,
        description: input.description ?? '',
        type: input.type,
        priority: input.priority ?? WorkItemPriority.MEDIUM,
        teamId: input.teamId,
        createdBy: actor.id,
        assigneeId,
      },
      (created) => ({
        workItemId: created.id,
        type: ActivityType.CREATED,
        actorId: actor.id,
        changes: initial.map((field) => ({ field, from: null, to: created[field] })),
        metadata: { version: created.version },
      }),
      this.clock.now(),
    );
    await this.activity.announce(activity);
    return item;
  }

  /** Admin sees everything; everyone else only items of teams they belong to. */
  async list(actor: AuthenticatedUser, command: ListWorkItemsCommand): Promise<WorkItemPage> {
    const { teamId, assignee, ...rest } = command;
    let teamIds: string[] | undefined;

    if (teamId !== undefined) {
      await this.authorization.assertTeamMember(actor, teamId);
      teamIds = [teamId];
    } else if (!this.authorization.isAdmin(actor)) {
      const memberships = await this.teamRepo.listMembershipsForUser(actor.id);
      if (memberships.length === 0) return { items: [], totalCount: 0 };
      teamIds = memberships.map((m) => m.teamId);
    }

    let assigneeId: string | null | undefined;
    if (assignee === 'me') assigneeId = actor.id;
    else if (assignee === 'unassigned') assigneeId = null;
    else assigneeId = assignee;

    return this.workItemRepo.query({ ...rest, assigneeId, teamIds });
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
   * The lock (user + token + expiry) is validated here and AGAIN inside the database
   * transaction that writes the change and its activity entry, so a lock that expires or
   * changes hands in between cannot let a write through.
   *
   * The client's `version` is only a precondition on what the user was looking at; the
   * write itself is protected by the lock, not by comparing versions.
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
    const proof = await this.editLocks.assertHeldBy(actor.id, id, command.lockToken);

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

    // What the user was looking at is out of date
    if (item.version !== command.version) {
      throw this.versionConflict(item.version, command.version);
    }

    const result = await this.transactions.updateWithActivity({
      id,
      patch,
      proof,
      now: this.clock.now(),
      buildActivity: (before, after) => {
        const changes: FieldChange[] = (Object.keys(patch) as Array<keyof WorkItemPatch>).map(
          (field) => ({ field, from: before[field], to: patch[field] }),
        );
        return {
          workItemId: id,
          type: ActivityType.UPDATED,
          actorId: actor.id,
          changes,
          metadata: { version: after.version },
        };
      },
    });

    if (!result.ok) {
      if (result.reason === 'NOT_FOUND') {
        throw new NotFoundError('Work item not found', 'WORK_ITEM_NOT_FOUND');
      }
      // The lock was lost between our check and the write: report why (expired / someone else's)
      await this.editLocks.assertHeldBy(actor.id, id, command.lockToken);
      throw new ConflictError('The edit lock is no longer valid', 'LOCK_REQUIRED');
    }

    await this.activity.announce(result.activity);
    return result.item;
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
