import { describe, it, expect } from 'vitest';
import { successResponse, errorResponse } from './api-response';

describe('ApiResponse', () => {
  it('SETUP-012: successResponse wraps data correctly', () => {
    const response = successResponse({ id: '1', name: 'test' });

    expect(response.success).toBe(true);
    expect(response.data).toEqual({ id: '1', name: 'test' });
    expect(response.error).toBeUndefined();
  });

  it('SETUP-013: successResponse includes pagination meta', () => {
    const meta = {
      page: 1,
      pageSize: 20,
      totalCount: 100,
      totalPages: 5,
      hasNext: true,
      hasPrev: false,
    };

    const response = successResponse([1, 2, 3], meta);

    expect(response.success).toBe(true);
    expect(response.meta).toEqual(meta);
  });

  it('SETUP-014: errorResponse wraps error correctly', () => {
    const response = errorResponse('NOT_FOUND', 'Work item not found');

    expect(response.success).toBe(false);
    expect(response.error?.code).toBe('NOT_FOUND');
    expect(response.error?.message).toBe('Work item not found');
    expect(response.data).toBeUndefined();
  });

  it('SETUP-015: errorResponse includes details', () => {
    const details = [{ path: 'title', message: 'Required' }];
    const response = errorResponse('VALIDATION_ERROR', 'Validation failed', details);

    expect(response.error?.details).toEqual(details);
  });
});
