import { ActivityRecorder, UserLookup, WorkItemLookup } from '../activity/activity.service';
import { ActivityType } from '../activity/activity.entity';
import { AuthorizationService } from '../authorization/authorization.service';
import { NotFoundError } from '../../shared/errors/index';
import { AuthenticatedUser } from '../../shared/types/auth';
import { Clock } from '../../shared/utils/clock';
import { Comment, CommentQuery, CommentRepository } from './comment.entity';

export interface CommentView extends Comment {
  authorName: string | null;
}

export interface CommentViewPage {
  items: CommentView[];
  totalCount: number;
}

export type ListCommentsCommand = Omit<CommentQuery, 'workItemId'>;

export class CommentService {
  constructor(
    private readonly repo: CommentRepository,
    private readonly workItems: WorkItemLookup,
    private readonly authorization: AuthorizationService,
    private readonly users: UserLookup,
    private readonly activity: ActivityRecorder,
    private readonly clock: Clock,
  ) {}

  /** Team member (or admin). Commenting does not need the edit lock and works on closed items. */
  async add(actor: AuthenticatedUser, workItemId: string, body: string): Promise<CommentView> {
    await this.authorizeMember(actor, workItemId);

    const comment = await this.repo.create({
      workItemId,
      authorId: actor.id,
      body,
      createdAt: this.clock.now(),
    });
    await this.activity.record({
      workItemId,
      type: ActivityType.COMMENT_ADDED,
      actorId: actor.id,
      metadata: { commentId: comment.id },
    });
    return (await this.enrich([comment]))[0];
  }

  /** Team member (or admin). */
  async list(
    actor: AuthenticatedUser,
    workItemId: string,
    command: ListCommentsCommand,
  ): Promise<CommentViewPage> {
    await this.authorizeMember(actor, workItemId);
    const page = await this.repo.list({ ...command, workItemId });
    return { items: await this.enrich(page.items), totalCount: page.totalCount };
  }

  private async authorizeMember(actor: AuthenticatedUser, workItemId: string): Promise<void> {
    const item = await this.workItems.findById(workItemId);
    if (!item) throw new NotFoundError('Work item not found', 'WORK_ITEM_NOT_FOUND');
    await this.authorization.assertTeamMember(actor, item.teamId);
  }

  private async enrich(comments: Comment[]): Promise<CommentView[]> {
    const names = new Map<string, string | null>();
    for (const authorId of new Set(comments.map((c) => c.authorId))) {
      names.set(authorId, (await this.users.findByIdInternal(authorId))?.name ?? null);
    }
    return comments.map((c) => ({ ...c, authorName: names.get(c.authorId) ?? null }));
  }
}
