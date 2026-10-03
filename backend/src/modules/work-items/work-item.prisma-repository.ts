import {
  Prisma,
  PrismaClient,
  TransactionClient,
  WorkItem as WorkItemRow,
} from '../../shared/db/prisma';
import {
  CreateWorkItemInput,
  WorkItem,
  WorkItemPage,
  WorkItemPatch,
  WorkItemQuery,
  WorkItemRepository,
  WorkItemPriority,
  WorkItemStatus,
  WorkItemType,
} from './work-item.entity';

export const toWorkItem = (row: WorkItemRow): WorkItem => ({
  id: row.id,
  number: row.number,
  key: row.key,
  title: row.title,
  description: row.description,
  type: row.type as WorkItemType,
  status: row.status as WorkItemStatus,
  priority: row.priority as WorkItemPriority,
  teamId: row.teamId,
  createdBy: row.createdBy,
  assigneeId: row.assigneeId,
  version: row.version,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

/** Create the row, taking its number from the database sequence (never reused, concurrency-safe). */
export async function createWorkItemRow(
  tx: TransactionClient,
  input: CreateWorkItemInput,
  activitySeq: number,
): Promise<WorkItemRow> {
  const [{ nextval }] = await tx.$queryRaw<Array<{ nextval: bigint }>>`
    SELECT nextval(pg_get_serial_sequence('"WorkItem"', 'number')) AS nextval`;
  const number = Number(nextval);
  const now = new Date();
  return tx.workItem.create({
    data: {
      number,
      key: `NW-${number}`,
      title: input.title,
      description: input.description,
      type: input.type,
      priority: input.priority,
      teamId: input.teamId,
      createdBy: input.createdBy,
      assigneeId: input.assigneeId,
      activitySeq,
      createdAt: now,
      updatedAt: now,
    },
  });
}

/** Column updates for a patch (also used by the transaction that writes the history entry). */
export const patchData = (patch: WorkItemPatch): Prisma.WorkItemUncheckedUpdateInput => ({
  ...(patch.title !== undefined && { title: patch.title }),
  ...(patch.description !== undefined && { description: patch.description }),
  ...(patch.type !== undefined && { type: patch.type }),
  ...(patch.priority !== undefined && { priority: patch.priority }),
  ...(patch.status !== undefined && { status: patch.status }),
  ...(patch.assigneeId !== undefined && { assigneeId: patch.assigneeId }),
});

const PRIORITY_FIELD_ORDER = { asc: 'asc', desc: 'desc' } as const;

/**
 * PostgreSQL-backed work items.
 *
 * Reads and simple writes only. Changes that must be recorded in the history go through
 * PrismaWorkItemTransactions, which writes the item and its activity entry atomically.
 */
export class PrismaWorkItemRepository implements WorkItemRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(input: CreateWorkItemInput): Promise<WorkItem> {
    const row = await this.db.$transaction((tx) => createWorkItemRow(tx, input, 0));
    return toWorkItem(row);
  }

  async findById(id: string): Promise<WorkItem | null> {
    const row = await this.db.workItem.findUnique({ where: { id } });
    return row ? toWorkItem(row) : null;
  }

  /** Conditional update (`WHERE id AND version`): applied only if the stored version still matches. */
  async update(id: string, expectedVersion: number, patch: WorkItemPatch): Promise<WorkItem | null> {
    const result = await this.db.workItem.updateMany({
      where: { id, version: expectedVersion },
      data: { ...patchData(patch), version: { increment: 1 }, updatedAt: new Date() },
    });
    if (result.count === 0) return null;
    return this.findById(id);
  }

  async query(query: WorkItemQuery): Promise<WorkItemPage> {
    const search = query.search?.trim();
    const where: Prisma.WorkItemWhereInput = {
      ...(query.teamIds !== undefined && { teamId: { in: query.teamIds } }),
      ...(query.status !== undefined && { status: { in: query.status } }),
      ...(query.type !== undefined && { type: { in: query.type } }),
      ...(query.priority !== undefined && { priority: { in: query.priority } }),
      ...(query.assigneeId !== undefined && { assigneeId: query.assigneeId }),
      ...(query.createdBy !== undefined && { createdBy: query.createdBy }),
      ...(search && {
        OR: [
          { title: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
          { key: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const direction = PRIORITY_FIELD_ORDER[query.sortOrder];
    // Priority is a database enum declared LOW < MEDIUM < HIGH < CRITICAL, so it sorts correctly.
    const orderBy: Prisma.WorkItemOrderByWithRelationInput[] = [
      { [query.sortBy]: direction },
      { createdAt: 'asc' },
      { id: 'asc' },
    ];

    // an "unlimited" page size (used by internal callers) must not be sent as a huge LIMIT
    const unlimited = query.pageSize >= 1_000_000;
    const [totalCount, rows] = await this.db.$transaction([
      this.db.workItem.count({ where }),
      this.db.workItem.findMany({
        where,
        orderBy,
        ...(unlimited ? {} : { skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      }),
    ]);
    return { items: rows.map(toWorkItem), totalCount };
  }
}
