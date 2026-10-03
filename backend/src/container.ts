import { InMemoryUserRepository, UserService } from './modules/users/index';
import { AuthService, InMemorySessionStore, SessionStore } from './modules/auth/index';
import { AuthorizationService } from './modules/authorization/index';
import { InMemoryTeamRepository, TeamService } from './modules/teams/index';
import { InMemoryWorkItemRepository, WorkItemService } from './modules/work-items/index';
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
  teamRepository: InMemoryTeamRepository;
  authorizationService: AuthorizationService;
  teamService: TeamService;
  workItemRepository: InMemoryWorkItemRepository;
  workItemService: WorkItemService;
}

export function createContainer(config: Config): AppContainer {
  const userRepository = new InMemoryUserRepository();
  const userService = new UserService(userRepository);
  const sessionStore = new InMemorySessionStore();
  const authService = new AuthService(userService, {
    jwtSecret: config.JWT_SECRET,
    jwtExpiresIn: config.JWT_EXPIRES_IN,
  }, sessionStore);

  const teamRepository = new InMemoryTeamRepository();
  const authorizationService = new AuthorizationService(teamRepository);
  const teamService = new TeamService(teamRepository, userService, authorizationService);

  const workItemRepository = new InMemoryWorkItemRepository();
  const workItemService = new WorkItemService(workItemRepository, teamRepository, authorizationService);

  return {
    userRepository,
    userService,
    sessionStore,
    authService,
    teamRepository,
    authorizationService,
    teamService,
    workItemRepository,
    workItemService,
  };
}
