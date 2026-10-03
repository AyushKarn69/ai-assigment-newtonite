import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestConfig, resetConfig } from './config';

describe('Config', () => {
  beforeEach(() => {
    resetConfig();
  });

  afterEach(() => {
    resetConfig();
  });

  it('SETUP-001: createTestConfig returns valid defaults', () => {
    const config = createTestConfig();

    expect(config.PORT).toBe(3000);
    expect(config.HOST).toBe('0.0.0.0');
    expect(config.NODE_ENV).toBe('test');
    expect(config.LOG_LEVEL).toBe('error');
    expect(config.JWT_SECRET).toBeDefined();
    expect(config.JWT_SECRET.length).toBeGreaterThanOrEqual(16);
    expect(config.LOCK_TIMEOUT_MINUTES).toBe(30);
  });

  it('SETUP-002: createTestConfig accepts overrides', () => {
    const config = createTestConfig({ PORT: 4000, LOG_LEVEL: 'debug' });

    expect(config.PORT).toBe(4000);
    expect(config.LOG_LEVEL).toBe('debug');
    expect(config.NODE_ENV).toBe('test'); // unchanged default
  });

  it('SETUP-003: config is frozen (immutable)', () => {
    const config = createTestConfig();

    expect(() => {
      (config as Record<string, unknown>).PORT = 9999;
    }).toThrow();
  });
});
