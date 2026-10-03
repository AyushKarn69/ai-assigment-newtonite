# Newtonite Operations Management System â€” Backend Handbook

## Overview

An internal operations-management backend replacing coordination currently spread across chat, spreadsheets, email, and direct conversations. The system manages operational **Work Items** (customer issues, engineering problems, payment investigations, production incidents, compliance requests, approval tasks) with first-class concurrency, authorization, history, and consistency.

---

## Technology Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js v22 |
| Language | TypeScript 6 (strict mode) |
| Framework | Fastify 5 |
| Validation | Zod 4 |
| Auth | JWT (jsonwebtoken) + bcryptjs |
| Logging | Pino + pino-pretty (dev) |
| Queue (planned) | BullMQ + Redis (ioredis) |
| Database (planned) | PostgreSQL + Prisma |
| Testing | Vitest 5 |
| Package Manager | npm 11 |

---

## Project Structure

```
ai-assignment/
â”œâ”€â”€ .gitignore
â””â”€â”€ backend/
    â”œâ”€â”€ .env.example              # Environment variable template
    â”œâ”€â”€ package.json
    â”œâ”€â”€ tsconfig.json
    â”œâ”€â”€ vitest.config.ts
    â””â”€â”€ src/
        â”œâ”€â”€ app.ts                # Fastify app factory (DI-aware)
        â”œâ”€â”€ app.test.ts           # Health, readiness, error handler tests
        â”œâ”€â”€ server.ts             # Entry point with graceful shutdown
        â”œâ”€â”€ config.ts             # Zod-validated env config (singleton)
        â”œâ”€â”€ config.test.ts        # Config tests
        â”œâ”€â”€ container.ts          # Dependency composition root
        â”œâ”€â”€ TEST_CASES.md         # Setup-phase test results
        â”‚
        â”œâ”€â”€ modules/
        â”‚   â”œâ”€â”€ auth/
        â”‚   â”‚   â”œâ”€â”€ auth.service.ts       # Login, logout, JWT verify
        â”‚   â”‚   â”œâ”€â”€ auth.middleware.ts     # Bearer token extraction hook
        â”‚   â”‚   â”œâ”€â”€ auth.routes.ts        # /api/auth/* + /api/users/me
        â”‚   â”‚   â””â”€â”€ index.ts
        â”‚   â”‚
        â”‚   â”œâ”€â”€ users/
        â”‚   â”‚   â”œâ”€â”€ user.entity.ts        # User domain + repository interface
        â”‚   â”‚   â”œâ”€â”€ user.repository.ts     # In-memory UserRepository
        â”‚   â”‚   â”œâ”€â”€ user.service.ts        # User creation, lookup, password hashing
        â”‚   â”‚   â””â”€â”€ index.ts
        â”‚   â”‚
        â”‚   â”œâ”€â”€ authorization/
        â”‚   â”‚   â”œâ”€â”€ authorization.service.ts  # Admin / team-member / team-manager policy
        â”‚   â”‚   â””â”€â”€ index.ts
        â”‚   â”‚
        â”‚   â”œâ”€â”€ teams/
        â”‚   â”‚   â”œâ”€â”€ team.entity.ts        # Team, TeamMember + repository interface
        â”‚   â”‚   â”œâ”€â”€ team.repository.ts     # In-memory TeamRepository
        â”‚   â”‚   â”œâ”€â”€ team.service.ts        # Team + membership business rules
        â”‚   â”‚   â”œâ”€â”€ team.routes.ts        # /api/teams/*
        â”‚   â”‚   â””â”€â”€ index.ts
        â”‚   â”‚
        â”‚   â”œâ”€â”€ activity/
        â”‚   â”‚   â”œâ”€â”€ activity.entity.ts    # ActivityEntry, types, append-only repository interface
        â”‚   â”‚   â”œâ”€â”€ activity.repository.ts # In-memory ActivityRepository
        â”‚   â”‚   â”œâ”€â”€ activity.service.ts   # record() + authorized list()
        â”‚   â”‚   â”œâ”€â”€ activity.routes.ts    # GET /api/work-items/:id/activity
        â”‚   â”‚   â””â”€â”€ index.ts
        â”‚   â”‚
        â”‚   â””â”€â”€ work-items/
        â”‚       â”œâ”€â”€ work-item.entity.ts    # WorkItem, enums, repository interface (CAS update)
        â”‚       â”œâ”€â”€ work-item.workflow.ts  # Status transition map + manager rules
        â”‚       â”œâ”€â”€ work-item.repository.ts # In-memory WorkItemRepository
        â”‚       â”œâ”€â”€ work-item.service.ts   # Create/list/get/update rules
        â”‚       â”œâ”€â”€ work-item.routes.ts    # /api/work-items/*
        â”‚       â”œâ”€â”€ work-item-lock.entity.ts  # WorkItemLock + lock store interface
        â”‚       â”œâ”€â”€ work-item-lock.store.ts   # In-memory lock store (Redis later)
        â”‚       â”œâ”€â”€ work-item-lock.service.ts # Acquire / heartbeat / release / guard
        â”‚       â”œâ”€â”€ work-item-lock.routes.ts  # /api/work-items/:id/lock*
        â”‚       â””â”€â”€ index.ts
        â”‚
        â”œâ”€â”€ frontend.ts           # Serves the web app (static files, no build step)
        â”œâ”€â”€ seed.ts               # Demo data (SEED_DEMO_DATA=true)
        â”œâ”€â”€ test-utils/harness.ts # Shared integration-test setup
        â”‚
        â””â”€â”€ shared/
            â”œâ”€â”€ idempotency/          # Idempotency-Key store + Fastify plugin
            â”œâ”€â”€ queue/                # Background job queue (in-memory; BullMQ later)
            â”œâ”€â”€ errors/
            â”‚   â”œâ”€â”€ app-errors.ts         # Error class hierarchy
            â”‚   â”œâ”€â”€ app-errors.test.ts
            â”‚   â””â”€â”€ index.ts
            â”œâ”€â”€ middleware/
            â”‚   â”œâ”€â”€ error-handler.ts      # Global Fastify error handler
            â”‚   â”œâ”€â”€ request-validator.ts   # Zod body/query/params helpers
            â”‚   â””â”€â”€ index.ts
            â”œâ”€â”€ types/
            â”‚   â”œâ”€â”€ api-response.ts       # Standard API envelope
            â”‚   â”œâ”€â”€ api-response.test.ts
            â”‚   â”œâ”€â”€ auth.ts               # AuthenticatedUser, roles, enums
            â”‚   â””â”€â”€ index.ts
            â”œâ”€â”€ utils/
            â”‚   â”œâ”€â”€ logger.ts             # Pino logger factory
            â”‚   â”œâ”€â”€ clock.ts              # Clock interface (injectable time source)
            â”‚   â””â”€â”€ index.ts
            â””â”€â”€ validation/
                â”œâ”€â”€ common-schemas.ts     # Pagination & sort Zod schemas
                â”œâ”€â”€ common-schemas.test.ts
                â””â”€â”€ index.ts
```

Modules added in phases Gâ€“I (same layout as the others: entity/repository/service/routes/index):

```
backend/src/modules/
    comments/        # comment.* â€” append-only notes per work item
    dashboard/       # dashboard.service/routes â€” read-only overview
    notifications/   # notification.* + dispatcher â€” background-delivered inbox
frontend/            # the web app (see "Web App" below)
    index.html  css/app.css
    js/main.js (router) api.js store.js ui.js states.js
    js/views/ login Â· layout Â· dashboard Â· workItems Â· detail Â· newItem
    js/lib/   format Â· presets Â· permissions Â· diff Â· activity   (pure, unit-tested)
```

---

## Architecture

### Request Flow

```
HTTP Request
    â†“
Route / Controller (thin)
    â†“
Auth Middleware (Bearer JWT extraction â†’ AuthenticatedUser)
    â†“
Application Service (business rules)
    â†“
Repository Interface (abstraction)
    â†“
Repository Implementation (in-memory now, Prisma later)
```

### Dependency Injection

All services are wired through constructor injection inside [`container.ts`](file:///e:/ai-assignment/backend/src/container.ts). No DI framework â€” explicit composition:

```
createContainer(config)
    â†’ InMemoryUserRepository
    â†’ UserService(userRepo)
    â†’ InMemorySessionStore
    â†’ AuthService(userService, authConfig, sessionStore)
    â†’ InMemoryTeamRepository
    â†’ AuthorizationService(teamRepo)          # needs only findMember()
    â†’ TeamService(teamRepo, userService, authorizationService)
    â†’ InMemoryWorkItemRepository
    â†’ InMemoryJobQueue                         # background jobs (retry + dead-letter)
    â†’ InMemoryActivityRepository
    â†’ ActivityService(activityRepo, workItemRepo, authorizationService, userService, clock,
                      publisher â†’ jobQueue.enqueue('activity.recorded'))
    â†’ InMemoryNotificationRepository + NotificationDispatcher   # registered as the job handler
    â†’ NotificationService(notificationRepo, clock)
    â†’ InMemoryCommentRepository
    â†’ CommentService(commentRepo, workItemRepo, authorizationService, userService, activityService, clock)
    â†’ DashboardService(workItemRepo, teamRepo, activityRepo, authorizationService, userService)
    â†’ InMemoryIdempotencyStore
    â†’ InMemoryWorkItemLockStore
    â†’ WorkItemLockService(lockStore, workItemRepo, authorizationService, clock, timeoutMs, activityService)
    â†’ WorkItemService(workItemRepo, teamRepo, authorizationService, lockService, activityService)
```

`createContainer(config, { clock, jobQueue })` accepts an optional `Clock` (tests control lock expiry and throttling without sleeping) and an optional `JobQueue` (tests inject failing queues). `AuthService` is also given a `LoginThrottle`.

The [`buildApp()`](file:///e:/ai-assignment/backend/src/app.ts) factory accepts an optional `container` to allow full dependency injection in tests.

### SOLID Boundaries

| Principle | How it's applied |
|---|---|
| **S** â€“ Single Responsibility | Each service handles one domain (users, auth). Routes are thin. |
| **O** â€“ Open/Closed | Repository interfaces allow swapping persistence without touching services. |
| **L** â€“ Liskov Substitution | `InMemoryUserRepository` implements `UserRepository` interface faithfully. |
| **I** â€“ Interface Segregation | `UserRepository` and `SessionStore` are small, focused interfaces. |
| **D** â€“ Dependency Inversion | `UserService` depends on `UserRepository` interface, not the concrete in-memory implementation. |

---

## Implemented Modules

### Config ([`config.ts`](file:///e:/ai-assignment/backend/src/config.ts))

- Zod-validated environment variables loaded from `.env`
- Singleton pattern with `getConfig()`
- Frozen (immutable) config object
- `createTestConfig()` helper for tests with sensible defaults
- `resetConfig()` for test isolation

**Environment variables:**

| Variable | Type | Default | Required |
|---|---|---|---|
| `PORT` | number | 3000 | No |
| `HOST` | string | 0.0.0.0 | No |
| `NODE_ENV` | enum | development | No |
| `LOG_LEVEL` | enum | info | No |
| `DATABASE_URL` | string | â€” | No (planned) |
| `REDIS_HOST` | string | localhost | No |
| `REDIS_PORT` | number | 6379 | No |
| `JWT_SECRET` | string (min 16) | â€” | **Yes** |
| `JWT_EXPIRES_IN` | string | 24h | No |
| `LOCK_TIMEOUT_MINUTES` | number | 30 | No (work item lock lifetime) |
| `SEED_DEMO_DATA` | `true`/`false` | false | No (fills the in-memory stores with demo data at startup) |
| `FRONTEND_DIR` | string | `../frontend` | No (directory of the web app to serve) |

---

### Error Hierarchy ([`app-errors.ts`](file:///e:/ai-assignment/backend/src/shared/errors/app-errors.ts))

All application errors extend `AppError` and carry:
- `statusCode` â€” HTTP status
- `code` â€” machine-readable string
- `isOperational` â€” distinguishes expected vs unexpected failures

| Error Class | Status | Code |
|---|---|---|
| `BadRequestError` | 400 | `BAD_REQUEST` |
| `UnauthorizedError` | 401 | `UNAUTHORIZED` |
| `ForbiddenError` | 403 | `FORBIDDEN` |
| `NotFoundError` | 404 | `NOT_FOUND` |
| `ConflictError` | 409 | `CONFLICT` |
| `UnprocessableEntityError` | 422 | `UNPROCESSABLE_ENTITY` |
| `LockedError` | 423 | `RESOURCE_LOCKED` |
| `IdempotencyConflictError` | 409 | `IDEMPOTENCY_CONFLICT` |
| `TooManyRequestsError` | 429 | `TOO_MANY_REQUESTS` (sets `Retry-After`) |
| `InternalError` | 500 | `INTERNAL_ERROR` |

---

### Global Error Handler ([`error-handler.ts`](file:///e:/ai-assignment/backend/src/shared/middleware/error-handler.ts))

Centralized Fastify error handler that translates:
- **ZodError** â†’ `400` with `VALIDATION_ERROR` and field-level details
- **AppError subclasses** â†’ their respective status codes
- **Fastify errors** (< 500) â†’ pass-through status
- **Unknown errors** â†’ `500` (stack traces hidden in production)

Standard error response shape:
```json
{
  "success": false,
  "error": {
    "code": "WORK_ITEM_LOCKED",
    "message": "This work item is currently being edited by another user."
  }
}
```

---

### API Response Envelope ([`api-response.ts`](file:///e:/ai-assignment/backend/src/shared/types/api-response.ts))

All API responses use a consistent envelope:

```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "page": 1,
    "pageSize": 20,
    "totalCount": 100,
    "totalPages": 5,
    "hasNext": true,
    "hasPrev": false
  }
}
```

Helper functions: `successResponse(data, meta?)` and `errorResponse(code, message, details?)`.

---

### Auth Module ([`modules/auth/`](file:///e:/ai-assignment/backend/src/modules/auth))

**AuthService** â€” handles login, logout, and token verification:
- `login(email, password)` â†’ validates credentials, returns JWT + user info
- `logout(token)` â†’ invalidates token via `SessionStore`
- `verifyToken(token)` â†’ checks invalidation + JWT validity â†’ returns `AuthenticatedUser`

**Auth Middleware** â€” Fastify `preHandler` hook:
- Extracts `Bearer` token from `Authorization` header
- Calls `authService.verifyToken()`
- Attaches `request.currentUser` for downstream handlers

**SessionStore Interface** â€” abstraction for token invalidation:
- `InMemorySessionStore` for dev/test
- Designed for Redis replacement in production

---

### Users Module ([`modules/users/`](file:///e:/ai-assignment/backend/src/modules/users))

**UserRepository Interface** â€” persistence abstraction:
- `findById(id)`, `findByEmail(email)`, `create(input)`, `update(id, data)`, `findAll()`

**InMemoryUserRepository** â€” in-memory adapter (pre-database phase):
- Email-indexed for O(1) lookup
- `clear()` helper for test reset

**UserService** â€” business logic:
- `createUser()` â€” enforces email uniqueness, hashes password with bcrypt (12 rounds)
- `findById()` â€” returns user without password hash
- Passwords are **never** returned in API responses

---

### Authorization Module ([`modules/authorization/`](file:///e:/ai-assignment/backend/src/modules/authorization))

Central policy service, reused by every module that needs permission checks. Depends only on the small `MembershipLookup` interface (`findMember`), which `TeamRepository` satisfies structurally.

| Method | Allows | Error on denial |
|---|---|---|
| `assertAdmin(user)` | global `ADMIN` | `403 ADMIN_REQUIRED` |
| `assertTeamMember(user, teamId)` | `ADMIN`, or any member of the team | `403 NOT_TEAM_MEMBER` |
| `assertTeamManager(user, teamId)` | `ADMIN`, or a `MANAGER` of the team | `403 TEAM_MANAGER_REQUIRED` |
| `getTeamRole(user, teamId)` | â€” (returns `MANAGER` / `MEMBER` / `null`) | â€” |

Global `ADMIN` bypasses all team-level checks. Team roles are scoped per team: managing one team grants nothing in another.

---

### Teams Module ([`modules/teams/`](file:///e:/ai-assignment/backend/src/modules/teams))

**TeamRepository Interface** â€” teams plus memberships (`addMember`, `findMember`, `updateMemberRole`, `removeMember`, `listMembers`, `listMembershipsForUser`). `InMemoryTeamRepository` is the pre-database adapter.

**TeamService** business rules:
- Create team: `ADMIN` only; names unique case-insensitively (`409 TEAM_NAME_TAKEN`); optional `managerId` becomes the first `MANAGER`.
- List teams: admin sees all, everyone else only teams they belong to; paginated, sorted by name. Each team carries `myRole`.
- Get team / list members: admin or team member.
- Add / change role / remove member: admin or team manager. Duplicate â†’ `409 ALREADY_TEAM_MEMBER`; unknown user â†’ `404 USER_NOT_FOUND`; non-member target â†’ `404 MEMBER_NOT_FOUND`.
- A team must always keep at least one manager: demoting or removing the last one â†’ `422 TEAM_REQUIRES_MANAGER`.
- Authorization is evaluated per request against current membership, so removal takes effect immediately (JWT carries only the *global* role).

---

### Work Items Module ([`modules/work-items/`](file:///e:/ai-assignment/backend/src/modules/work-items))

**Domain** â€” a `WorkItem` has `title`, `description`, `type` (`CUSTOMER_ISSUE`, `ENGINEERING_PROBLEM`, `PAYMENT_INVESTIGATION`, `PRODUCTION_INCIDENT`, `COMPLIANCE_REQUEST`, `APPROVAL_TASK`), `status`, `priority` (`LOW`/`MEDIUM`/`HIGH`/`CRITICAL`), `teamId` (immutable), `createdBy`, `assigneeId` (nullable), `version`, timestamps. New items start `OPEN` at version 1.

**Workflow** ([`work-item.workflow.ts`](file:///e:/ai-assignment/backend/src/modules/work-items/work-item.workflow.ts)) â€” pure functions over a transition map:

| From | Allowed next |
|---|---|
| `OPEN` | `IN_PROGRESS`, `CLOSED` |
| `IN_PROGRESS` | `OPEN`, `BLOCKED`, `IN_REVIEW`, `RESOLVED` |
| `BLOCKED` | `IN_PROGRESS` |
| `IN_REVIEW` | `IN_PROGRESS`, `RESOLVED` |
| `RESOLVED` | `IN_PROGRESS`, `CLOSED` |
| `CLOSED` | `OPEN` |

Anything else â†’ `422 INVALID_STATUS_TRANSITION` (message lists the allowed targets).

**Permissions**

| Action | Who |
|---|---|
| Create, view, list | Team member (admin: any team) |
| Edit title / description / type / priority | Team member |
| Ordinary status transitions | Team member |
| Close, or reopen a closed item | Team **manager** |
| Set / change / clear assignee (also at creation) | Team **manager**; assignee must be a team member (`422 ASSIGNEE_NOT_TEAM_MEMBER`) |

A `PATCH` is all-or-nothing: if any changed field is not permitted, nothing is applied. Since phase E a `PATCH` also requires the caller to hold the item's edit lock.

**Optimistic concurrency** â€” every `PATCH` must send the `version` it read. A stale version â†’ `409 VERSION_CONFLICT`. The check is enforced atomically by the repository (`update(id, expectedVersion, patch)` is a compare-and-set, i.e. `UPDATE â€¦ WHERE id=? AND version=?` in a SQL implementation), so of two simultaneous updates exactly one wins. Re-sending unchanged values is a no-op and does not bump the version. Since phase E the version check is a second line of defence behind the exclusive edit lock (see below).

**Listing** â€” non-admins only see items of teams they belong to. Filters: `teamId` (membership required), `status`, `type`, `priority`, `assigneeId`. Sort: `sortBy` = `updatedAt` (default) / `createdAt` / `priority`, `sortOrder` = `desc` (default) / `asc`; paginated with the standard meta.

---

### Work Item Locking ([`work-item-lock.*`](file:///e:/ai-assignment/backend/src/modules/work-items))

Exclusive edit locks give each work item at most one editor at a time. Reading is never blocked.

| Endpoint | Who | Behaviour |
|---|---|---|
| `POST /api/work-items/:id/lock` | Team member / admin | Acquire. Re-acquiring your own lock renews it. Held by someone else â†’ `423 WORK_ITEM_LOCKED` |
| `POST /api/work-items/:id/lock/heartbeat` | Holder | Extend expiry to now + timeout. Not held â†’ `409 LOCK_NOT_HELD`; held by someone else â†’ `423` |
| `DELETE /api/work-items/:id/lock` | Holder; team manager / admin (force-release) | Release. Other members â†’ `403 NOT_LOCK_HOLDER`; nothing locked â†’ `409 LOCK_NOT_HELD` |
| `GET /api/work-items/:id/lock` | Team member / admin | Current lock `{workItemId, lockedBy, acquiredAt, expiresAt}` or `null` |

**Rules**
- A lock belongs to a *user* and expires `LOCK_TIMEOUT_MINUTES` (default 30) after acquisition or the last heartbeat.
- Expiry is lazy: an expired lock is treated exactly like no lock (no background job). An expired lock cannot be revived by the old holder; it must be re-acquired.
- **Editing requires the lock.** `PATCH /api/work-items/:id` â†’ `409 LOCK_REQUIRED` if nobody holds the lock (or it expired), `423 WORK_ITEM_LOCKED` if someone else does. Holding the lock does not widen permissions (a member still cannot assign or close).
- The optimistic `version` check still runs, so a stale save is rejected even for the lock holder.
- Locked errors carry `error.lockInfo = { lockedBy, expiresAt }` so clients can show who is editing and until when.

**Atomicity** â€” all `WorkItemLockStore` methods must be atomic (`acquire` is "take if free, expired or already mine"). The in-memory store relies on the single-threaded event loop; a Redis store would use `SET NX PX` plus small Lua scripts. 20 simultaneous acquirers yield exactly one winner (LSTORE-010).

**Known limitation** â€” lock state lives in process memory, so it is lost on restart and not shared between instances until the Redis-backed store is added (phase I/J).

---

### Activity History ([`modules/activity/`](file:///e:/ai-assignment/backend/src/modules/activity))

An immutable, append-only audit trail per work item, readable by team members and admins via `GET /api/work-items/:id/activity` (query: `page`, `pageSize` â‰¤ 100, `order` = `desc` (default, newest first) / `asc`, optional `type`).

**Entry shape** â€” `{ id, workItemId, sequence, type, actorId, actorName, createdAt, changes[], metadata }`. `sequence` is a per-item counter starting at 1, giving a stable order even when timestamps tie. `changes` is a list of `{ field, from, to }`.

| Type | Recorded when | `changes` / `metadata` |
|---|---|---|
| `CREATED` | Item created | Initial values (`from: null`); `metadata.version = 1` |
| `UPDATED` | A save changed something | Only the fields that actually changed, with before/after; `metadata.version` = new version |
| `LOCK_ACQUIRED` | A lock is newly taken (including taking over an expired one) | `metadata.expiresAt` |
| `LOCK_RELEASED` | Holder releases | â€” |
| `LOCK_FORCE_RELEASED` | Manager/admin releases someone else's lock | `metadata.previousHolderId` |

**What is *not* recorded** â€” rejected requests (403/409/422/423), no-op saves, lock renewals and heartbeats, blocked lock attempts, and reads. An entry exists only if the change really happened.

**Design notes**
- The `ActivityRecorder` interface (`record()`) is all other modules see. The activity module in turn depends only on small lookup interfaces (`WorkItemLookup`, `UserLookup`), so module dependencies stay one-way (`work-items â†’ activity`).
- There is no write/update/delete API, and the repository hands out copies, so history cannot be altered.
- Timestamps come from the injected `Clock`.

**Known limitations**
- *Lock expiry is not an event.* Expiry is lazy, so nothing is logged when a lock times out; the next `LOCK_ACQUIRED` by someone else is what shows it happened.
- *Not transactional yet.* The change and its history entry are two separate writes; in memory this cannot fail between them, but the Prisma implementation must write both in one transaction (or use an outbox) so history can never disagree with the data.

---

### Comments ([`modules/comments/`](file:///e:/ai-assignment/backend/src/modules/comments))

Append-only notes on a work item, for team members and admins. `POST` body `{ body }` (trimmed, 1â€“5000 characters); `GET` is paginated, **oldest first** by default (`order=desc` for newest first), with each comment's `authorName`.

- Commenting needs **no edit lock** and works on closed items; it never changes the item (version and `updatedAt` stay).
- There is no edit or delete â€” comments are permanent. Text is stored verbatim; clients must escape it when displaying (the web app does).
- Each comment adds a `COMMENT_ADDED` entry to the activity history (linking the comment id, not copying the text) and can notify the assignee and reporter.

---

### Search, Filters and the Dashboard

**List filters** (`GET /api/work-items`) â€” all combine with AND:

| Parameter | Meaning |
|---|---|
| `search` | Case-insensitive text in title, description or key (`NW-1001`, or just `1001`). Blank is ignored; max 200 chars |
| `status`, `priority`, `type` | One or several values, comma-separated (`status=OPEN,BLOCKED`); any-of within a field. Invalid/empty â†’ 400 |
| `assignee` | `me`, `unassigned`, or a user id (`assigneeId` remains as an alias for a user id) |
| `createdBy` | Reporter user id |
| `teamId` | Team (membership required) |
| `sortBy` / `sortOrder` | `updatedAt` (default) / `createdAt` / `priority`; `desc` (default) / `asc`. Ties break by creation time |
| `page` / `pageSize` | Pagination (`pageSize` â‰¤ 100) |

Every work item has a sequential **`number`** and display **`key`** (`NW-1001`, â€¦), unique even under concurrent creation.

**Dashboard** (`GET /api/dashboard`) â€” read-only, limited to the viewer's teams (admins: all):

- `counts`: `myWork`, `highCritical`, `unassigned` (all *open* work: Open, In Progress, Blocked, In Review), `blocked`, `open`, `total`
- `byStatus`: a count for every status
- `teamLoad`: per team `open`, `blocked`, `unassigned`, busiest first
- `recentActivity`: the latest 10 events across visible items, with item key/title and actor name

The web app's quick-filter chips use the same definitions as these counters, so the numbers always agree.

**Profile** â€” `GET /api/users/me` now returns `{ id, email, name, role }` (never password data), and live role/active status is re-checked on every request (see Hardening).

---

### Background Jobs and Notifications ([`shared/queue/`](file:///e:/ai-assignment/backend/src/shared/queue), [`modules/notifications/`](file:///e:/ai-assignment/backend/src/modules/notifications))

**Job queue** â€” `enqueue` returns immediately; handlers run later, one at a time, in order. Failed jobs are retried with exponential backoff (3 attempts, 250 ms base) and then kept in a dead-letter list (`failedJobs()`), and failures are logged. `drain()` waits for all work (used by tests), and `app.close()` finishes queued jobs before shutting down. The in-memory queue is single-process; a BullMQ/Redis implementation can replace it behind the same `JobQueue` interface.

**Notifications** are produced in the background from recorded activity, so a notification problem can never fail or slow the request that caused it (even if the queue itself is down). Rules â€” the person who acted is never notified, and nobody is notified about an item they cannot see:

| Notification | Sent to | When |
|---|---|---|
| `ASSIGNED` | New assignee | Assigned (also at creation) |
| `UNASSIGNED` | Previous assignee | Reassigned or cleared |
| `STATUS_CHANGED` | Assignee and reporter | Status moves (not repeated for someone just told about their assignment) |
| `COMMENT_ADDED` | Assignee and reporter | A comment is posted |
| `LOCK_FORCE_RELEASED` | Previous lock holder | A manager/admin released their lock |

Delivery is **at-least-once and idempotent**: a notification is unique per (user, activity entry, type), so a retried or replayed job never creates duplicates. Endpoints: `GET /api/notifications` (`unread=true`, paginated, newest first), `GET /api/notifications/unread-count`, `POST /api/notifications/:id/read` (idempotent; someone else's id is a 404), `POST /api/notifications/read-all`.

---

### Idempotency and Hardening

**`Idempotency-Key`** (optional header, 1â€“255 printable characters) on `POST /api/work-items`, `.../comments`, `/api/teams` and `.../members`:

| Situation | Result |
|---|---|
| Same key, same request | The first response is replayed (`Idempotent-Replayed: true`); nothing is created again |
| Same key, different request | `409 IDEMPOTENCY_KEY_REUSED` |
| Same key while the first is still running | `409 IDEMPOTENCY_IN_PROGRESS` |
| First attempt failed (4xx/5xx) | Not remembered â€” fix and retry with the same key |

Keys are per user, kept for 24 hours, and claimed atomically (20 simultaneous callers â†’ one winner). Without the header nothing changes.

**Other hardening**

- Malformed JSON â†’ `400 INVALID_JSON` (was a 500 leaking parser text); unknown routes â†’ standard `404 NOT_FOUND` envelope; bodies over 1 MB â†’ `413`.
- Every response carries `x-request-id`; Helmet security headers are set; production uses an explicit CSP (see Web App).
- **Login throttle:** 5 failed logins per email within 15 minutes â†’ `429 TOO_MANY_LOGIN_ATTEMPTS` with `Retry-After`, even for the right password; counted for unknown emails too (reveals nothing); a successful login clears it. Trade-off: someone can deliberately lock a known email out for the window.
- **Tokens are re-checked on every request:** a valid signature is not enough â€” the account must still exist and be active, and its *current* role applies. Disabling or demoting takes effect immediately, not when the token expires.
- Logged-out tokens are forgotten once they would have expired anyway (no unbounded growth).

---

### Demo Data and Web App

**Demo data** â€” start with `SEED_DEMO_DATA=true` to get 6 people (admin `ada@newtonite.test`; `sarah@`, `liam@`, `elena@`, `carlos@`, `priya@newtonite.test`), 4 teams and 14 work items across every status, created through the real services (so history, comments and notifications are genuine). All demo accounts share the password `demo-password-123`. It is for local use only; the data lives in memory and disappears on restart.

**Web app** â€” plain HTML/CSS/ES modules in [`frontend/`](file:///e:/ai-assignment/frontend), served by the backend at `/` (no build step). It follows the "Sahara" design system in `ui-resources/` and implements only screens/elements the backend supports:

| Screen | What it shows | Deliberately omitted (no backend) |
|---|---|---|
| Sign in | Email/password, error and lockout states | SSO, FIDO/TOTP, "forgot key" |
| Dashboard | Counters, urgent work, my work, team load, recent activity | Approvals, overdue/SLA, telemetry, batch operations, "my work today" checklist |
| Work items | Search, quick filters, 5 dropdown filters, sorting, pagination, empty/error states | Batch actions, CSV export, SLA cards, "awaiting approval" |
| Work item | Attributes, edit with lock (auto-renewed), status moves, assign, comments, audit trail, lock banner, 409 conflict panel | Approval workflow, linked dependencies, cluster telemetry, runbook checklist, markdown toolbar |
| Shell | Search, New Work Item, API health, notifications, profile/sign out | Environment switcher, websocket status |

Notes: all user text is HTML-escaped before display; a viewer's buttons follow their permissions (the server still enforces everything); edit sessions release their lock when the tab closes; production sends a Content-Security-Policy that allows the Tailwind CDN, Google Fonts and inline styles/scripts the app uses (precompiling the CSS would allow a stricter policy). Static serving blocks path traversal and dotfiles.

---

### Validation Schemas ([`common-schemas.ts`](file:///e:/ai-assignment/backend/src/shared/validation/common-schemas.ts))

Reusable Zod schemas for all list endpoints:

| Schema | Fields | Defaults | Constraints |
|---|---|---|---|
| `paginationSchema` | `page`, `pageSize` | 1, 20 | page â‰¥ 1, pageSize 1â€“100 |
| `sortSchema` | `sortBy`, `sortOrder` | undefined, `desc` | `asc` or `desc` only |

---

## API Endpoints (Implemented)

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/health` | No | Health check (status, timestamp, uptime) |
| `GET` | `/api/ready` | No | Readiness check |
| `POST` | `/api/auth/login` | No | Login with email/password â†’ JWT token |
| `POST` | `/api/auth/logout` | Yes | Invalidate current token |
| `GET` | `/api/users/me` | Yes | Get authenticated user profile |
| `GET` | `/api/teams` | Yes | List my teams (admin: all), paginated |
| `POST` | `/api/teams` | Admin | Create team (optional `managerId`) |
| `GET` | `/api/teams/:id` | Member/Admin | Get team (includes `myRole`) |
| `GET` | `/api/teams/:id/members` | Member/Admin | List members |
| `POST` | `/api/teams/:id/members` | Manager/Admin | Add member `{userId, role?}` |
| `PATCH` | `/api/teams/:id/members/:userId` | Manager/Admin | Change member role |
| `DELETE` | `/api/teams/:id/members/:userId` | Manager/Admin | Remove member |
| `GET` | `/api/work-items` | Yes | List work items (paginated, filtered, sorted) |
| `POST` | `/api/work-items` | Member/Admin | Create work item |
| `GET` | `/api/work-items/:id` | Member/Admin | Get work item |
| `PATCH` | `/api/work-items/:id` | Member/Admin* | Update work item (`version` required, must hold the edit lock) |
| `GET` | `/api/work-items/:id/lock` | Member/Admin | Current lock or `null` |
| `POST` | `/api/work-items/:id/lock` | Member/Admin | Acquire (or renew) exclusive edit lock |
| `POST` | `/api/work-items/:id/lock/heartbeat` | Holder | Extend active lock |
| `DELETE` | `/api/work-items/:id/lock` | Holder / Manager / Admin | Release lock |
| `GET` | `/api/work-items/:id/activity` | Member/Admin | Activity history (paginated, `order`, `type`) |
| `GET` | `/api/work-items/:id/comments` | Member/Admin | List comments (paginated, `order`) |
| `POST` | `/api/work-items/:id/comments` | Member/Admin | Add comment `{ body }` |
| `GET` | `/api/dashboard` | Yes | Counters, team load, recent activity |
| `GET` | `/api/notifications` | Yes | My notifications (`unread`, paginated) |
| `GET` | `/api/notifications/unread-count` | Yes | `{ count }` |
| `POST` | `/api/notifications/:id/read` | Yes | Mark one read |
| `POST` | `/api/notifications/read-all` | Yes | Mark all read |

\* Assignment, closing and reopening need a team manager (or admin).

---

## Roles & Authorization

| Role | Scope | Capabilities |
|---|---|---|
| `ADMIN` | Global | Full system access |
| `USER` | Global | Base authenticated access |
| `MANAGER` | Team | Manage team membership; assign items; close/reopen work items |
| `MEMBER` | Team | View & work on permitted items |

---

## Running the Project

```bash
# Install dependencies
cd backend
npm install

# Copy env template
cp .env.example .env
# Edit .env and set JWT_SECRET (min 16 chars)

# Development server (API only unless the ../frontend folder is present â€” it is in this repo)
npm run dev
# -> open http://localhost:3000/

# Try it with demo data (bash). Sign in as sarah@newtonite.test / demo-password-123
JWT_SECRET=local-demo-secret-change-me SEED_DEMO_DATA=true npm run dev
# PowerShell:  $env:JWT_SECRET='local-demo-secret-change-me'; $env:SEED_DEMO_DATA='true'; npm run dev

# Run tests
npm test

# Type check
npm run typecheck

# Build
npm run build
```

---

## Test Status

**346 tests passing** across 27 test files. `npm run typecheck` is clean.

| Test File | Tests | Status |
|---|---|---|
| `config.test.ts` | 3 | âœ… All pass |
| `app-errors.test.ts` | 8 | âœ… All pass |
| `api-response.test.ts` | 4 | âœ… All pass |
| `common-schemas.test.ts` | 5 | âœ… All pass |
| `app.test.ts` | 5 | âœ… All pass |
| `modules/users/user.service.test.ts` (USER-001â€¦011) | 11 | âœ… All pass |
| `modules/auth/auth.test.ts` (AUTH-001â€¦014) | 14 | âœ… All pass |
| `modules/authorization/authorization.service.test.ts` (AUTHZ-001â€¦006) | 6 | âœ… All pass |
| `modules/teams/team.test.ts` (TEAM-001â€¦024) | 24 | âœ… All pass |
| `modules/work-items/work-item.workflow.test.ts` (WF-001â€¦007) | 7 | âœ… All pass |
| `modules/work-items/work-item.test.ts` (WI-001â€¦028) | 28 | âœ… All pass |
| `modules/work-items/work-item-lock.store.test.ts` (LSTORE-001â€¦010) | 10 | âœ… All pass |
| `modules/work-items/work-item-lock.test.ts` (LOCK-001â€¦029) | 29 | âœ… All pass |
| `modules/activity/activity.repository.test.ts` (ACTREPO-001â€¦006) | 6 | âœ… All pass |
| `modules/activity/activity.test.ts` (ACT-001â€¦021) | 21 | âœ… All pass |
| `modules/comments/comment.test.ts` (COMM-001â€¦015) | 15 | âœ… All pass |
| `modules/work-items/work-item-search.test.ts` (SRCH, FILT, KEY, PROF) | 21 | âœ… All pass |
| `modules/work-items/work-item-transitions.test.ts` (WI-029â€¦031) | 3 | âœ… All pass |
| `modules/dashboard/dashboard.test.ts` (DASH-001â€¦011) | 11 | âœ… All pass |
| `shared/queue/in-memory-job-queue.test.ts` (QUEUE-001â€¦010) | 10 | âœ… All pass |
| `modules/notifications/notification.test.ts` (NOTIF-001â€¦024) | 24 | âœ… All pass |
| `shared/idempotency/idempotency.test.ts` (IDEMSTORE, IDEM) | 19 | âœ… All pass |
| `hardening.test.ts` (HARD-001â€¦016) | 16 | âœ… All pass |
| `integration.test.ts` (INT-001â€¦008) | 8 | âœ… All pass |
| `seed.test.ts` (SEED-001â€¦008) | 8 | âœ… All pass |
| `frontend.test.ts` (WEB-001â€¦009) | 9 | âœ… All pass |
| `frontend-lib.test.ts` (UILIB-001â€¦021) | 21 | âœ… All pass |

The web app's screens were additionally verified by hand in a browser against demo data; see the end of [`TEST_CASES.md`](file:///e:/ai-assignment/backend/src/TEST_CASES.md).

Detailed test IDs and scenarios are tracked in [`TEST_CASES.md`](file:///e:/ai-assignment/backend/src/TEST_CASES.md).

---

## Implementation Phases

| Phase | Description | Status |
|---|---|---|
| **A** | Initial setup (config, errors, health, tests) | âœ… Complete |
| **B** | Authentication + Identity | âœ… Complete |
| **C** | Teams + Roles + Authorization | âœ… Complete |
| **D** | Work Item domain + CRUD | âœ… Complete |
| **E** | Exclusive Work Item locking / concurrency | âœ… Complete |
| **F** | Activity history | âœ… Complete |
| **G** | Comments | âœ… Complete |
| **H** | Search + filtering + pagination | âœ… Complete |
| **I** | Async processing / notifications | âœ… Complete |
| **J** | Error handling + idempotency + hardening | âœ… Complete |
| **K** | Integration testing & verification | âœ… Complete |
| **UI** | Web app (demo data, static serving, 4 screens) | âœ… Complete |

---

## Git History

```
6769112 feat(setup): initial backend setup with Fastify, config validation, error hierarchy, health endpoints, and tests
d359b69 feat(auth): add users and auth modules with JWT login/logout
```

Later commits: run `git log --oneline` (phase C: teams + authorization).
