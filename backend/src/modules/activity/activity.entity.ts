export enum ActivityType {
  CREATED = 'CREATED',
  UPDATED = 'UPDATED',
  LOCK_ACQUIRED = 'LOCK_ACQUIRED',
  LOCK_RELEASED = 'LOCK_RELEASED',
  /** A team manager or admin released someone else's lock. */
  LOCK_FORCE_RELEASED = 'LOCK_FORCE_RELEASED',
}

export interface FieldChange {
  field: string;
  /** null for CREATED entries, where there is no previous value. */
  from: unknown;
  to: unknown;
}

export interface ActivityEntry {
  id: string;
  workItemId: string;
  /** Per-work-item counter starting at 1; gives a stable order even when timestamps tie. */
  sequence: number;
  type: ActivityType;
  actorId: string;
  createdAt: Date;
  /** Field-level changes (CREATED / UPDATED); empty for lock events. */
  changes: FieldChange[];
  /** Event-specific extras, e.g. the resulting version or the previous lock holder. */
  metadata: Record<string, unknown>;
}

/** What callers provide when recording an event. */
export interface NewActivity {
  workItemId: string;
  type: ActivityType;
  actorId: string;
  changes?: FieldChange[];
  metadata?: Record<string, unknown>;
}

export interface ActivityQuery {
  workItemId: string;
  type?: ActivityType;
  /** By sequence: 'desc' = newest first. */
  order: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

export interface ActivityPage {
  items: ActivityEntry[];
  totalCount: number;
}

/**
 * Append-only storage for activity entries. There is deliberately no update or
 * delete: history is immutable.
 *
 * `append` must assign `sequence` atomically. A database implementation should
 * write the entry in the same transaction as the change it describes so the
 * history can never disagree with the data.
 */
export interface ActivityRepository {
  append(input: NewActivity & { createdAt: Date }): Promise<ActivityEntry>;
  list(query: ActivityQuery): Promise<ActivityPage>;
}
