import { randomUUID } from 'node:crypto';
import { AcquireResult, WorkItemLock, WorkItemLockStore } from './work-item-lock.entity';

/**
 * In-memory lock store for dev/test and single-instance deployments.
 * Will be replaced by a Redis-backed store for multi-instance production use.
 *
 * Methods contain no `await` between reading and writing a lock, so each is
 * atomic within the single-threaded event loop.
 */
export class InMemoryWorkItemLockStore implements WorkItemLockStore {
  private locks: Map<string, WorkItemLock> = new Map();

  private active(workItemId: string, now: Date): WorkItemLock | null {
    const lock = this.locks.get(workItemId);
    if (!lock) return null;
    if (lock.expiresAt.getTime() <= now.getTime()) {
      this.locks.delete(workItemId); // lazy expiry
      return null;
    }
    return lock;
  }

  async acquire(
    workItemId: string,
    userId: string,
    now: Date,
    ttlMs: number,
  ): Promise<AcquireResult> {
    const existing = this.active(workItemId, now);
    if (existing && existing.lockedBy !== userId) {
      return { acquired: false, lock: { ...existing } };
    }

    const lock: WorkItemLock = {
      workItemId,
      lockedBy: userId,
      token: existing?.token ?? randomUUID(),
      acquiredAt: existing?.acquiredAt ?? now,
      expiresAt: new Date(now.getTime() + ttlMs),
    };
    this.locks.set(workItemId, lock);
    return { acquired: true, renewed: existing !== null, lock: { ...lock } };
  }

  async extend(
    workItemId: string,
    userId: string,
    now: Date,
    ttlMs: number,
  ): Promise<WorkItemLock | null> {
    const existing = this.active(workItemId, now);
    if (!existing || existing.lockedBy !== userId) return null;

    const lock: WorkItemLock = { ...existing, expiresAt: new Date(now.getTime() + ttlMs) };
    this.locks.set(workItemId, lock);
    return { ...lock };
  }

  async release(workItemId: string, userId: string): Promise<boolean> {
    const existing = this.locks.get(workItemId);
    if (!existing || existing.lockedBy !== userId) return false;
    this.locks.delete(workItemId);
    return true;
  }

  async forceRelease(workItemId: string): Promise<boolean> {
    return this.locks.delete(workItemId);
  }

  async get(workItemId: string, now: Date): Promise<WorkItemLock | null> {
    const lock = this.active(workItemId, now);
    return lock ? { ...lock } : null;
  }

  /** Test helper — reset all data */
  clear(): void {
    this.locks.clear();
  }
}
