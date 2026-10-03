import { FastifyRequest } from 'fastify';
import { z, ZodSchema } from 'zod';

/**
 * Parse and validate request body against a Zod schema.
 * Throws ZodError on failure (caught by globalErrorHandler).
 */
export function validateBody<T extends ZodSchema>(
  request: FastifyRequest,
  schema: T,
): z.infer<T> {
  return schema.parse(request.body);
}

/**
 * Parse and validate query parameters against a Zod schema.
 * Throws ZodError on failure.
 */
export function validateQuery<T extends ZodSchema>(
  request: FastifyRequest,
  schema: T,
): z.infer<T> {
  return schema.parse(request.query);
}

/**
 * Parse and validate route params against a Zod schema.
 * Throws ZodError on failure.
 */
export function validateParams<T extends ZodSchema>(
  request: FastifyRequest,
  schema: T,
): z.infer<T> {
  return schema.parse(request.params);
}
