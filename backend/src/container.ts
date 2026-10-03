import { InMemoryUserRepository, UserService } from './modules/users/index';
import { AuthService, InMemorySessionStore, LoginThrottle, SessionStore } from './modules/auth/index';
import { AuthorizationService } from './modules/authorization/index';
import { ActivityService, InMemoryActivityRepository } from './modules/activity/index';
import { CommentService, InMemoryCommentRepository } from './modules/comments/index';
import { DashboardService } from './modules/dashboard/index';
import {
  ACTIVITY_RECORDED_JOB,
  InMemoryNotificationRepository,
  NotificationDispatcher,
  NotificationService,
} from './modules/notifications/index';
import { InMemoryJobQueue, JobQueue } from './shared/queue/index';
import { IdempotencyStore, InMemoryIdempotencyStore } from './shared/idempotency/index';
import { InMemoryTeamRepository, TeamService } from './modules/teams/index';
import {
  InMemoryWorkItemLockStore,
  InMemoryWorkItemRepository,
  InMemoryWorkItemTransactions,
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
  commentRepository: InMemoryCommentRepository;
  commentService: CommentService;
  dashboardService: DashboardService;
  clock: Clock;
  idempotencyStore: IdempotencyStore;
  jobQueue: JobQueue;
  notificationRepository: InMemoryNotificationRepository;
  notificationService: NotificationService;
}

export interface ContainerOptions {
  /** Time source; override in tests to control lock expiry. */
  clock?: Clock;
  /** Background job queue; defaults to the in-memory queue. */
  jobQueue?: JobQueue;
}

export function createContainer(config: Config, options: ContainerOptions = {}): AppContainer {
  const clock = options.clock ?? systemClock;
  const userRepository = new InMemoryUserRepository();
  const userService = new UserService(userRepository);
  const sessionStore = new InMemorySessionStore(clock);
  const authService = new AuthService(
    userService,
    { jwtSecret: config.JWT_SECRET, jwtExpiresIn: config.JWT_EXPIRES_IN },
    sessionStore,
    new LoginThrottle(clock),
  );
  const idempotencyStore = new InMemoryIdempotencyStore();

  const teamRepository = new InMemoryTeamRepository();
  const authorizationService = new AuthorizationService(teamRepository);
  const teamService = new TeamService(teamRepository, userService, authorizationService);

  const workItemRepository = new InMemoryWorkItemRepository();
  const jobQueue = options.jobQueue ?? new InMemoryJobQueue({ maxAttempts: 3, backoffMs: 250 });

  const activityRepository = new InMemoryActivityRepository();
  const activityService = new ActivityService(
    activityRepository,
    workItemRepository,
    authorizationService,
    userService,
    clock,
    { publish: (entry) => jobQueue.enqueue(ACTIVITY_RECORDED_JOB, entry) },
  );

  // Notifications are produced in the background from recorded activity
  const notificationRepository = new InMemoryNotificationRepository();
  const notificationDispatcher = new NotificationDispatcher(
    notificationRepository,
    workItemRepository,
    userService,
    teamRepository,
  );
  jobQueue.register(ACTIVITY_RECORDED_JOB, (entry: Parameters<NotificationDispatcher['handle']>[0]) =>
    notificationDispatcher.handle(entry),
  );
  const notificationService = new NotificationService(notificationRepository, clock);

  const commentRepository = new InMemoryCommentRepository();
  const commentService = new CommentService(
    commentRepository,
    workItemRepository,
    authorizationService,
    userService,
    activityService,
    clock,
  );

  const dashboardService = new DashboardService(
    workItemRepository,
    teamRepository,
    activityRepository,
    authorizationService,
    userService,
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
    new InMemoryWorkItemTransactions(workItemRepository, activityRepository, workItemLockStore),
    clock,
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
    commentRepository,
    commentService,
    dashboardService,
    clock,
    idempotencyStore,
    jobQueue,
    notificationRepository,
    notificationService,
  };
}
