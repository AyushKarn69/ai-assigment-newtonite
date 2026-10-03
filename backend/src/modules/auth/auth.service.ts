import bcrypt from 'bcryptjs';
import jwt, { SignOptions } from 'jsonwebtoken';
import { UserService } from '../users/user.service';
import { UnauthorizedError } from '../../shared/errors/index';
import { Clock } from '../../shared/utils/clock';
import { LoginThrottle } from './login-throttle';
import { AuthenticatedUser, GlobalRole } from '../../shared/types/auth';

export interface AuthConfig {
  jwtSecret: string;
  jwtExpiresIn: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
}

export interface LoginResult {
  token: string;
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
  };
}

export interface TokenPayload {
  sub: string;
  email: string;
  role: GlobalRole;
  iat?: number;
  exp?: number;
}

/**
 * Session store interface for token invalidation (logout).
 */
export interface SessionStore {
  /** Mark a token/jti as invalidated */
  invalidate(token: string, expiresInSeconds: number): Promise<void>;
  /** Check if a token has been invalidated */
  isInvalidated(token: string): Promise<boolean>;
}

/**
 * In-memory session store — suitable for single-instance dev/test.
 * Will be replaced by Redis-backed store for production.
 */
export class InMemorySessionStore implements SessionStore {
  private invalidatedTokens: Map<string, number> = new Map(); // token -> when it can be forgotten (ms)

  constructor(private readonly clock: Clock = { now: () => new Date() }) {}

  async invalidate(token: string, expiresInSeconds: number): Promise<void> {
    this.purgeExpired();
    // After the token's own expiry it is rejected anyway, so the entry can go.
    this.invalidatedTokens.set(token, this.clock.now().getTime() + expiresInSeconds * 1000);
  }

  async isInvalidated(token: string): Promise<boolean> {
    const forgetAt = this.invalidatedTokens.get(token);
    if (forgetAt === undefined) return false;
    if (forgetAt <= this.clock.now().getTime()) {
      this.invalidatedTokens.delete(token);
      return false;
    }
    return true;
  }

  private purgeExpired(): void {
    const now = this.clock.now().getTime();
    for (const [token, forgetAt] of this.invalidatedTokens) {
      if (forgetAt <= now) this.invalidatedTokens.delete(token);
    }
  }

  clear(): void {
    this.invalidatedTokens.clear();
  }
}

export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly config: AuthConfig,
    private readonly sessionStore: SessionStore,
    private readonly throttle?: LoginThrottle,
  ) {}

  async login(input: LoginInput): Promise<LoginResult> {
    this.throttle?.assertAllowed(input.email);

    const user = await this.userService.findByEmail(input.email);
    if (!user) {
      this.throttle?.recordFailure(input.email);
      throw new UnauthorizedError('Invalid email or password', 'INVALID_CREDENTIALS');
    }

    if (!user.isActive) {
      throw new UnauthorizedError('Account is disabled', 'ACCOUNT_DISABLED');
    }

    const isPasswordValid = await bcrypt.compare(input.password, user.passwordHash);
    if (!isPasswordValid) {
      this.throttle?.recordFailure(input.email);
      throw new UnauthorizedError('Invalid email or password', 'INVALID_CREDENTIALS');
    }
    this.throttle?.recordSuccess(input.email);
    return this.issueSession(user);
  }

  /**
   * Self-service sign-up. The new account is ALWAYS a plain user (never an administrator,
   * whatever the caller sends) and belongs to no team until a manager adds it. The person is
   * signed in straight away.
   */
  async register(input: RegisterInput): Promise<LoginResult> {
    const user = await this.userService.createUser({
      email: input.email,
      name: input.name,
      password: input.password,
      role: 'USER',
    });
    return this.issueSession(user);
  }

  private issueSession(user: { id: string; email: string; name: string; role: string }): LoginResult {
    const payload: TokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role as GlobalRole,
    };

    const token = jwt.sign(payload, this.config.jwtSecret, {
      expiresIn: this.config.jwtExpiresIn as SignOptions['expiresIn'],
    });

    return {
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    };
  }

  async logout(token: string): Promise<void> {
    try {
      const decoded = jwt.verify(token, this.config.jwtSecret) as TokenPayload;
      const expiresIn = decoded.exp ? decoded.exp - Math.floor(Date.now() / 1000) : 3600;
      await this.sessionStore.invalidate(token, Math.max(expiresIn, 0));
    } catch {
      // Token already expired or invalid — nothing to invalidate
    }
  }

  async verifyToken(token: string): Promise<AuthenticatedUser> {
    try {
      const isInvalidated = await this.sessionStore.isInvalidated(token);
      if (isInvalidated) {
        throw new UnauthorizedError('Token has been invalidated', 'TOKEN_INVALIDATED');
      }

      const payload = jwt.verify(token, this.config.jwtSecret) as TokenPayload;

      // A valid signature is not enough: the account must still exist and be active,
      // and its *current* role applies (so demotion/disable take effect immediately).
      const user = await this.userService.findByIdInternal(payload.sub);
      if (!user) {
        throw new UnauthorizedError('Invalid or expired token', 'INVALID_TOKEN');
      }
      if (!user.isActive) {
        throw new UnauthorizedError('Account is disabled', 'ACCOUNT_DISABLED');
      }

      return {
        id: user.id,
        email: user.email,
        role: user.role as GlobalRole,
      };
    } catch (error) {
      if (error instanceof UnauthorizedError) throw error;
      throw new UnauthorizedError('Invalid or expired token', 'INVALID_TOKEN');
    }
  }
}
