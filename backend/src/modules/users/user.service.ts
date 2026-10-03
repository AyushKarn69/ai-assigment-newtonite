import bcrypt from 'bcryptjs';
import { User, UserRepository, UserWithoutPassword, CreateUserInput } from './user.entity';
import { ConflictError, NotFoundError } from '../../shared/errors/index';

const SALT_ROUNDS = 12;

export class UserService {
  constructor(private readonly userRepo: UserRepository) {}

  async createUser(input: CreateUserInput): Promise<UserWithoutPassword> {
    const existing = await this.userRepo.findByEmail(input.email);
    if (existing) {
      throw new ConflictError('A user with this email already exists', 'EMAIL_ALREADY_EXISTS');
    }

    const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);
    const user = await this.userRepo.create({ ...input, passwordHash });
    return this.stripPassword(user);
  }

  async findById(id: string): Promise<UserWithoutPassword> {
    const user = await this.userRepo.findById(id);
    if (!user) {
      throw new NotFoundError('User not found', 'USER_NOT_FOUND');
    }
    return this.stripPassword(user);
  }

  async findByIdInternal(id: string): Promise<User | null> {
    return this.userRepo.findById(id);
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.userRepo.findByEmail(email);
  }

  private stripPassword(user: User): UserWithoutPassword {
    const { passwordHash, ...rest } = user;
    return rest;
  }
}
