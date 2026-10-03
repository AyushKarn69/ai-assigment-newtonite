import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { AppError, LockedError, TooManyRequestsError } from '../errors/index';
import { errorResponse } from '../types/index';

/**
 * Global Fastify error handler.
 *
 * Translates known error types into consistent API responses.
 * Never leaks stack traces in production.
 * Uses the Fastify request logger instead of creating a module-level logger.
 */
export function globalErrorHandler(
  error: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  // Zod validation errors (use duck-typing to handle cross-module loading)
  if (error.name === 'ZodError' && 'issues' in error) {
    const zodErr = error as { issues: Array<{ path: (string | number)[]; message: string }> };
    const details = zodErr.issues.map((e) => ({
      path: e.path.join('.'),
      message: e.message,
    }));

    reply.status(400).send(
      errorResponse('VALIDATION_ERROR', 'Request validation failed', details),
    );
    return;
  }

  // Application errors
  if (error instanceof AppError) {
    request.log.warn(
      { code: error.code, statusCode: error.statusCode, path: request.url },
      error.message,
    );

    const response = errorResponse(error.code, error.message);

    // Attach lock info if present
    if (error instanceof LockedError && error.lockInfo) {
      (response.error as unknown as Record<string, unknown>).lockInfo = error.lockInfo;
    }

    if (error instanceof TooManyRequestsError && error.retryAfterSeconds !== undefined) {
      reply.header('retry-after', String(error.retryAfterSeconds));
    }

    reply.status(error.statusCode).send(response);
    return;
  }

  // Fastify validation / schema errors
  if ('statusCode' in error && typeof error.statusCode === 'number' && error.statusCode < 500) {
    reply.status(error.statusCode).send(
      errorResponse('REQUEST_ERROR', error.message),
    );
    return;
  }

  // Unknown / internal errors
  request.log.error({ err: error, path: request.url }, 'Unhandled error');

  reply.status(500).send(
    errorResponse(
      'INTERNAL_ERROR',
      process.env.NODE_ENV === 'production'
        ? 'Internal server error'
        : error.message || 'Internal server error',
    ),
  );
}
