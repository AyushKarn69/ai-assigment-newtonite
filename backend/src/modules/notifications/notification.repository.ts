import { randomUUID } from 'node:crypto';
import {
  NewNotification,
  Notification,
  NotificationPage,
  NotificationQuery,
  NotificationRepository,
} from './notification.entity';

/** In-memory notification store for the pre-database phase. */
export class InMemoryNotificationRepository implements NotificationRepository {
  private notifications: Notification[] = []; // insertion order = creation order
  private byDedupeKey = new Map<string, Notification>();

  async create(input: NewNotification): Promise<Notification> {
    const key = `${input.userId}|${input.activityId}|${input.type}`;
    const existing = this.byDedupeKey.get(key);
    if (existing) return { ...existing };

    const notification: Notification = { id: randomUUID(), ...input, readAt: null };
    this.notifications.push(notification);
    this.byDedupeKey.set(key, notification);
    return { ...notification };
  }

  async list(query: NotificationQuery): Promise<NotificationPage> {
    const matches = this.notifications
      .filter((n) => n.userId === query.userId && (!query.unreadOnly || n.readAt === null))
      .reverse();
    const start = (query.page - 1) * query.pageSize;
    return {
      items: matches.slice(start, start + query.pageSize).map((n) => ({ ...n })),
      totalCount: matches.length,
    };
  }

  async countUnread(userId: string): Promise<number> {
    return this.notifications.filter((n) => n.userId === userId && n.readAt === null).length;
  }

  async markRead(id: string, userId: string, readAt: Date): Promise<Notification | null> {
    const notification = this.notifications.find((n) => n.id === id && n.userId === userId);
    if (!notification) return null;
    notification.readAt ??= readAt;
    return { ...notification };
  }

  async markAllRead(userId: string, readAt: Date): Promise<number> {
    let updated = 0;
    for (const n of this.notifications) {
      if (n.userId === userId && n.readAt === null) {
        n.readAt = readAt;
        updated += 1;
      }
    }
    return updated;
  }

  /** Test helper — reset all data */
  clear(): void {
    this.notifications = [];
    this.byDedupeKey.clear();
  }
}
