import { beforeAll } from 'vitest';
import { dbTestsEnabled, resetDatabase } from './db';

// In database mode every test file starts from empty tables (files run one at a time).
beforeAll(async () => {
  if (dbTestsEnabled()) await resetDatabase();
});
