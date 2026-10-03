// Runs the WHOLE test suite against the PostgreSQL test database (TEST_DATABASE_URL in .env).
// Files run one at a time because they share one database and each starts from empty tables.
import { spawnSync } from 'node:child_process';

const result = spawnSync('npx', ['vitest', 'run', '--no-file-parallelism', ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, DB_TESTS: '1' },
});
process.exit(result.status ?? 1);
