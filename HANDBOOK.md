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
        │   └── users/
        │       ├── user.entity.ts        # User domain + repository interface
        │       ├── user.repository.ts     # In-memory UserRepository
        │       ├── user.service.ts        # User creation, lookup, password hashing
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
```

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
| `LOCK_TIMEOUT_MINUTES` | number | 30 | No |

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

---

## API Endpoints (Planned)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/teams` | List teams |
| `GET` | `/api/teams/:id` | Get team |
| `GET` | `/api/teams/:id/members` | List team members |
| `GET` | `/api/work-items` | List work items (paginated, filtered) |
| `POST` | `/api/work-items` | Create work item |
| `GET` | `/api/work-items/:id` | Get work item |
| `PATCH` | `/api/work-items/:id` | Update work item |
| `POST` | `/api/work-items/:id/lock` | Acquire exclusive edit lock |
| `POST` | `/api/work-items/:id/lock/heartbeat` | Extend active lock |
| `DELETE` | `/api/work-items/:id/lock` | Release lock |
| `GET` | `/api/work-items/:id/activity` | Get activity history |
| `GET` | `/api/work-items/:id/comments` | List comments |
| `POST` | `/api/work-items/:id/comments` | Add comment |
| `GET` | `/api/dashboard` | Dashboard overview |

---

## Roles & Authorization (Defined, Implementation In-Progress)

| Role | Scope | Capabilities |
|---|---|---|
| `ADMIN` | Global | Full system access |
| `USER` | Global | Base authenticated access |
| `MANAGER` | Team | Manage team work, assign items, change workflow |
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

**50 tests passing** across 7 test files. `npm run typecheck` is clean.

| Test File | Tests | Status |
|---|---|---|
| `config.test.ts` | 3 | ✅ All pass |
| `app-errors.test.ts` | 8 | ✅ All pass |
| `api-response.test.ts` | 4 | ✅ All pass |
| `common-schemas.test.ts` | 5 | ✅ All pass |
| `app.test.ts` | 5 | ✅ All pass |
| `modules/users/user.service.test.ts` (USER-001…011) | 11 | ✅ All pass |
| `modules/auth/auth.test.ts` (AUTH-001…014) | 14 | ✅ All pass |

Detailed test IDs and scenarios are tracked in [`TEST_CASES.md`](file:///e:/ai-assignment/backend/src/TEST_CASES.md).

---

## Implementation Phases

| Phase | Description | Status |
|---|---|---|
| **A** | Initial setup (config, errors, health, tests) | ✅ Complete |
| **B** | Authentication + Identity | 🔄 In Progress |
| **C** | Teams + Roles + Authorization | ⬜ Pending |
| **D** | Work Item domain + CRUD | ⬜ Pending |
| **E** | Exclusive Work Item locking / concurrency | ⬜ Pending |
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
```

Phase B (auth + users) work is in the working tree and not yet committed.
