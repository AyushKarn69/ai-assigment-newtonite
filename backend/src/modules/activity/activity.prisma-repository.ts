import { Activity as ActivityRow, Prisma, PrismaClient, TransactionClient } from '../../shared/db/prisma';
import {
  ActivityEntry,
  ActivityPage,
  ActivityQuery,
  ActivityRepository,
  ActivityType,
  FieldChange,
  NewActivity,
} from './activity.entity';

export const toActivityEntry = (row: ActivityRow): ActivityEntry => ({
  id: row.id,
  workItemId: row.workItemId,
  sequence: row.sequence,
  type: row.type as ActivityType,
  actorId: row.actorId,
  createdAt: row.createdAt,
  changes: (row.changes ?? []) as unknown as FieldChange[],
  metadata: (row.metadata ?? {}) as Record<string, unknown>,
});

/**
 * Insert one entry with an already-reserved sequence number. Used inside transactions
 * that reserve the sequence together with the change they describe.
 */
export async function insertActivity(
  tx: TransactionClient,
  sequence: number,
  input: NewActivity & { createdAt: Date },
): Promise<ActivityEntry> {
  const row = await tx.activity.create({
    data: {
      workItemId: input.workItemId,
      sequence,
      type: input.type,
      actorId: input.actorId,
      createdAt: input.createdAt,
      changes: (input.changes ?? []) as unknown as Prisma.InputJsonValue,
      metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
    },
  });
  return toActivityEntry(row);
}

/**
 * PostgreSQL-backed activity log. Append-only: the only write is `insert`.
 *
 * The per-item sequence is reserved by incrementing WorkItem.activitySeq in the same
 * transaction as the insert. That UPDATE takes the work item's row lock, so concurrent
 * appenders are serialised and sequence numbers are gap-free and unique; the
 * (workItemId, sequence) unique constraint backs that up.
 */
export class PrismaActivityRepository implements ActivityRepository {
  constructor(private readonly db: PrismaClient) {}

  async append(input: NewActivity & { createdAt: Date }): Promise<ActivityEntry> {
    return this.db.$transaction(async (tx) => {
      const { activitySeq } = await tx.workItem.update({
        where: { id: input.workItemId },
        data: { activitySeq: { increment: 1 } },
        select: { activitySeq: true },
      });
      return insertActivity(tx, activitySeq, input);
    });
  }

  async list(query: ActivityQuery): Promise<ActivityPage> {
    const where: Prisma.ActivityWhereInput = {
      workItemId: query.workItemId,
      ...(query.type !== undefined && { type: query.type }),
    };
    const [totalCount, rows] = await this.db.$transaction([
      this.db.activity.count({ where }),
      this.db.activity.findMany({
        where,
        orderBy: { sequence: query.order },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return { items: rows.map(toActivityEntry), totalCount };
  }

  async listRecent(workItemIds: string[], limit: number): Promise<ActivityEntry[]> {
    if (workItemIds.length === 0) return [];
    const rows = await this.db.activity.findMany({
      where: { workItemId: { in: workItemIds } },
      orderBy: [{ createdAt: 'desc' }, { sequence: 'desc' }],
      take: limit,
    });
    return rows.map(toActivityEntry);
  }
}
