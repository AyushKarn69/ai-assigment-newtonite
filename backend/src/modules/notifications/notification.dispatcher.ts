import { ActivityEntry, ActivityType } from '../activity/activity.entity';
import { MembershipLookup } from '../authorization/authorization.service';
import { WorkItem } from '../work-items/work-item.entity';
import { NotificationRepository, NotificationType } from './notification.entity';

export const ACTIVITY_RECORDED_JOB = 'activity.recorded';

export interface DispatcherWorkItems {
  findById(id: string): Promise<WorkItem | null>;
}
export interface DispatcherUsers {
  findByIdInternal(id: string): Promise<{ name: string; role: string } | null>;
}

const STATUS_LABEL: Record<string, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In Progress',
  BLOCKED: 'Blocked',
  IN_REVIEW: 'In Review',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};

interface Planned {
  userId: string;
  type: NotificationType;
  message: string;
}

/**
 * Turns activity entries into per-user notifications. Runs as a background job.
 *
 * Rules (the actor is never notified about their own action, and nobody is
 * notified about an item they cannot see):
 *  - assigned to you / unassigned from you
 *  - status changed on an item you own or reported
 *  - comment on an item you own or reported
 *  - your edit lock was force-released
 *
 * It is safe to run more than once for the same entry (at-least-once delivery):
 * the repository ignores duplicates.
 */
export class NotificationDispatcher {
  constructor(
    private readonly repo: NotificationRepository,
    private readonly workItems: DispatcherWorkItems,
    private readonly users: DispatcherUsers,
    private readonly memberships: MembershipLookup,
  ) {}

  async handle(entry: ActivityEntry): Promise<void> {
    const item = await this.workItems.findById(entry.workItemId);
    if (!item) return;

    const actor = await this.users.findByIdInternal(entry.actorId);
    const actorName = actor?.name ?? null;
    const who = actorName ?? 'Someone';

    const planned = this.plan(entry, item, who);
    const seen = new Set<string>();
    for (const p of planned) {
      if (p.userId === entry.actorId) continue;
      const key = `${p.userId}|${p.type}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!(await this.canView(p.userId, item.teamId))) continue;

      await this.repo.create({
        userId: p.userId,
        type: p.type,
        activityId: entry.id,
        workItemId: item.id,
        workItemKey: item.key,
        workItemTitle: item.title,
        actorId: entry.actorId,
        actorName,
        message: p.message,
        createdAt: entry.createdAt,
      });
    }
  }

  private plan(entry: ActivityEntry, item: WorkItem, who: string): Planned[] {
    const key = item.key;
    const change = (field: string) => entry.changes.find((c) => c.field === field);
    const planned: Planned[] = [];

    switch (entry.type) {
      case ActivityType.CREATED: {
        const assignee = change('assigneeId')?.to;
        if (typeof assignee === 'string') {
          planned.push({ userId: assignee, type: NotificationType.ASSIGNED, message: `${who} assigned ${key} to you` });
        }
        break;
      }
      case ActivityType.UPDATED: {
        const assignee = change('assigneeId');
        const notifiedForAssignment = new Set<string>();
        if (assignee) {
          if (typeof assignee.to === 'string') {
            planned.push({ userId: assignee.to, type: NotificationType.ASSIGNED, message: `${who} assigned ${key} to you` });
            notifiedForAssignment.add(assignee.to);
          }
          if (typeof assignee.from === 'string' && assignee.from !== assignee.to) {
            planned.push({ userId: assignee.from, type: NotificationType.UNASSIGNED, message: `${who} unassigned you from ${key}` });
            notifiedForAssignment.add(assignee.from);
          }
        }
        const status = change('status');
        if (status) {
          const label = STATUS_LABEL[String(status.to)] ?? String(status.to);
          for (const userId of [item.assigneeId, item.createdBy]) {
            // someone just told about their assignment does not also need the status ping
            if (userId && !notifiedForAssignment.has(userId)) {
              planned.push({ userId, type: NotificationType.STATUS_CHANGED, message: `${who} moved ${key} to ${label}` });
            }
          }
        }
        break;
      }
      case ActivityType.COMMENT_ADDED:
        for (const userId of [item.assigneeId, item.createdBy]) {
          if (userId) planned.push({ userId, type: NotificationType.COMMENT_ADDED, message: `${who} commented on ${key}` });
        }
        break;
      case ActivityType.LOCK_FORCE_RELEASED: {
        const holder = entry.metadata.previousHolderId;
        if (typeof holder === 'string') {
          planned.push({ userId: holder, type: NotificationType.LOCK_FORCE_RELEASED, message: `${who} released your edit lock on ${key}` });
        }
        break;
      }
      default:
        break;
    }
    return planned;
  }

  private async canView(userId: string, teamId: string): Promise<boolean> {
    const user = await this.users.findByIdInternal(userId);
    if (!user) return false;
    if (user.role === 'ADMIN') return true;
    return (await this.memberships.findMember(teamId, userId)) !== null;
  }
}
