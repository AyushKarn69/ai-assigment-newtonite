import { randomUUID } from 'node:crypto';
import {
  Comment,
  CommentPage,
  CommentQuery,
  CommentRepository,
  CreateCommentInput,
} from './comment.entity';

/** In-memory comment store for the pre-database phase. */
export class InMemoryCommentRepository implements CommentRepository {
  private comments: Comment[] = [];

  async create(input: CreateCommentInput): Promise<Comment> {
    const comment: Comment = { id: randomUUID(), ...input };
    this.comments.push(comment);
    return { ...comment };
  }

  async list(query: CommentQuery): Promise<CommentPage> {
    // Insertion order is creation order, which is stable even when timestamps tie.
    const matches = this.comments.filter((c) => c.workItemId === query.workItemId);
    if (query.order === 'desc') matches.reverse();

    const start = (query.page - 1) * query.pageSize;
    return {
      items: matches.slice(start, start + query.pageSize).map((c) => ({ ...c })),
      totalCount: matches.length,
    };
  }

  /** Test helper — reset all data */
  clear(): void {
    this.comments = [];
  }
}
