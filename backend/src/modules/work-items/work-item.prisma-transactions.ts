import { NewActivity } from '../activity/activity.entity';
import { insertActivity } from '../activity/activity.prisma-repository';
import { PrismaClient } from '../../shared/db/prisma';
import { LockProof } from './work-item-lock.entity';
import {
  Committed,
  CreateWorkItemInput,
  TransactionFailure,
  WorkItem,
  WorkItemPatch,
  WorkItemTransactions,
} from './work-item.entity';
import { createWorkItemRow, patchData, toWorkItem } from './work-item.prisma-repository';

interface LockRow {
  lockedBy: string;
  token: string;
  expiresAt: Date;
}

/**
 * Work item changes and their history entries, each in ONE PostgreSQL transaction:
 * either both are stored or neither is.
 *
 * `updateWithActivity` re-validates the edit lock (user + token + expiry) inside the
 * transaction, locking the lock row (`SELECT ... FOR UPDATE`) until commit. A rival
 * cannot take over an expired lease, and the holder cannot release it, between the
 * check and the write.
 */
export class PrismaWorkItemTransactions implements WorkItemTransactions {
  constructor(private readonly db: PrismaClient) {}

  async createWithActivity(
    input: CreateWorkItemInput,
    buildActivity: (item: WorkItem) => NewActivity,
    now: Date,
  ): Promise<Committed> {
    return this.db.$transaction(async (tx) => {
      const row = await createWorkItemRow(tx, input, 1);
      const item = toWorkItem(row);
      const activity = await insertActivity(tx, 1, { ...buildActivity(item), createdAt: now });
      return { item, activity };
    });
  }

  async updateWithActivity(args: {
    id: string;
    patch: WorkItemPatch;
    proof: LockProof;
    now: Date;
    buildActivity: (before: WorkItem, after: WorkItem) => NewActivity;
  }): Promise<({ ok: true } & Committed) | TransactionFailure> {
    return this.db.$transaction(async (tx) => {
      const [lock] = await tx.$queryRaw<LockRow[]>`
        SELECT "lockedBy", "token", "expiresAt"
        FROM "WorkItemLock"
        WHERE "workItemId" = ${args.id}
        FOR UPDATE`;

      if (
        !lock ||
        lock.lockedBy !== args.proof.userId ||
        lock.token !== args.proof.token ||
        lock.expiresAt.getTime() <= args.now.getTime()
      ) {
        return { ok: false, reason: 'LOCK_LOST' } as const;
      }

      const beforeRow = await tx.workItem.findUnique({ where: { id: args.id } });
      if (!beforeRow) return { ok: false, reason: 'NOT_FOUND' } as const;

      // One statement changes the item, bumps its revision counter and reserves the
      // next activity sequence number (this also takes the item's row lock).
      const afterRow = await tx.workItem.update({
        where: { id: args.id },
        data: {
          ...patchData(args.patch),
          version: { increment: 1 },
          activitySeq: { increment: 1 },
          updatedAt: new Date(),
        },
      });

      const before = toWorkItem(beforeRow);
      const after = toWorkItem(afterRow);
      const activity = await insertActivity(tx, afterRow.activitySeq, {
        ...args.buildActivity(before, after),
        createdAt: args.now,
      });
      return { ok: true, item: after, activity } as const;
    });
  }
}
