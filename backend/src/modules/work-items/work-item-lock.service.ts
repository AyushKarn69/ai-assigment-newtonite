import { ActivityRecorder } from '../activity/activity.service';
import { ActivityType } from '../activity/activity.entity';
import { AuthorizationService } from '../authorization/authorization.service';
import {
  ConflictError,
  ForbiddenError,
  LockedError,
  NotFoundError,
} from '../../shared/errors/index';
import { AuthenticatedUser, TeamRole } from '../../shared/types/auth';
import { Clock } from '../../shared/utils/clock';
import { LockProof, VisibleLock, WorkItemLock, WorkItemLockStore } from './work-item-lock.entity';
import { WorkItemRepository } from './work-item.entity';

/**
 * What WorkItemService needs from locking: proof that the editor holds the lock.
 */
export interface EditLockGuard {
  /**
   * Throws unless `userId` holds an unexpired lock on the item (and, when given, presents the
   * matching token). Returns the proof to re-validate inside the database transaction.
   */
  assertHeldBy(userId: string, workItemId: string, providedToken?: string): Promise<LockProof>;
}

export class WorkItemLockService implements EditLockGuard {
  constructor(
    private readonly store: WorkItemLockStore,
    private readonly workItemRepo: WorkItemRepository,
    private readonly authorization: AuthorizationService,
    private readonly clock: Clock,
    private readonly timeoutMs: number,
    private readonly activity: ActivityRecorder,
  ) {}

  /**
   * Acquire the exclusive edit lock. Team member (or admin).
   * Re-acquiring a lock you already hold renews it.
   */
  async acquire(actor: AuthenticatedUser, workItemId: string): Promise<WorkItemLock> {
    await this.authorizeMember(actor, workItemId);

    const result = await this.store.acquire(
      workItemId,
      actor.id,
      this.clock.now(),
      this.timeoutMs,
    );
    if (!result.acquired) throw this.lockedBy(result.lock);

    // Renewing a lock you already hold is not a new event
    if (!result.renewed) {
      await this.activity.record({
        workItemId,
        type: ActivityType.LOCK_ACQUIRED,
        actorId: actor.id,
        metadata: { expiresAt: result.lock.expiresAt.toISOString() },
      });
    }
    return result.lock;
  }

  /** Extend a lock you hold. */
  async heartbeat(actor: AuthenticatedUser, workItemId: string): Promise<WorkItemLock> {
    await this.authorizeMember(actor, workItemId);

    const now = this.clock.now();
    const lock = await this.store.extend(workItemId, actor.id, now, this.timeoutMs);
    if (lock) return lock;

    const current = await this.store.get(workItemId, now);
    if (current) throw this.lockedBy(current);
    throw this.notHeld();
  }

  /**
   * Release a lock. The holder can always release; a team manager (or admin)
   * can force-release someone else's lock, e.g. when the holder is unavailable.
   */
  async release(actor: AuthenticatedUser, workItemId: string): Promise<void> {
    const teamId = await this.authorizeMember(actor, workItemId);

    const current = await this.store.get(workItemId, this.clock.now());
    if (!current) throw this.notHeld();

    if (current.lockedBy === actor.id) {
      if (await this.store.release(workItemId, actor.id)) {
        await this.activity.record({
          workItemId,
          type: ActivityType.LOCK_RELEASED,
          actorId: actor.id,
        });
      }
      return;
    }

    const canForce =
      this.authorization.isAdmin(actor) ||
      (await this.authorization.getTeamRole(actor, teamId)) === TeamRole.MANAGER;
    if (!canForce) {
      throw new ForbiddenError(
        'Only the lock holder or a team manager can release this lock',
        'NOT_LOCK_HOLDER',
      );
    }
    if (await this.store.forceRelease(workItemId)) {
      await this.activity.record({
        workItemId,
        type: ActivityType.LOCK_FORCE_RELEASED,
        actorId: actor.id,
        metadata: { previousHolderId: current.lockedBy },
      });
    }
  }

  /** Current active lock, or null. Team member (or admin). The token is shown to the holder only. */
  async getLock(actor: AuthenticatedUser, workItemId: string): Promise<VisibleLock | null> {
    await this.authorizeMember(actor, workItemId);
    const lock = await this.store.get(workItemId, this.clock.now());
    if (!lock) return null;
    if (lock.lockedBy === actor.id) return lock;
    const { token: _token, ...visible } = lock;
    return visible;
  }

  async assertHeldBy(userId: string, workItemId: string, providedToken?: string): Promise<LockProof> {
    const current = await this.store.get(workItemId, this.clock.now());
    if (!current) {
      throw new ConflictError(
        'Acquire the edit lock on this work item before changing it',
        'LOCK_REQUIRED',
      );
    }
    if (current.lockedBy !== userId) throw this.lockedBy(current);
    if (providedToken !== undefined && providedToken !== current.token) {
      throw new ConflictError('The lock token does not match the current lock', 'LOCK_TOKEN_MISMATCH');
    }
    return { userId, token: current.token };
  }

  /** Returns the item's teamId after checking it exists and the actor may see it. */
  private async authorizeMember(actor: AuthenticatedUser, workItemId: string): Promise<string> {
    const item = await this.workItemRepo.findById(workItemId);
    if (!item) throw new NotFoundError('Work item not found', 'WORK_ITEM_NOT_FOUND');
    await this.authorization.assertTeamMember(actor, item.teamId);
    return item.teamId;
  }

  private lockedBy(lock: WorkItemLock): LockedError {
    return new LockedError(
      'This work item is currently being edited by another user.',
      'WORK_ITEM_LOCKED',
      { lockedBy: lock.lockedBy, expiresAt: lock.expiresAt.toISOString() },
    );
  }

  private notHeld(): ConflictError {
    return new ConflictError(
      'You do not hold a lock on this work item (it may have expired)',
      'LOCK_NOT_HELD',
    );
  }
}
