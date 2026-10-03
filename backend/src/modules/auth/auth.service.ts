import bcrypt from 'bcryptjs';
import jwt, { SignOptions } from 'jsonwebtoken';
import { UserService } from '../users/user.service';
import { UnauthorizedError } from '../../shared/errors/index';
import { AuthenticatedUser, GlobalRole } from '../../shared/types/auth';

export interface AuthConfig {
  jwtSecret: string;
  jwtExpiresIn: string;
}

export interface LoginInput {
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
  private invalidatedTokens: Set<string> = new Set();

  async invalidate(token: string, _expiresInSeconds: number): Promise<void> {
    this.invalidatedTokens.add(token);
  }

  async isInvalidated(token: string): Promise<boolean> {
    return this.invalidatedTokens.has(token);
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
  ) {}

  async login(input: LoginInput): Promise<LoginResult> {
    const user = await this.userService.findByEmail(input.email);
    if (!user) {
      throw new UnauthorizedError('Invalid email or password', 'INVALID_CREDENTIALS');
    }

    if (!user.isActive) {
      throw new UnauthorizedError('Account is disabled', 'ACCOUNT_DISABLED');
    }

    const isPasswordValid = await bcrypt.compare(input.password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedError('Invalid email or password', 'INVALID_CREDENTIALS');
    }

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
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
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

      return {
        id: payload.sub,
        email: payload.email,
        role: payload.role,
      };
    } catch (error) {
      if (error instanceof UnauthorizedError) throw error;
      throw new UnauthorizedError('Invalid or expired token', 'INVALID_TOKEN');
    }
  }
}
