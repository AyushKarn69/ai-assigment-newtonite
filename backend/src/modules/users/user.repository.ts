import { randomUUID } from 'node:crypto';
import { User, UserRepository, CreateUserInput } from './user.entity';

/**
 * In-memory user repository for the pre-database phase.
 * Will be replaced by PrismaUserRepository in the database phase.
 */
export class InMemoryUserRepository implements UserRepository {
  private users: Map<string, User> = new Map();
  private emailIndex: Map<string, string> = new Map(); // email -> id

  async findById(id: string): Promise<User | null> {
    return this.users.get(id) ?? null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const id = this.emailIndex.get(email.toLowerCase());
    if (!id) return null;
    return this.users.get(id) ?? null;
  }

  async create(input: CreateUserInput & { passwordHash: string }): Promise<User> {
    const id = randomUUID();
    const now = new Date();
    const user: User = {
      id,
      email: input.email.toLowerCase(),
      name: input.name,
      passwordHash: input.passwordHash,
      role: input.role ?? 'USER',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    this.users.set(id, user);
    this.emailIndex.set(user.email, id);
    return user;
  }

  async update(id: string, data: Partial<Omit<User, 'id' | 'createdAt'>>): Promise<User> {
    const existing = this.users.get(id);
    if (!existing) throw new Error(`User not found: ${id}`);
    const updated: User = {
      ...existing,
      ...data,
      updatedAt: new Date(),
    };
    this.users.set(id, updated);
    if (data.email) {
      this.emailIndex.delete(existing.email);
      this.emailIndex.set(data.email.toLowerCase(), id);
    }
    return updated;
  }

  async findAll(): Promise<User[]> {
    return Array.from(this.users.values());
  }

  /** Test helper — reset all data */
  clear(): void {
    this.users.clear();
    this.emailIndex.clear();
  }
}
