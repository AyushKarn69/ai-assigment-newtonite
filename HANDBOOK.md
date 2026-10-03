# Newtonite Operations Management System — Backend Handbook

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
├── .gitignore
└── backend/
    ├── .env.example              # Environment variable template
    ├── package.json
    ├── tsconfig.json
    ├── vitest.config.ts
    └── src/
        ├── app.ts                # Fastify app factory (DI-aware)
        ├── app.test.ts           # Health, readiness, error handler tests
        ├── server.ts             # Entry point with graceful shutdown
        ├── config.ts             # Zod-validated env config (singleton)
        ├── config.test.ts        # Config tests
        ├── container.ts          # Dependency composition root
        ├── TEST_CASES.md         # Setup-phase test results
        │
        ├── modules/
        │   ├── auth/
        │   │   ├── auth.service.ts       # Login, logout, JWT verify
        │   │   ├── auth.middleware.ts     # Bearer token extraction hook
        │   │   ├── auth.routes.ts        # /api/auth/* + /api/users/me
        │   │   └── index.ts
        │   │
        │   ├── users/
        │   │   ├── user.entity.ts        # User domain + repository interface
        │   │   ├── user.repository.ts     # In-memory UserRepository
        │   │   ├── user.service.ts        # User creation, lookup, password hashing
        │   │   └── index.ts
        │   │
        │   ├── authorization/
        │   │   ├── authorization.service.ts  # Admin / team-member / team-manager policy
        │   │   └── index.ts
        │   │
        │   ├── teams/
        │   │   ├── team.entity.ts        # Team, TeamMember + repository interface
        │   │   ├── team.repository.ts     # In-memory TeamRepository
        │   │   ├── team.service.ts        # Team + membership business rules
        │   │   ├── team.routes.ts        # /api/teams/*
        │   │   └── index.ts
        │   │
        │   └── work-items/
        │       ├── work-item.entity.ts    # WorkItem, enums, repository interface (CAS update)
        │       ├── work-item.workflow.ts  # Status transition map + manager rules
        │       ├── work-item.repository.ts # In-memory WorkItemRepository
        │       ├── work-item.service.ts   # Create/list/get/update rules
        │       ├── work-item.routes.ts    # /api/work-items/*
        │       ├── work-item-lock.entity.ts  # WorkItemLock + lock store interface
        │       ├── work-item-lock.store.ts   # In-memory lock store (Redis later)
        │       ├── work-item-lock.service.ts # Acquire / heartbeat / release / guard
        │       ├── work-item-lock.routes.ts  # /api/work-items/:id/lock*
        │       └── index.ts
        │
        └── shared/
            ├── errors/
            │   ├── app-errors.ts         # Error class hierarchy
            │   ├── app-errors.test.ts
            │   └── index.ts
            ├── middleware/
            │   ├── error-handler.ts      # Global Fastify error handler
            │   ├── request-validator.ts   # Zod body/query/params helpers
            │   └── index.ts
            ├── types/
            │   ├── api-response.ts       # Standard API envelope
            │   ├── api-response.test.ts
            │   ├── auth.ts               # AuthenticatedUser, roles, enums
            │   └── index.ts
            ├── utils/
            │   ├── logger.ts             # Pino logger factory
            │   ├── clock.ts              # Clock interface (injectable time source)
            │   └── index.ts
            └── validation/
                ├── common-schemas.ts     # Pagination & sort Zod schemas
                ├── common-schemas.test.ts
                └── index.ts
```

---

## Architecture

### Request Flow

```
HTTP Request
    ↓
Route / Controller (thin)
    ↓
Auth Middleware (Bearer JWT extraction → AuthenticatedUser)
    ↓
Application Service (business rules)
    ↓
Repository Interface (abstraction)
    ↓
Repository Implementation (in-memory now, Prisma later)
```

### Dependency Injection

All services are wired through constructor injection inside [`container.ts`](file:///e:/ai-assignment/backend/src/container.ts). No DI framework — explicit composition:

```
createContainer(config)
    → InMemoryUserRepository
    → UserService(userRepo)
    → InMemorySessionStore
    → AuthService(userService, authConfig, sessionStore)
    → InMemoryTeamRepository
    → AuthorizationService(teamRepo)          # needs only findMember()
    → TeamService(teamRepo, userService, authorizationService)
    → InMemoryWorkItemRepository
    → InMemoryWorkItemLockStore
    → WorkItemLockService(lockStore, workItemRepo, authorizationService, clock, timeoutMs)
    → WorkItemService(workItemRepo, teamRepo, authorizationService, lockService)
```

`createContainer(config, { clock })` accepts an optional `Clock` so tests can control lock expiry without sleeping.

The [`buildApp()`](file:///e:/ai-assignment/backend/src/app.ts) factory accepts an optional `container` to allow full dependency injection in tests.

### SOLID Boundaries

| Principle | How it's applied |
|---|---|
| **S** – Single Responsibility | Each service handles one domain (users, auth). Routes are thin. |
| **O** – Open/Closed | Repository interfaces allow swapping persistence without touching services. |
| **L** – Liskov Substitution | `InMemoryUserRepository` implements `UserRepository` interface faithfully. |
| **I** – Interface Segregation | `UserRepository` and `SessionStore` are small, focused interfaces. |
| **D** – Dependency Inversion | `UserService` depends on `UserRepository` interface, not the concrete in-memory implementation. |

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
| `DATABASE_URL` | string | — | No (planned) |
| `REDIS_HOST` | string | localhost | No |
| `REDIS_PORT` | number | 6379 | No |
| `JWT_SECRET` | string (min 16) | — | **Yes** |
| `JWT_EXPIRES_IN` | string | 24h | No |
| `LOCK_TIMEOUT_MINUTES` | number | 30 | No (work item lock lifetime) |

---

### Error Hierarchy ([`app-errors.ts`](file:///e:/ai-assignment/backend/src/shared/errors/app-errors.ts))

All application errors extend `AppError` and carry:
- `statusCode` — HTTP status
- `code` — machine-readable string
- `isOperational` — distinguishes expected vs unexpected failures

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
| `InternalError` | 500 | `INTERNAL_ERROR` |

---

### Global Error Handler ([`error-handler.ts`](file:///e:/ai-assignment/backend/src/shared/middleware/error-handler.ts))

Centralized Fastify error handler that translates:
- **ZodError** → `400` with `VALIDATION_ERROR` and field-level details
- **AppError subclasses** → their respective status codes
- **Fastify errors** (< 500) → pass-through status
- **Unknown errors** → `500` (stack traces hidden in production)

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

**AuthService** — handles login, logout, and token verification:
- `login(email, password)` → validates credentials, returns JWT + user info
- `logout(token)` → invalidates token via `SessionStore`
- `verifyToken(token)` → checks invalidation + JWT validity → returns `AuthenticatedUser`

**Auth Middleware** — Fastify `preHandler` hook:
- Extracts `Bearer` token from `Authorization` header
- Calls `authService.verifyToken()`
- Attaches `request.currentUser` for downstream handlers

**SessionStore Interface** — abstraction for token invalidation:
- `InMemorySessionStore` for dev/test
- Designed for Redis replacement in production

---

### Users Module ([`modules/users/`](file:///e:/ai-assignment/backend/src/modules/users))

**UserRepository Interface** — persistence abstraction:
- `findById(id)`, `findByEmail(email)`, `create(input)`, `update(id, data)`, `findAll()`

**InMemoryUserRepository** — in-memory adapter (pre-database phase):
- Email-indexed for O(1) lookup
- `clear()` helper for test reset

**UserService** — business logic:
- `createUser()` — enforces email uniqueness, hashes password with bcrypt (12 rounds)
- `findById()` — returns user without password hash
- Passwords are **never** returned in API responses

---

### Authorization Module ([`modules/authorization/`](file:///e:/ai-assignment/backend/src/modules/authorization))

Central policy service, reused by every module that needs permission checks. Depends only on the small `MembershipLookup` interface (`findMember`), which `TeamRepository` satisfies structurally.

| Method | Allows | Error on denial |
|---|---|---|
| `assertAdmin(user)` | global `ADMIN` | `403 ADMIN_REQUIRED` |
| `assertTeamMember(user, teamId)` | `ADMIN`, or any member of the team | `403 NOT_TEAM_MEMBER` |
| `assertTeamManager(user, teamId)` | `ADMIN`, or a `MANAGER` of the team | `403 TEAM_MANAGER_REQUIRED` |
| `getTeamRole(user, teamId)` | — (returns `MANAGER` / `MEMBER` / `null`) | — |

Global `ADMIN` bypasses all team-level checks. Team roles are scoped per team: managing one team grants nothing in another.

---

### Teams Module ([`modules/teams/`](file:///e:/ai-assignment/backend/src/modules/teams))

**TeamRepository Interface** — teams plus memberships (`addMember`, `findMember`, `updateMemberRole`, `removeMember`, `listMembers`, `listMembershipsForUser`). `InMemoryTeamRepository` is the pre-database adapter.

**TeamService** business rules:
- Create team: `ADMIN` only; names unique case-insensitively (`409 TEAM_NAME_TAKEN`); optional `managerId` becomes the first `MANAGER`.
- List teams: admin sees all, everyone else only teams they belong to; paginated, sorted by name. Each team carries `myRole`.
- Get team / list members: admin or team member.
- Add / change role / remove member: admin or team manager. Duplicate → `409 ALREADY_TEAM_MEMBER`; unknown user → `404 USER_NOT_FOUND`; non-member target → `404 MEMBER_NOT_FOUND`.
- A team must always keep at least one manager: demoting or removing the last one → `422 TEAM_REQUIRES_MANAGER`.
- Authorization is evaluated per request against current membership, so removal takes effect immediately (JWT carries only the *global* role).

---

### Work Items Module ([`modules/work-items/`](file:///e:/ai-assignment/backend/src/modules/work-items))

**Domain** — a `WorkItem` has `title`, `description`, `type` (`CUSTOMER_ISSUE`, `ENGINEERING_PROBLEM`, `PAYMENT_INVESTIGATION`, `PRODUCTION_INCIDENT`, `COMPLIANCE_REQUEST`, `APPROVAL_TASK`), `status`, `priority` (`LOW`/`MEDIUM`/`HIGH`/`CRITICAL`), `teamId` (immutable), `createdBy`, `assigneeId` (nullable), `version`, timestamps. New items start `OPEN` at version 1.

**Workflow** ([`work-item.workflow.ts`](file:///e:/ai-assignment/backend/src/modules/work-items/work-item.workflow.ts)) — pure functions over a transition map:

| From | Allowed next |
|---|---|
| `OPEN` | `IN_PROGRESS`, `CLOSED` |
| `IN_PROGRESS` | `OPEN`, `BLOCKED`, `IN_REVIEW`, `RESOLVED` |
| `BLOCKED` | `IN_PROGRESS` |
| `IN_REVIEW` | `IN_PROGRESS`, `RESOLVED` |
| `RESOLVED` | `IN_PROGRESS`, `CLOSED` |
| `CLOSED` | `OPEN` |

Anything else → `422 INVALID_STATUS_TRANSITION` (message lists the allowed targets).

**Permissions**

| Action | Who |
|---|---|
| Create, view, list | Team member (admin: any team) |
| Edit title / description / type / priority | Team member |
| Ordinary status transitions | Team member |
| Close, or reopen a closed item | Team **manager** |
| Set / change / clear assignee (also at creation) | Team **manager**; assignee must be a team member (`422 ASSIGNEE_NOT_TEAM_MEMBER`) |

A `PATCH` is all-or-nothing: if any changed field is not permitted, nothing is applied. Since phase E a `PATCH` also requires the caller to hold the item's edit lock.

**Optimistic concurrency** — every `PATCH` must send the `version` it read. A stale version → `409 VERSION_CONFLICT`. The check is enforced atomically by the repository (`update(id, expectedVersion, patch)` is a compare-and-set, i.e. `UPDATE … WHERE id=? AND version=?` in a SQL implementation), so of two simultaneous updates exactly one wins. Re-sending unchanged values is a no-op and does not bump the version. Since phase E the version check is a second line of defence behind the exclusive edit lock (see below).

**Listing** — non-admins only see items of teams they belong to. Filters: `teamId` (membership required), `status`, `type`, `priority`, `assigneeId`. Sort: `sortBy` = `updatedAt` (default) / `createdAt` / `priority`, `sortOrder` = `desc` (default) / `asc`; paginated with the standard meta.

---

### Work Item Locking ([`work-item-lock.*`](file:///e:/ai-assignment/backend/src/modules/work-items))

Exclusive edit locks give each work item at most one editor at a time. Reading is never blocked.

| Endpoint | Who | Behaviour |
|---|---|---|
| `POST /api/work-items/:id/lock` | Team member / admin | Acquire. Re-acquiring your own lock renews it. Held by someone else → `423 WORK_ITEM_LOCKED` |
| `POST /api/work-items/:id/lock/heartbeat` | Holder | Extend expiry to now + timeout. Not held → `409 LOCK_NOT_HELD`; held by someone else → `423` |
| `DELETE /api/work-items/:id/lock` | Holder; team manager / admin (force-release) | Release. Other members → `403 NOT_LOCK_HOLDER`; nothing locked → `409 LOCK_NOT_HELD` |
| `GET /api/work-items/:id/lock` | Team member / admin | Current lock `{workItemId, lockedBy, acquiredAt, expiresAt}` or `null` |

**Rules**
- A lock belongs to a *user* and expires `LOCK_TIMEOUT_MINUTES` (default 30) after acquisition or the last heartbeat.
- Expiry is lazy: an expired lock is treated exactly like no lock (no background job). An expired lock cannot be revived by the old holder; it must be re-acquired.
- **Editing requires the lock.** `PATCH /api/work-items/:id` → `409 LOCK_REQUIRED` if nobody holds the lock (or it expired), `423 WORK_ITEM_LOCKED` if someone else does. Holding the lock does not widen permissions (a member still cannot assign or close).
- The optimistic `version` check still runs, so a stale save is rejected even for the lock holder.
- Locked errors carry `error.lockInfo = { lockedBy, expiresAt }` so clients can show who is editing and until when.

**Atomicity** — all `WorkItemLockStore` methods must be atomic (`acquire` is "take if free, expired or already mine"). The in-memory store relies on the single-threaded event loop; a Redis store would use `SET NX PX` plus small Lua scripts. 20 simultaneous acquirers yield exactly one winner (LSTORE-010).

**Known limitation** — lock state lives in process memory, so it is lost on restart and not shared between instances until the Redis-backed store is added (phase I/J).

---

### Validation Schemas ([`common-schemas.ts`](file:///e:/ai-assignment/backend/src/shared/validation/common-schemas.ts))

Reusable Zod schemas for all list endpoints:

| Schema | Fields | Defaults | Constraints |
|---|---|---|---|
| `paginationSchema` | `page`, `pageSize` | 1, 20 | page ≥ 1, pageSize 1–100 |
| `sortSchema` | `sortBy`, `sortOrder` | undefined, `desc` | `asc` or `desc` only |

---

## API Endpoints (Implemented)

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/health` | No | Health check (status, timestamp, uptime) |
| `GET` | `/api/ready` | No | Readiness check |
| `POST` | `/api/auth/login` | No | Login with email/password → JWT token |
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

\* Assignment, closing and reopening need a team manager (or admin).

---

## API Endpoints (Planned)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/work-items/:id/activity` | Get activity history |
| `GET` | `/api/work-items/:id/comments` | List comments |
| `POST` | `/api/work-items/:id/comments` | Add comment |
| `GET` | `/api/dashboard` | Dashboard overview |

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

# Development server
npm run dev

# Run tests
npm test

# Type check
npm run typecheck

# Build
npm run build
```

---

## Test Status

**154 tests passing** across 13 test files. `npm run typecheck` is clean.

| Test File | Tests | Status |
|---|---|---|
| `config.test.ts` | 3 | ✅ All pass |
| `app-errors.test.ts` | 8 | ✅ All pass |
| `api-response.test.ts` | 4 | ✅ All pass |
| `common-schemas.test.ts` | 5 | ✅ All pass |
| `app.test.ts` | 5 | ✅ All pass |
| `modules/users/user.service.test.ts` (USER-001…011) | 11 | ✅ All pass |
| `modules/auth/auth.test.ts` (AUTH-001…014) | 14 | ✅ All pass |
| `modules/authorization/authorization.service.test.ts` (AUTHZ-001…006) | 6 | ✅ All pass |
| `modules/teams/team.test.ts` (TEAM-001…024) | 24 | ✅ All pass |
| `modules/work-items/work-item.workflow.test.ts` (WF-001…007) | 7 | ✅ All pass |
| `modules/work-items/work-item.test.ts` (WI-001…028) | 28 | ✅ All pass |
| `modules/work-items/work-item-lock.store.test.ts` (LSTORE-001…010) | 10 | ✅ All pass |
| `modules/work-items/work-item-lock.test.ts` (LOCK-001…029) | 29 | ✅ All pass |

Detailed test IDs and scenarios are tracked in [`TEST_CASES.md`](file:///e:/ai-assignment/backend/src/TEST_CASES.md).

---

## Implementation Phases

| Phase | Description | Status |
|---|---|---|
| **A** | Initial setup (config, errors, health, tests) | ✅ Complete |
| **B** | Authentication + Identity | ✅ Complete |
| **C** | Teams + Roles + Authorization | ✅ Complete |
| **D** | Work Item domain + CRUD | ✅ Complete |
| **E** | Exclusive Work Item locking / concurrency | ✅ Complete |
| **F** | Activity history | ⬜ Pending |
| **G** | Comments | ⬜ Pending |
| **H** | Search + filtering + pagination | ⬜ Pending |
| **I** | Async processing / notifications | ⬜ Pending |
| **J** | Error handling + idempotency + hardening | ⬜ Pending |
| **K** | Integration testing & verification | ⬜ Pending |

---

## Git History

```
6769112 feat(setup): initial backend setup with Fastify, config validation, error hierarchy, health endpoints, and tests
d359b69 feat(auth): add users and auth modules with JWT login/logout
```

Later commits: run `git log --oneline` (phase C: teams + authorization).
