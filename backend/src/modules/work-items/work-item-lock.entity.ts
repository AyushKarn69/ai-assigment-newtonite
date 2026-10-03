export interface WorkItemLock {
  workItemId: string;
  /** User id of the holder. */
  lockedBy: string;
  /** Secret proof of ownership, issued when the lock is taken and kept when it is renewed. */
  token: string;
  acquiredAt: Date;
  expiresAt: Date;
}

/** What a mutation must prove: this user holds this lock (checked again inside the write). */
export interface LockProof {
  userId: string;
  token: string;
}

/** A lock as shown to people other than the holder: the token is never revealed. */
export type VisibleLock = Omit<WorkItemLock, 'token'> & { token?: string };

export type AcquireResult =
  /** `renewed` is true when the caller already held the lock (no new acquisition). */
  | { acquired: true; renewed: boolean; lock: WorkItemLock }
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
