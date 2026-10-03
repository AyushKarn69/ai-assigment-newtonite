import { randomUUID } from 'node:crypto';
import {
  ActivityEntry,
  ActivityPage,
  ActivityQuery,
  ActivityRepository,
  NewActivity,
} from './activity.entity';

/**
 * In-memory activity log for the pre-database phase.
 * Will be replaced by PrismaActivityRepository in the database phase.
 */
export class InMemoryActivityRepository implements ActivityRepository {
  private entries: ActivityEntry[] = [];
  private lastSequence: Map<string, number> = new Map(); // workItemId -> last sequence

  async append(input: NewActivity & { createdAt: Date }): Promise<ActivityEntry> {
    // No await between reading and bumping the counter, so this is atomic
    // within the single-threaded event loop.
    const sequence = (this.lastSequence.get(input.workItemId) ?? 0) + 1;
    this.lastSequence.set(input.workItemId, sequence);

    const entry: ActivityEntry = {
      id: randomUUID(),
      workItemId: input.workItemId,
      sequence,
      type: input.type,
      actorId: input.actorId,
      createdAt: input.createdAt,
      changes: (input.changes ?? []).map((c) => ({ ...c })),
      metadata: { ...(input.metadata ?? {}) },
    };
    this.entries.push(entry);
    return clone(entry);
  }

  async list(query: ActivityQuery): Promise<ActivityPage> {
    const matches = this.entries.filter(
      (e) =>
        e.workItemId === query.workItemId && (query.type === undefined || e.type === query.type),
    );

    const direction = query.order === 'asc' ? 1 : -1;
    matches.sort((a, b) => (a.sequence - b.sequence) * direction);

    const start = (query.page - 1) * query.pageSize;
    return {
      items: matches.slice(start, start + query.pageSize).map(clone),
      totalCount: matches.length,
    };
  }

  /** Test helper — reset all data */
  clear(): void {
    this.entries = [];
    this.lastSequence.clear();
  }
}

/** Entries handed out are copies so callers cannot mutate stored history. */
function clone(entry: ActivityEntry): ActivityEntry {
  return {
    ...entry,
    changes: entry.changes.map((c) => ({ ...c })),
    metadata: { ...entry.metadata },
  };
}
