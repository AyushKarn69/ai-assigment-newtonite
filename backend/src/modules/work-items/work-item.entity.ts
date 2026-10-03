import { ActivityEntry, NewActivity } from '../activity/activity.entity';
import { LockProof } from './work-item-lock.entity';

export enum WorkItemType {
  CUSTOMER_ISSUE = 'CUSTOMER_ISSUE',
  ENGINEERING_PROBLEM = 'ENGINEERING_PROBLEM',
  PAYMENT_INVESTIGATION = 'PAYMENT_INVESTIGATION',
  PRODUCTION_INCIDENT = 'PRODUCTION_INCIDENT',
  COMPLIANCE_REQUEST = 'COMPLIANCE_REQUEST',
  APPROVAL_TASK = 'APPROVAL_TASK',
}

export enum WorkItemStatus {
  OPEN = 'OPEN',
  IN_PROGRESS = 'IN_PROGRESS',
  BLOCKED = 'BLOCKED',
  IN_REVIEW = 'IN_REVIEW',
  RESOLVED = 'RESOLVED',
  CLOSED = 'CLOSED',
}

export enum WorkItemPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export interface WorkItem {
  id: string;
  /** Sequential number (1001, 1002, ...) and its display key ("NW-1001"). */
  number: number;
  key: string;
  title: string;
  description: string;
  type: WorkItemType;
  status: WorkItemStatus;
  priority: WorkItemPriority;
  teamId: string;
  createdBy: string;
  assigneeId: string | null;
  /** Optimistic-concurrency counter; incremented on every successful update. */
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateWorkItemInput {
  title: string;
  description: string;
  type: WorkItemType;
  priority: WorkItemPriority;
  teamId: string;
  createdBy: string;
  assigneeId: string | null;
}

/** Fields that can change after creation (teamId, type-of-creator etc. are immutable). */
export type WorkItemPatch = Partial<
  Pick<WorkItem, 'title' | 'description' | 'type' | 'priority' | 'status' | 'assigneeId'>
>;

export const WORK_ITEM_SORT_FIELDS = ['createdAt', 'updatedAt', 'priority'] as const;
export type WorkItemSortField = (typeof WORK_ITEM_SORT_FIELDS)[number];

export interface WorkItemQuery {
  /** Restrict to these teams; undefined means no team restriction (admin). */
  teamIds?: string[];
  /** Any of these (OR within a field, AND across fields). */
  status?: WorkItemStatus[];
  type?: WorkItemType[];
  priority?: WorkItemPriority[];
  /** A user id, or null for unassigned. */
  assigneeId?: string | null;
  createdBy?: string;
  /** Case-insensitive substring match on title, description and key. */
  search?: string;
  sortBy: WorkItemSortField;
  sortOrder: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

export interface WorkItemPage {
  items: WorkItem[];
  totalCount: number;
}

/**
 * Persistence abstraction for work items.
 * Implemented in-memory now; a Prisma implementation will replace it later.
 */
export interface WorkItemRepository {
  create(input: CreateWorkItemInput): Promise<WorkItem>;
  findById(id: string): Promise<WorkItem | null>;
  /**
   * Compare-and-set update: applies `patch` and increments `version` only if the
   * stored version still equals `expectedVersion`. Returns null when it does not
   * (or the item no longer exists). Must be atomic in every implementation
   * (e.g. `UPDATE ... WHERE id = ? AND version = ?`).
   */
  update(id: string, expectedVersion: number, patch: WorkItemPatch): Promise<WorkItem | null>;
  query(query: WorkItemQuery): Promise<WorkItemPage>;
}

/** A stored change together with the activity entry written in the same transaction. */
export interface Committed {
  item: WorkItem;
  activity: ActivityEntry;
}

export type TransactionFailure = { ok: false; reason: 'LOCK_LOST' | 'NOT_FOUND' };

/**
 * Writes that must succeed or fail together with their history entry.
 *
 * A database implementation runs each method in ONE transaction, so a work item can never
 * change without its activity entry (and vice versa). `updateWithActivity` also re-checks
 * the edit lock inside that transaction — user, token and expiry — so a lock that expired or
 * was taken over between the service's check and the write is still rejected.
 */
export interface WorkItemTransactions {
  createWithActivity(
    input: CreateWorkItemInput,
    buildActivity: (item: WorkItem) => NewActivity,
    now: Date,
  ): Promise<Committed>;

  updateWithActivity(args: {
    id: string;
    patch: WorkItemPatch;
    proof: LockProof;
    now: Date;
    buildActivity: (before: WorkItem, after: WorkItem) => NewActivity;
  }): Promise<({ ok: true } & Committed) | TransactionFailure>;
}
