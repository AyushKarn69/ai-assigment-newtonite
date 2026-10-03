export interface Comment {
  id: string;
  workItemId: string;
  authorId: string;
  body: string;
  createdAt: Date;
}

export interface CreateCommentInput {
  workItemId: string;
  authorId: string;
  body: string;
  createdAt: Date;
}

export interface CommentQuery {
  workItemId: string;
  /** By creation order: 'asc' = oldest first. */
  order: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

export interface CommentPage {
  items: Comment[];
  totalCount: number;
}

/**
 * Append-only comment storage (comments cannot be edited or deleted).
 * Implemented in-memory now; a Prisma implementation will replace it later.
 */
export interface CommentRepository {
  create(input: CreateCommentInput): Promise<Comment>;
  list(query: CommentQuery): Promise<CommentPage>;
}
