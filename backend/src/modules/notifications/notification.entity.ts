export enum NotificationType {
  ASSIGNED = 'ASSIGNED',
  UNASSIGNED = 'UNASSIGNED',
  STATUS_CHANGED = 'STATUS_CHANGED',
  COMMENT_ADDED = 'COMMENT_ADDED',
  LOCK_FORCE_RELEASED = 'LOCK_FORCE_RELEASED',
}

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  /** The activity entry that caused it; with `userId` and `type` it makes delivery idempotent. */
  activityId: string;
  workItemId: string;
  /** Snapshots taken when the notification was created. */
  workItemKey: string;
  workItemTitle: string;
  actorId: string;
  actorName: string | null;
  message: string;
  createdAt: Date;
  readAt: Date | null;
}

export type NewNotification = Omit<Notification, 'id' | 'readAt'>;

export interface NotificationQuery {
  userId: string;
  unreadOnly: boolean;
  page: number;
  pageSize: number;
}

export interface NotificationPage {
  items: Notification[];
  totalCount: number;
}

/**
 * Notification storage. `create` is idempotent: a second call with the same
 * (userId, activityId, type) returns the existing notification instead of
 * adding a duplicate, which makes at-least-once job delivery safe.
 */
export interface NotificationRepository {
  create(input: NewNotification): Promise<Notification>;
  /** Newest first. */
  list(query: NotificationQuery): Promise<NotificationPage>;
  countUnread(userId: string): Promise<number>;
  /** Returns null if the notification does not exist or belongs to someone else. */
  markRead(id: string, userId: string, readAt: Date): Promise<Notification | null>;
  /** Returns how many were newly marked read. */
  markAllRead(userId: string, readAt: Date): Promise<number>;
}
