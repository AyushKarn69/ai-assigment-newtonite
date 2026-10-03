import { describe, it, expect, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';
import { InMemoryUserRepository } from './user.repository';
import { UserService } from './user.service';
import { ConflictError, NotFoundError } from '../../shared/errors/index';

describe('UserService', () => {
  let repo: InMemoryUserRepository;
  let service: UserService;

  const input = { email: 'Alice@Example.com', name: 'Alice', password: 'correct-horse-battery' };

  beforeEach(() => {
    repo = new InMemoryUserRepository();
    service = new UserService(repo);
  });

  it('USER-001: createUser returns the user without a password hash', async () => {
    const user = await service.createUser(input);

    expect(user.id).toBeTruthy();
    expect(user.name).toBe('Alice');
    expect(user.role).toBe('USER');
    expect(user.isActive).toBe(true);
    expect(user).not.toHaveProperty('passwordHash');
    expect(user).not.toHaveProperty('password');
  });

  it('USER-002: createUser stores a bcrypt hash, never the plain password', async () => {
    const user = await service.createUser(input);
    const stored = await repo.findById(user.id);

    expect(stored!.passwordHash).not.toBe(input.password);
    expect(await bcrypt.compare(input.password, stored!.passwordHash)).toBe(true);
  });

  it('USER-003: email is normalised to lowercase and lookup is case-insensitive', async () => {
    const user = await service.createUser(input);

    expect(user.email).toBe('alice@example.com');
    expect((await service.findByEmail('ALICE@EXAMPLE.COM'))?.id).toBe(user.id);
  });

  it('USER-004: createUser rejects a duplicate email regardless of case', async () => {
    await service.createUser(input);

    await expect(
      service.createUser({ ...input, email: 'alice@example.com' }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('USER-005: createUser honours an explicit role', async () => {
    const user = await service.createUser({ ...input, role: 'ADMIN' });
    expect(user.role).toBe('ADMIN');
  });

  it('USER-006: findById returns the user without password hash', async () => {
    const created = await service.createUser(input);
    const found = await service.findById(created.id);

    expect(found.id).toBe(created.id);
    expect(found).not.toHaveProperty('passwordHash');
  });

  it('USER-007: findById throws NotFoundError for an unknown id', async () => {
    await expect(service.findById('missing')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('USER-008: findByIdInternal returns null for an unknown id', async () => {
    expect(await service.findByIdInternal('missing')).toBeNull();
  });
});

describe('InMemoryUserRepository', () => {
  it('USER-009: update merges fields, bumps updatedAt and re-indexes email', async () => {
    const repo = new InMemoryUserRepository();
    const created = await repo.create({
      email: 'a@example.com',
      name: 'A',
      password: 'unused',
      passwordHash: 'hash',
    });

    await new Promise((resolve) => setTimeout(resolve, 5));
    const updated = await repo.update(created.id, { name: 'B', email: 'b@example.com' });

    expect(updated.name).toBe('B');
    expect(updated.updatedAt.getTime()).toBeGreaterThan(created.updatedAt.getTime());
    expect(await repo.findByEmail('a@example.com')).toBeNull();
    expect((await repo.findByEmail('b@example.com'))?.id).toBe(created.id);
  });

  it('USER-010: update throws for an unknown id', async () => {
    const repo = new InMemoryUserRepository();
    await expect(repo.update('missing', { name: 'X' })).rejects.toThrow('User not found');
  });

  it('USER-011: clear removes all users', async () => {
    const repo = new InMemoryUserRepository();
    await repo.create({ email: 'a@example.com', name: 'A', password: 'x', passwordHash: 'h' });
    repo.clear();

    expect(await repo.findAll()).toHaveLength(0);
    expect(await repo.findByEmail('a@example.com')).toBeNull();
  });
});
