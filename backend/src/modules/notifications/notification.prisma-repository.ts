import { Notification as NotificationRow, PrismaClient, isUniqueViolation } from '../../shared/db/prisma';
import {
  NewNotification,
  Notification,
  NotificationPage,
  NotificationQuery,
  NotificationRepository,
  NotificationType,
} from './notification.entity';

const toNotification = (row: NotificationRow): Notification => ({
  id: row.id,
  userId: row.userId,
  type: row.type as NotificationType,
  activityId: row.activityId,
  workItemId: row.workItemId,
  workItemKey: row.workItemKey,
  workItemTitle: row.workItemTitle,
  actorId: row.actorId,
  actorName: row.actorName,
  message: row.message,
  createdAt: row.createdAt,
  readAt: row.readAt,
});

/**
 * PostgreSQL-backed notifications. The unique (userId, activityId, type) constraint is what
 * makes delivery idempotent: a replayed job hits the constraint and gets the existing row.
 */
export class PrismaNotificationRepository implements NotificationRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(input: NewNotification): Promise<Notification> {
    try {
      return toNotification(await this.db.notification.create({ data: input }));
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const existing = await this.db.notification.findUnique({
        where: {
          userId_activityId_type: { userId: input.userId, activityId: input.activityId, type: input.type },
        },
      });
      if (!existing) throw error;
      return toNotification(existing);
    }
  }

  async list(query: NotificationQuery): Promise<NotificationPage> {
    const where = { userId: query.userId, ...(query.unreadOnly && { readAt: null }) };
    const [totalCount, rows] = await this.db.$transaction([
      this.db.notification.count({ where }),
      this.db.notification.findMany({
        where,
        orderBy: { seq: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return { items: rows.map(toNotification), totalCount };
  }

  async countUnread(userId: string): Promise<number> {
    return this.db.notification.count({ where: { userId, readAt: null } });
  }

  async markRead(id: string, userId: string, readAt: Date): Promise<Notification | null> {
    // only unread rows are touched, so the first read time is kept
    await this.db.notification.updateMany({ where: { id, userId, readAt: null }, data: { readAt } });
    const row = await this.db.notification.findFirst({ where: { id, userId } });
    return row ? toNotification(row) : null;
  }

  async markAllRead(userId: string, readAt: Date): Promise<number> {
    const result = await this.db.notification.updateMany({ where: { userId, readAt: null }, data: { readAt } });
    return result.count;
  }
}
