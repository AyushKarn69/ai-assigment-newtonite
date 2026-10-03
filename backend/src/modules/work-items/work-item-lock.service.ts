import { AuthorizationService } from '../authorization/authorization.service';
import {
  ConflictError,
  ForbiddenError,
  LockedError,
  NotFoundError,
} from '../../shared/errors/index';
import { AuthenticatedUser, TeamRole } from '../../shared/types/auth';
import { Clock } from '../../shared/utils/clock';
import { WorkItemLock, WorkItemLockStore } from './work-item-lock.entity';
import { WorkItemRepository } from './work-item.entity';

/**
 * What WorkItemService needs from locking: proof that the editor holds the lock.
 */
export interface EditLockGuard {
  assertHeldBy(userId: string, workItemId: string): Promise<void>;
}

export class WorkItemLockService implements EditLockGuard {
  constructor(
    private readonly store: WorkItemLockStore,
    private readonly workItemRepo: WorkItemRepository,
    private readonly authorization: AuthorizationService,
    private readonly clock: Clock,
    private readonly timeoutMs: number,
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
      await this.store.release(workItemId, actor.id);
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
    await this.store.forceRelease(workItemId);
  }

  /** Current active lock, or null. Team member (or admin). */
  async getLock(actor: AuthenticatedUser, workItemId: string): Promise<WorkItemLock | null> {
    await this.authorizeMember(actor, workItemId);
    return this.store.get(workItemId, this.clock.now());
  }

  async assertHeldBy(userId: string, workItemId: string): Promise<void> {
    const current = await this.store.get(workItemId, this.clock.now());
    if (!current) {
      throw new ConflictError(
        'Acquire the edit lock on this work item before changing it',
        'LOCK_REQUIRED',
      );
    }
    if (current.lockedBy !== userId) throw this.lockedBy(current);
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
