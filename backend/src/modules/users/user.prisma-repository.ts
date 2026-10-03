import { PrismaClient, User as UserRow } from '../../shared/db/prisma';
import { isRecordNotFound } from '../../shared/db/prisma';
import { CreateUserInput, User, UserRepository } from './user.entity';

const toUser = (row: UserRow): User => ({
  id: row.id,
  email: row.email,
  name: row.name,
  passwordHash: row.passwordHash,
  role: row.role,
  isActive: row.isActive,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

/** PostgreSQL-backed users. Emails are stored lower-case and are unique. */
export class PrismaUserRepository implements UserRepository {
  constructor(private readonly db: PrismaClient) {}

  async findById(id: string): Promise<User | null> {
    const row = await this.db.user.findUnique({ where: { id } });
    return row ? toUser(row) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const row = await this.db.user.findUnique({ where: { email: email.toLowerCase() } });
    return row ? toUser(row) : null;
  }

  async create(input: CreateUserInput & { passwordHash: string }): Promise<User> {
    const row = await this.db.user.create({
      data: {
        email: input.email.toLowerCase(),
        name: input.name,
        passwordHash: input.passwordHash,
        role: input.role ?? 'USER',
      },
    });
    return toUser(row);
  }

  async update(id: string, data: Partial<Omit<User, 'id' | 'createdAt'>>): Promise<User> {
    try {
      const row = await this.db.user.update({
        where: { id },
        data: {
          ...(data.email !== undefined && { email: data.email.toLowerCase() }),
          ...(data.name !== undefined && { name: data.name }),
          ...(data.passwordHash !== undefined && { passwordHash: data.passwordHash }),
          ...(data.role !== undefined && { role: data.role }),
          ...(data.isActive !== undefined && { isActive: data.isActive }),
        },
      });
      return toUser(row);
    } catch (error) {
      if (isRecordNotFound(error)) throw new Error(`User not found: ${id}`);
      throw error;
    }
  }

  async findAll(): Promise<User[]> {
    return (await this.db.user.findMany({ orderBy: { createdAt: 'asc' } })).map(toUser);
  }
}
