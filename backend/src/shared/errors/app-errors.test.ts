import { describe, it, expect } from 'vitest';
import {
  AppError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  LockedError,
  InternalError,
} from './app-errors';

describe('AppErrors', () => {
  it('SETUP-004: AppError has correct properties', () => {
    const error = new AppError('test message', 400, 'TEST_CODE');

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(AppError);
    expect(error.message).toBe('test message');
    expect(error.statusCode).toBe(400);
    expect(error.code).toBe('TEST_CODE');
    expect(error.isOperational).toBe(true);
  });

  it('SETUP-005: BadRequestError defaults', () => {
    const error = new BadRequestError();
    expect(error.statusCode).toBe(400);
    expect(error.code).toBe('BAD_REQUEST');
  });

  it('SETUP-006: UnauthorizedError defaults', () => {
    const error = new UnauthorizedError();
    expect(error.statusCode).toBe(401);
    expect(error.code).toBe('UNAUTHORIZED');
  });

  it('SETUP-007: ForbiddenError defaults', () => {
    const error = new ForbiddenError();
    expect(error.statusCode).toBe(403);
    expect(error.code).toBe('FORBIDDEN');
  });

  it('SETUP-008: NotFoundError defaults', () => {
    const error = new NotFoundError();
    expect(error.statusCode).toBe(404);
    expect(error.code).toBe('NOT_FOUND');
  });

  it('SETUP-009: ConflictError defaults', () => {
    const error = new ConflictError();
    expect(error.statusCode).toBe(409);
    expect(error.code).toBe('CONFLICT');
  });

  it('SETUP-010: LockedError with lock info', () => {
    const lockInfo = { lockedBy: 'user-1', expiresAt: '2026-01-01T00:00:00Z' };
    const error = new LockedError('Locked', 'WORK_ITEM_LOCKED', lockInfo);

    expect(error.statusCode).toBe(423);
    expect(error.code).toBe('WORK_ITEM_LOCKED');
    expect(error.lockInfo).toEqual(lockInfo);
  });

  it('SETUP-011: InternalError is not operational', () => {
    const error = new InternalError();
    expect(error.statusCode).toBe(500);
    expect(error.isOperational).toBe(false);
  });
});
