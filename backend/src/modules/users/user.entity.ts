export type UserRole = 'ADMIN' | 'USER';

export interface User {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: UserRole;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type UserWithoutPassword = Omit<User, 'passwordHash'>;

export interface CreateUserInput {
  email: string;
  name: string;
  password: string;
  role?: UserRole;
}

/**
 * Persistence abstraction for users.
 * Implemented in-memory now; a Prisma implementation will replace it later.
 */
export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  create(input: CreateUserInput & { passwordHash: string }): Promise<User>;
  update(id: string, data: Partial<Omit<User, 'id' | 'createdAt'>>): Promise<User>;
  findAll(): Promise<User[]>;
}
