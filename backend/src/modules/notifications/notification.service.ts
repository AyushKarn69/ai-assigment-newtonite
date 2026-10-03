import { NotFoundError } from '../../shared/errors/index';
import { AuthenticatedUser } from '../../shared/types/auth';
import { Clock } from '../../shared/utils/clock';
import { Notification, NotificationPage, NotificationRepository } from './notification.entity';

/** A user's own notifications. Nobody can read or change anyone else's. */
export class NotificationService {
  constructor(
    private readonly repo: NotificationRepository,
    private readonly clock: Clock,
  ) {}

  list(
    actor: AuthenticatedUser,
    options: { unreadOnly: boolean; page: number; pageSize: number },
  ): Promise<NotificationPage> {
    return this.repo.list({ userId: actor.id, ...options });
  }

  unreadCount(actor: AuthenticatedUser): Promise<number> {
    return this.repo.countUnread(actor.id);
  }

  /** Idempotent: marking an already-read notification returns it unchanged. */
  async markRead(actor: AuthenticatedUser, id: string): Promise<Notification> {
    const notification = await this.repo.markRead(id, actor.id, this.clock.now());
    if (!notification) throw new NotFoundError('Notification not found', 'NOTIFICATION_NOT_FOUND');
    return notification;
  }

  markAllRead(actor: AuthenticatedUser): Promise<number> {
    return this.repo.markAllRead(actor.id, this.clock.now());
  }
}
