import '../config'; // loads backend/.env so TEST_DATABASE_URL is available
import { PrismaClient, getPrismaClient } from '../shared/db/prisma';

/** True when the suite should run against PostgreSQL (`npm run test:db`). */
export const dbTestsEnabled = (): boolean => Boolean(process.env.DB_TESTS && process.env.TEST_DATABASE_URL);

/** True when a test database is configured at all (used to skip database-only tests). */
export const testDatabaseUrl = (): string | undefined => process.env.TEST_DATABASE_URL;

export function testPrisma(): PrismaClient {
  const url = testDatabaseUrl();
  if (!url) throw new Error('TEST_DATABASE_URL is not set');
  return getPrismaClient(url);
}

/** Empty every table. Never points at anything but the test database. */
export async function resetDatabase(): Promise<void> {
  await testPrisma().$executeRawUnsafe(
    'TRUNCATE TABLE "Notification", "Comment", "Activity", "WorkItemLock", "WorkItem", "TeamMember", "Team", "User" CASCADE',
  );
}
