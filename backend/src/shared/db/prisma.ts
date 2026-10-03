import { Prisma, PrismaClient } from '@prisma/client';

export { Prisma, PrismaClient };
export type {
  Activity,
  Comment,
  Notification,
  Team,
  TeamMember,
  User,
  WorkItem,
  WorkItemLock,
} from '@prisma/client';
export type TransactionClient = Prisma.TransactionClient;

/** One client (connection pool) per database URL for the whole process. */
const clients = new Map<string, PrismaClient>();

export function getPrismaClient(url: string): PrismaClient {
  let client = clients.get(url);
  if (!client) {
    client = new PrismaClient({ datasources: { db: { url } }, log: ['error'] });
    clients.set(url, client);
  }
  return client;
}

/** Close every connection pool (call on shutdown). */
export async function disconnectPrisma(): Promise<void> {
  const open = [...clients.values()];
  clients.clear();
  await Promise.all(open.map((client) => client.$disconnect()));
}

/** True when a Prisma call failed because of a unique-constraint violation. */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** True when a Prisma call failed because the record to update/delete does not exist. */
export function isRecordNotFound(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';
}
