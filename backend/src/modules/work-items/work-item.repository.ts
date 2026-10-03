import { randomUUID } from 'node:crypto';
import {
  CreateWorkItemInput,
  WorkItem,
  WorkItemPage,
  WorkItemPatch,
  WorkItemPriority,
  WorkItemQuery,
  WorkItemRepository,
  WorkItemStatus,
} from './work-item.entity';

const PRIORITY_RANK: Record<WorkItemPriority, number> = {
  [WorkItemPriority.LOW]: 0,
  [WorkItemPriority.MEDIUM]: 1,
  [WorkItemPriority.HIGH]: 2,
  [WorkItemPriority.CRITICAL]: 3,
};

/**
 * In-memory work item repository for the pre-database phase.
 * Will be replaced by PrismaWorkItemRepository in the database phase.
 */
export class InMemoryWorkItemRepository implements WorkItemRepository {
  private items: Map<string, WorkItem> = new Map();

  async create(input: CreateWorkItemInput): Promise<WorkItem> {
    const now = new Date();
    const item: WorkItem = {
      id: randomUUID(),
      ...input,
      status: WorkItemStatus.OPEN,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.items.set(item.id, item);
    return { ...item };
  }

  async findById(id: string): Promise<WorkItem | null> {
    const item = this.items.get(id);
    return item ? { ...item } : null;
  }

  async update(
    id: string,
    expectedVersion: number,
    patch: WorkItemPatch,
  ): Promise<WorkItem | null> {
    // No await between the version check and the write, so this is atomic
    // within the single-threaded event loop.
    const existing = this.items.get(id);
    if (!existing || existing.version !== expectedVersion) return null;

    const updated: WorkItem = {
      ...existing,
      ...patch,
      version: existing.version + 1,
      updatedAt: new Date(),
    };
    this.items.set(id, updated);
    return { ...updated };
  }

  async query(query: WorkItemQuery): Promise<WorkItemPage> {
    const matches = Array.from(this.items.values()).filter(
      (item) =>
        (query.teamIds === undefined || query.teamIds.includes(item.teamId)) &&
        (query.status === undefined || item.status === query.status) &&
        (query.type === undefined || item.type === query.type) &&
        (query.priority === undefined || item.priority === query.priority) &&
        (query.assigneeId === undefined || item.assigneeId === query.assigneeId),
    );

    const direction = query.sortOrder === 'asc' ? 1 : -1;
    const sortKey = (item: WorkItem): number =>
      query.sortBy === 'priority' ? PRIORITY_RANK[item.priority] : item[query.sortBy].getTime();

    matches.sort((a, b) => {
      const primary = (sortKey(a) - sortKey(b)) * direction;
      if (primary !== 0) return primary;
      // Stable, deterministic tie-break
      return a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);
    });

    const start = (query.page - 1) * query.pageSize;
    return {
      items: matches.slice(start, start + query.pageSize).map((i) => ({ ...i })),
      totalCount: matches.length,
    };
  }

  /** Test helper — reset all data */
  clear(): void {
    this.items.clear();
  }
}
