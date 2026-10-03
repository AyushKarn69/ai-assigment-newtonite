/**
 * Application error hierarchy.
 *
 * All business / application errors extend AppError.
 * Controllers use the statusCode to determine the HTTP response.
 */

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;

  constructor(
    message: string,
    statusCode: number,
    code: string,
    isOperational = true,
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad request', code = 'BAD_REQUEST') {
    super(message, 400, code);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized', code = 'UNAUTHORIZED') {
    super(message, 401, code);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden', code = 'FORBIDDEN') {
    super(message, 403, code);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found', code = 'NOT_FOUND') {
    super(message, 404, code);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict', code = 'CONFLICT') {
    super(message, 409, code);
  }
}

export class UnprocessableEntityError extends AppError {
  constructor(message = 'Unprocessable entity', code = 'UNPROCESSABLE_ENTITY') {
    super(message, 422, code);
  }
}

export class LockedError extends AppError {
  public readonly lockInfo?: {
    lockedBy: string;
    expiresAt: string;
  };

  constructor(
    message = 'Resource is locked',
    code = 'RESOURCE_LOCKED',
    lockInfo?: { lockedBy: string; expiresAt: string },
  ) {
    super(message, 423, code);
    this.lockInfo = lockInfo;
  }
}

export class IdempotencyConflictError extends AppError {
  constructor(message = 'Idempotency key conflict', code = 'IDEMPOTENCY_CONFLICT') {
    super(message, 409, code);
  }
}

export class InternalError extends AppError {
  constructor(message = 'Internal server error', code = 'INTERNAL_ERROR') {
    super(message, 500, code, false);
  }
}
