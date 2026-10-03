import { ActivityRepository } from '../activity/activity.entity';
import { WorkItemLockStore } from './work-item-lock.entity';
import {
  Committed,
  CreateWorkItemInput,
  TransactionFailure,
  WorkItem,
  WorkItemPatch,
  WorkItemRepository,
  WorkItemTransactions,
} from './work-item.entity';
import { NewActivity } from '../activity/activity.entity';
import { LockProof } from './work-item-lock.entity';

/**
 * In-memory implementation: performs the steps one after another. (A single-threaded
 * process cannot be interrupted between them in a way that matters here; the PostgreSQL
 * implementation provides real atomicity.)
 */
export class InMemoryWorkItemTransactions implements WorkItemTransactions {
  constructor(
    private readonly items: WorkItemRepository,
    private readonly activity: ActivityRepository,
    private readonly locks: WorkItemLockStore,
  ) {}

  async createWithActivity(
    input: CreateWorkItemInput,
    buildActivity: (item: WorkItem) => NewActivity,
    now: Date,
  ): Promise<Committed> {
    const item = await this.items.create(input);
    const activity = await this.activity.append({ ...buildActivity(item), createdAt: now });
    return { item, activity };
  }

  async updateWithActivity(args: {
    id: string;
    patch: WorkItemPatch;
    proof: LockProof;
    now: Date;
    buildActivity: (before: WorkItem, after: WorkItem) => NewActivity;
  }): Promise<({ ok: true } & Committed) | TransactionFailure> {
    const lock = await this.locks.get(args.id, args.now);
    if (!lock || lock.lockedBy !== args.proof.userId || lock.token !== args.proof.token) {
      return { ok: false, reason: 'LOCK_LOST' };
    }
    const before = await this.items.findById(args.id);
    if (!before) return { ok: false, reason: 'NOT_FOUND' };

    const after = await this.items.update(args.id, before.version, args.patch);
    if (!after) return { ok: false, reason: 'LOCK_LOST' };

    const activity = await this.activity.append({
      ...args.buildActivity(before, after),
      createdAt: args.now,
    });
    return { ok: true, item: after, activity };
  }
}
