import { Comment as CommentRow, PrismaClient } from '../../shared/db/prisma';
import {
  Comment,
  CommentPage,
  CommentQuery,
  CommentRepository,
  CreateCommentInput,
} from './comment.entity';

const toComment = (row: CommentRow): Comment => ({
  id: row.id,
  workItemId: row.workItemId,
  authorId: row.authorId,
  body: row.body,
  createdAt: row.createdAt,
});

/** PostgreSQL-backed comments. Insert-only; listed by creation order (`seq`). */
export class PrismaCommentRepository implements CommentRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(input: CreateCommentInput): Promise<Comment> {
    return toComment(await this.db.comment.create({ data: input }));
  }

  async list(query: CommentQuery): Promise<CommentPage> {
    const where = { workItemId: query.workItemId };
    const [totalCount, rows] = await this.db.$transaction([
      this.db.comment.count({ where }),
      this.db.comment.findMany({
        where,
        orderBy: { seq: query.order },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return { items: rows.map(toComment), totalCount };
  }
}
