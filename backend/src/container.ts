import { InMemoryUserRepository, UserService } from './modules/users/index';
import { AuthService, InMemorySessionStore, SessionStore } from './modules/auth/index';
import { Config } from './config';

/**
 * Application dependency container.
 *
 * Composes all services with their dependencies via constructor injection.
 * Keeps dependency wiring centralized and explicit.
 */
export interface AppContainer {
  userRepository: InMemoryUserRepository;
  userService: UserService;
  sessionStore: SessionStore;
  authService: AuthService;
}

export function createContainer(config: Config): AppContainer {
  const userRepository = new InMemoryUserRepository();
  const userService = new UserService(userRepository);
  const sessionStore = new InMemorySessionStore();
  const authService = new AuthService(userService, {
    jwtSecret: config.JWT_SECRET,
    jwtExpiresIn: config.JWT_EXPIRES_IN,
  }, sessionStore);

  return {
    userRepository,
    userService,
    sessionStore,
    authService,
  };
}
