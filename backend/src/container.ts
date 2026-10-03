import { InMemoryUserRepository, UserService } from './modules/users/index';
import { AuthService, InMemorySessionStore, SessionStore } from './modules/auth/index';
import { AuthorizationService } from './modules/authorization/index';
import { ActivityService, InMemoryActivityRepository } from './modules/activity/index';
import { InMemoryTeamRepository, TeamService } from './modules/teams/index';
import {
  InMemoryWorkItemLockStore,
  InMemoryWorkItemRepository,
  WorkItemLockService,
  WorkItemService,
} from './modules/work-items/index';
import { Clock, systemClock } from './shared/utils/clock';
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
  workItemLockStore: InMemoryWorkItemLockStore;
  workItemLockService: WorkItemLockService;
  activityRepository: InMemoryActivityRepository;
  activityService: ActivityService;
}

export interface ContainerOptions {
  /** Time source; override in tests to control lock expiry. */
  clock?: Clock;
}

export function createContainer(config: Config, options: ContainerOptions = {}): AppContainer {
  const clock = options.clock ?? systemClock;
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
  const activityRepository = new InMemoryActivityRepository();
  const activityService = new ActivityService(
    activityRepository,
    workItemRepository,
    authorizationService,
    userService,
    clock,
  );

  const workItemLockStore = new InMemoryWorkItemLockStore();
  const workItemLockService = new WorkItemLockService(
    workItemLockStore,
    workItemRepository,
    authorizationService,
    clock,
    config.LOCK_TIMEOUT_MINUTES * 60_000,
    activityService,
  );
  const workItemService = new WorkItemService(
    workItemRepository,
    teamRepository,
    authorizationService,
    workItemLockService,
    activityService,
  );

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
    workItemLockStore,
    workItemLockService,
    activityRepository,
    activityService,
  };
}
