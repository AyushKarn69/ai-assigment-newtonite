export interface WorkItemLock {
  workItemId: string;
  /** User id of the holder. */
  lockedBy: string;
  acquiredAt: Date;
  expiresAt: Date;
}

export type AcquireResult =
  | { acquired: true; lock: WorkItemLock }
  /** `lock` is the active lock that blocked the attempt. */
  | { acquired: false; lock: WorkItemLock };

/**
 * Storage for exclusive edit locks.
 *
 * Every method must be atomic with respect to concurrent callers — the in-memory
 * implementation relies on the single-threaded event loop; a Redis implementation
 * would use `SET key value NX PX ttl` plus small Lua scripts for extend/release.
 *
 * An expired lock is treated exactly like no lock at all.
 */
export interface WorkItemLockStore {
  /**
   * Take the lock if it is free, expired, or already held by `userId`
   * (which renews it, keeping the original `acquiredAt`).
   */
  acquire(workItemId: string, userId: string, now: Date, ttlMs: number): Promise<AcquireResult>;
  /** Push the expiry out. Returns null unless `userId` currently holds an active lock. */
  extend(workItemId: string, userId: string, now: Date, ttlMs: number): Promise<WorkItemLock | null>;
  /** Release only if `userId` holds it. Returns whether a lock was released. */
  release(workItemId: string, userId: string): Promise<boolean>;
  /** Release regardless of holder. Returns whether a lock was released. */
  forceRelease(workItemId: string): Promise<boolean>;
  /** The active (non-expired) lock, if any. */
  get(workItemId: string, now: Date): Promise<WorkItemLock | null>;
}
