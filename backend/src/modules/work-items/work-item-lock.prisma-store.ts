import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient, TransactionClient } from '../../shared/db/prisma';
import { AcquireResult, WorkItemLock, WorkItemLockStore } from './work-item-lock.entity';

interface Row {
  workItemId: string;
  lockedBy: string;
  token: string;
  acquiredAt: Date;
  expiresAt: Date;
}

/**
 * A Date as a UTC `timestamp` for raw SQL. The columns are `timestamp without time zone`
 * (Prisma stores UTC), and a bare Date parameter would be shifted by the database
 * server's own time zone, so the conversion is spelled out.
 */
const utc = (date: Date) => Prisma.sql`(${date.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;

const toLock = (row: Row): WorkItemLock => ({
  workItemId: row.workItemId,
  lockedBy: row.lockedBy,
  token: row.token,
  acquiredAt: row.acquiredAt,
  expiresAt: row.expiresAt,
});

/**
 * PostgreSQL-backed edit leases: single writer, many readers.
 *
 * `WorkItemLock.workItemId` is the primary key, so there can never be two lock rows for one
 * item. Acquisition is atomic:
 *
 *   1. `INSERT ... ON CONFLICT DO NOTHING` — the database lets exactly one inserter in.
 *   2. Otherwise `SELECT ... FOR UPDATE` locks the existing row so concurrent acquirers queue
 *      up behind each other and each sees the previous one's result.
 *   3. Under that row lock: the holder renews, an expired lease is replaced, anyone else is refused.
 *
 * All expiry decisions use the `now` supplied by the caller (the application clock), not the
 * database clock, so expiry behaves identically to the in-memory store and can be tested.
 */
export class PrismaWorkItemLockStore implements WorkItemLockStore {
  constructor(private readonly db: PrismaClient) {}

  async acquire(workItemId: string, userId: string, now: Date, ttlMs: number): Promise<AcquireResult> {
    const expiresAt = new Date(now.getTime() + ttlMs);
    // Retry loop only for the rare case where the row vanishes (released) between steps 1 and 2.
    for (let attempt = 0; attempt < 5; attempt++) {
      const result = await this.db.$transaction((tx) => this.tryAcquire(tx, workItemId, userId, now, expiresAt));
      if (result) return result;
    }
    throw new Error('Could not acquire the lock because it kept changing hands; try again');
  }

  private async tryAcquire(
    tx: TransactionClient,
    workItemId: string,
    userId: string,
    now: Date,
    expiresAt: Date,
  ): Promise<AcquireResult | null> {
    const token = randomUUID();
    const inserted = await tx.$executeRaw`
      INSERT INTO "WorkItemLock" ("workItemId", "lockedBy", "token", "acquiredAt", "expiresAt")
      VALUES (${workItemId}, ${userId}, ${token}, ${utc(now)}, ${utc(expiresAt)})
      ON CONFLICT ("workItemId") DO NOTHING`;
    if (inserted === 1) {
      return { acquired: true, renewed: false, lock: { workItemId, lockedBy: userId, token, acquiredAt: now, expiresAt } };
    }

    const [current] = await tx.$queryRaw<Row[]>`
      SELECT * FROM "WorkItemLock" WHERE "workItemId" = ${workItemId} FOR UPDATE`;
    if (!current) return null; // released in the meantime: start over

    const stillValid = current.expiresAt.getTime() > now.getTime();
    if (stillValid && current.lockedBy !== userId) {
      return { acquired: false, lock: toLock(current) };
    }

    if (stillValid) {
      // the holder asking again: renew, keeping the token and the original start time
      await tx.$executeRaw`UPDATE "WorkItemLock" SET "expiresAt" = ${utc(expiresAt)} WHERE "workItemId" = ${workItemId}`;
      return { acquired: true, renewed: true, lock: { ...toLock(current), expiresAt } };
    }

    // expired lease: replace it with a fresh one (new holder, new token)
    await tx.$executeRaw`
      UPDATE "WorkItemLock"
      SET "lockedBy" = ${userId}, "token" = ${token}, "acquiredAt" = ${utc(now)}, "expiresAt" = ${utc(expiresAt)}
      WHERE "workItemId" = ${workItemId}`;
    return { acquired: true, renewed: false, lock: { workItemId, lockedBy: userId, token, acquiredAt: now, expiresAt } };
  }

  async extend(workItemId: string, userId: string, now: Date, ttlMs: number): Promise<WorkItemLock | null> {
    const expiresAt = new Date(now.getTime() + ttlMs);
    // a single statement: only the current, unexpired holder can extend
    const rows = await this.db.$queryRaw<Row[]>`
      UPDATE "WorkItemLock"
      SET "expiresAt" = ${utc(expiresAt)}
      WHERE "workItemId" = ${workItemId} AND "lockedBy" = ${userId} AND "expiresAt" > ${utc(now)}
      RETURNING *`;
    return rows[0] ? toLock(rows[0]) : null;
  }

  async release(workItemId: string, userId: string): Promise<boolean> {
    const result = await this.db.workItemLock.deleteMany({ where: { workItemId, lockedBy: userId } });
    return result.count > 0;
  }

  async forceRelease(workItemId: string): Promise<boolean> {
    const result = await this.db.workItemLock.deleteMany({ where: { workItemId } });
    return result.count > 0;
  }

  async get(workItemId: string, now: Date): Promise<WorkItemLock | null> {
    const row = await this.db.workItemLock.findUnique({ where: { workItemId } });
    if (!row || row.expiresAt.getTime() <= now.getTime()) return null; // expired = no lock
    return toLock(row);
  }
}
