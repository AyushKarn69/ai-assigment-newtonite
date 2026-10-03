import { InMemoryUserRepository, UserRepository, UserService } from './modules/users/index';
import { PrismaUserRepository } from './modules/users/user.prisma-repository';
import { AuthService, InMemorySessionStore, LoginThrottle, SessionStore } from './modules/auth/index';
import { AuthorizationService } from './modules/authorization/index';
import { ActivityRepository, ActivityService, InMemoryActivityRepository } from './modules/activity/index';
import { PrismaActivityRepository } from './modules/activity/activity.prisma-repository';
import { CommentRepository, CommentService, InMemoryCommentRepository } from './modules/comments/index';
import { PrismaCommentRepository } from './modules/comments/comment.prisma-repository';
import { DashboardService } from './modules/dashboard/index';
import {
  ACTIVITY_RECORDED_JOB,
  InMemoryNotificationRepository,
  NotificationDispatcher,
  NotificationRepository,
  NotificationService,
} from './modules/notifications/index';
import { PrismaNotificationRepository } from './modules/notifications/notification.prisma-repository';
import { InMemoryJobQueue, JobQueue } from './shared/queue/index';
import { IdempotencyStore, InMemoryIdempotencyStore } from './shared/idempotency/index';
import { InMemoryTeamRepository, TeamRepository, TeamService } from './modules/teams/index';
import { PrismaTeamRepository } from './modules/teams/team.prisma-repository';
import {
  InMemoryWorkItemLockStore,
  InMemoryWorkItemRepository,
  InMemoryWorkItemTransactions,
  WorkItemLockService,
  WorkItemLockStore,
  WorkItemRepository,
  WorkItemService,
  WorkItemTransactions,
} from './modules/work-items/index';
import { PrismaWorkItemLockStore } from './modules/work-items/work-item-lock.prisma-store';
import { PrismaWorkItemRepository } from './modules/work-items/work-item.prisma-repository';
import { PrismaWorkItemTransactions } from './modules/work-items/work-item.prisma-transactions';
import { PrismaClient, getPrismaClient } from './shared/db/prisma';
import { Clock, systemClock } from './shared/utils/clock';
import { Config } from './config';

/**
 * Application dependency container.
 *
 * Composes all services with their dependencies via constructor injection. The only place
 * that knows which persistence is in use: with a database configured, the Prisma
 * repositories are plugged in behind the same interfaces the services already depend on;
 * without one, the in-memory implementations are used. Services never import Prisma.
 */
export interface AppContainer {
  persistence: 'postgres' | 'memory';
  userRepository: UserRepository;
  userService: UserService;
  sessionStore: SessionStore;
  authService: AuthService;
  teamRepository: TeamRepository;
  authorizationService: AuthorizationService;
  teamService: TeamService;
  workItemRepository: WorkItemRepository;
  workItemTransactions: WorkItemTransactions;
  workItemService: WorkItemService;
  workItemLockStore: WorkItemLockStore;
  workItemLockService: WorkItemLockService;
  activityRepository: ActivityRepository;
  activityService: ActivityService;
  commentRepository: CommentRepository;
  commentService: CommentService;
  dashboardService: DashboardService;
  clock: Clock;
  idempotencyStore: IdempotencyStore;
  jobQueue: JobQueue;
  notificationRepository: NotificationRepository;
  notificationService: NotificationService;
}

export interface ContainerOptions {
  /** Time source; override in tests to control lock expiry. */
  clock?: Clock;
  /** Background job queue; defaults to the in-memory queue. */
  jobQueue?: JobQueue;
  /**
   * Database client. Omit to use `config.DATABASE_URL` (in-memory storage if that is unset);
   * pass `null` to force in-memory storage.
   */
  prisma?: PrismaClient | null;
}

export function createContainer(config: Config, options: ContainerOptions = {}): AppContainer {
  const clock = options.clock ?? systemClock;
  const prisma =
    options.prisma === undefined
      ? config.DATABASE_URL
        ? getPrismaClient(config.DATABASE_URL)
        : null
      : options.prisma;

  const userRepository: UserRepository = prisma ? new PrismaUserRepository(prisma) : new InMemoryUserRepository();
  const userService = new UserService(userRepository);
  const sessionStore = new InMemorySessionStore(clock);
  const authService = new AuthService(
    userService,
    { jwtSecret: config.JWT_SECRET, jwtExpiresIn: config.JWT_EXPIRES_IN },
    sessionStore,
    new LoginThrottle(clock),
  );
  const idempotencyStore = new InMemoryIdempotencyStore();

  const teamRepository: TeamRepository = prisma ? new PrismaTeamRepository(prisma) : new InMemoryTeamRepository();
  const authorizationService = new AuthorizationService(teamRepository);
  const teamService = new TeamService(teamRepository, userService, authorizationService);

  const workItemRepository: WorkItemRepository = prisma
    ? new PrismaWorkItemRepository(prisma)
    : new InMemoryWorkItemRepository();
  const jobQueue = options.jobQueue ?? new InMemoryJobQueue({ maxAttempts: 3, backoffMs: 250 });

  const activityRepository: ActivityRepository = prisma
    ? new PrismaActivityRepository(prisma)
    : new InMemoryActivityRepository();
  const activityService = new ActivityService(
    activityRepository,
    workItemRepository,
    authorizationService,
    userService,
    clock,
    { publish: (entry) => jobQueue.enqueue(ACTIVITY_RECORDED_JOB, entry) },
  );

  // Notifications are produced in the background from recorded activity
  const notificationRepository: NotificationRepository = prisma
    ? new PrismaNotificationRepository(prisma)
    : new InMemoryNotificationRepository();
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

  const commentRepository: CommentRepository = prisma
    ? new PrismaCommentRepository(prisma)
    : new InMemoryCommentRepository();
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

  const workItemLockStore: WorkItemLockStore = prisma
    ? new PrismaWorkItemLockStore(prisma)
    : new InMemoryWorkItemLockStore();
  const workItemLockService = new WorkItemLockService(
    workItemLockStore,
    workItemRepository,
    authorizationService,
    clock,
    config.LOCK_TIMEOUT_MINUTES * 60_000,
    activityService,
  );
  const workItemTransactions: WorkItemTransactions = prisma
    ? new PrismaWorkItemTransactions(prisma)
    : new InMemoryWorkItemTransactions(workItemRepository, activityRepository, workItemLockStore);
  const workItemService = new WorkItemService(
    workItemRepository,
    teamRepository,
    authorizationService,
    workItemLockService,
    activityService,
    workItemTransactions,
    clock,
  );

  return {
    persistence: prisma ? 'postgres' : 'memory',
    userRepository,
    userService,
    sessionStore,
    authService,
    teamRepository,
    authorizationService,
    teamService,
    workItemRepository,
    workItemTransactions,
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
