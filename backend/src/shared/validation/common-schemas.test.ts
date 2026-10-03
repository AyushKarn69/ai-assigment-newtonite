import { describe, it, expect } from 'vitest';
import { paginationSchema, sortSchema } from './common-schemas';

describe('CommonSchemas', () => {
  it('SETUP-021: paginationSchema provides defaults', () => {
    const result = paginationSchema.parse({});
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
  });

  it('SETUP-022: paginationSchema enforces max pageSize', () => {
    expect(() => paginationSchema.parse({ pageSize: 200 })).toThrow();
  });

  it('SETUP-023: paginationSchema rejects negative page', () => {
    expect(() => paginationSchema.parse({ page: -1 })).toThrow();
  });

  it('SETUP-024: sortSchema defaults', () => {
    const result = sortSchema.parse({});
    expect(result.sortOrder).toBe('desc');
    expect(result.sortBy).toBeUndefined();
  });

  it('SETUP-025: sortSchema validates sortOrder values', () => {
    expect(() => sortSchema.parse({ sortOrder: 'invalid' })).toThrow();
    expect(sortSchema.parse({ sortOrder: 'asc' }).sortOrder).toBe('asc');
  });
});
