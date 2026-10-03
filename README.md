# Newtonite Ops — Operations Management System

An internal tool for tracking operational **work items** (customer issues, engineering problems, payment investigations, production incidents, compliance requests, approval tasks) across teams. It replaces coordination that would otherwise be spread over chat, spreadsheets and email.

**What it does**

- Work items with a defined workflow (Open → In Progress → Blocked / In Review → Resolved → Closed), priorities, owners and human-friendly keys (`NW-1001`).
- **Exclusive edit locks**: many people can read an item, but only one can edit it at a time (30-minute lease, auto-renewed while editing).
- An immutable **audit trail** per item, **comments**, **search and filters**, a **dashboard**, and **notifications**.
- Teams with **managers and members**; accounts are self-service (register, then a manager adds you to a team).
- PostgreSQL storage (through Prisma) or, for a quick try-out, in-memory storage.

Tech stack: Node.js 22 · TypeScript · Fastify 5 · Zod · Prisma 6 + PostgreSQL · Vitest. The web app is plain HTML/CSS/JavaScript (no build step) served by the backend.

---

## Quick start (about 5 minutes)

### 1. Prerequisites

| Need | Version | Check |
|---|---|---|
| Node.js | 22 or newer | `node -v` |
| PostgreSQL | 14 or newer, running locally | `psql --version` |
| Internet access in the browser | — | the page loads fonts, icons and Tailwind CSS from a CDN |

> No PostgreSQL yet? You can still try the app on in-memory storage — see [Try it without a database](#try-it-without-a-database).

### 2. Install

```bash
git clone https://github.com/AyushKarn69/ai-assigment-newtonite.git
cd ai-assigment-newtonite/backend
npm install
```

`npm install` also generates the Prisma client. If you ever see an error mentioning `@prisma/client`, run `npm run db:generate`.

### 3. Create the databases

Create one database for the app and one for the tests (the test database is **emptied on every test run**, so never point it at data you care about):

```bash
psql -U postgres -c "CREATE DATABASE newtonite_ops;"
psql -U postgres -c "CREATE DATABASE newtonite_ops_test;"
```

### 4. Configure

Create `backend/.env` (it is git-ignored; copy `backend/.env.example` as a starting point):

```ini
PORT=3000
HOST=127.0.0.1
NODE_ENV=development
JWT_SECRET=change-me-to-a-long-random-string-123

DATABASE_URL=postgresql://USER:PASSWORD@127.0.0.1:5432/newtonite_ops
TEST_DATABASE_URL=postgresql://USER:PASSWORD@127.0.0.1:5432/newtonite_ops_test
```

Replace `USER` and `PASSWORD` with your PostgreSQL login. `JWT_SECRET` must be at least 16 characters.

### 5. Create the tables

```bash
npm run db:migrate
```

### 6. Start it (with demo data the first time)

**Git Bash / macOS / Linux**

```bash
SEED_DEMO_DATA=true npm run dev
```

**Windows PowerShell**

```powershell
$env:SEED_DEMO_DATA='true'; npm run dev
```

Then open **http://localhost:3000** and sign in with one of the demo accounts below.

`SEED_DEMO_DATA=true` only fills an **empty** database, so it is safe to leave on: restarting never duplicates the demo data. After the first run you can simply use `npm run dev`.

### Try it without a database

Leave `DATABASE_URL` out of `.env` (or delete it) and run `SEED_DEMO_DATA=true npm run dev`. Everything works, but all data is kept in memory and disappears when the server stops.

---

## Demo accounts

Created by `SEED_DEMO_DATA=true`. **Every demo account uses the password `demo-password-123`.**

| Email | Name | Global role | Teams (role) |
|---|---|---|---|
| `ananya@newtonite.test` | Ananya Iyer | **Administrator** | sees every team |
| `rohan@newtonite.test` | Rohan Sharma | User | Platform Engineering (**Manager**), Core Infrastructure (Member) |
| `vikram@newtonite.test` | Vikram Singh | User | Data Streaming (**Manager**), Platform Engineering (Member) |
| `meera@newtonite.test` | Meera Krishnan | User | Logistics & Billing (**Manager**), Platform Engineering (Member) |
| `arjun@newtonite.test` | Arjun Patel | User | Core Infrastructure (**Manager**), Data Streaming (Member) |
| `priya@newtonite.test` | Priya Nair | User | Platform Engineering, Data Streaming, Logistics & Billing (all Member) |

The data contains 4 teams and 14 work items in every status and priority, with history, comments and notifications.

> These are demo credentials for local use only. Never use the seed option on a real system.

---

## Using the app

1. **Sign in** as `rohan@newtonite.test` (a team manager, so the most actions are available).
2. **Dashboard** — counters (my work, high/critical, unassigned, blocked), urgent items, team load and recent activity. Click a counter to open the matching list.
3. **Work Items** — search by title, key (`NW-1003`) or text; use the quick filters, the dropdowns, sorting and paging.
4. **Create** — *New Work Item* (top right). Managers can set the owner at creation.
5. **Open an item** and try:
   - **Edit** — takes the exclusive edit lock, then save. While you edit, others see *"Being edited by …"*.
   - **Move to** — change status (only valid next steps are offered; closing and reopening need a manager).
   - **Assign / Reassign** — managers only.
   - **Notes** — add comments. **Audit trail** — every change, lock event and comment, newest first.
6. **See the lock in action** — sign in as a second person in a private window (e.g. `vikram@newtonite.test`), open the same item and try to edit while the first person is editing.
7. **Notifications** — the bell shows when you are assigned work, an item you own changes status or gets a comment, or your lock is released by a manager.

### Adding new people to teams

New accounts have **no team** until someone adds them:

1. The new person opens http://localhost:3000, clicks **Create an account**, and registers. They are signed in at once and see a welcome notice with their email address.
2. A manager or administrator opens **Teams**:
   - an **administrator** can create a team (*New Team*, optionally naming the first manager by email);
   - a **manager** (or administrator) types the person's email in *Add a person*, picks **Member** or **Manager**, and clicks **Add**.
3. Managers can also change roles and remove people. A team must always keep at least one manager.
4. The new person reloads and sees the team's work.

### Who can do what

| | Administrator | Team manager | Team member | Not in the team |
|---|---|---|---|---|
| See a team's items, comments, history | all teams | yes | yes | **no** (403) |
| Create items, edit (with lock), comment, move status | yes | yes | yes | no |
| Assign owners, close / reopen items | yes | yes | no | no |
| Add / remove people, change roles | yes | own team | no | no |
| Create teams | yes | no | no | no |
| Release someone else's edit lock | yes | yes | no | no |

---

## Running the tests

From `backend/`:

```bash
npm test            # fast: whole suite on in-memory storage
npm run test:db     # the SAME suite, every test running against PostgreSQL (TEST_DATABASE_URL)
npm run typecheck   # TypeScript checks
```

`npm test` also runs the 20 PostgreSQL-only integration tests (`src/db/`) when `TEST_DATABASE_URL` is set; they cover persistence, atomic work item + activity writes, simultaneous lock acquisition, expired-lock replacement and stale-lock rejection. A table of every test and what it proves is in [`backend/src/TEST_CASES.md`](backend/src/TEST_CASES.md).

---

## Configuration reference

All settings are environment variables (or `backend/.env`).

| Variable | Default | Meaning |
|---|---|---|
| `PORT` / `HOST` | `3000` / `0.0.0.0` | where the server listens |
| `NODE_ENV` | `development` | `production` turns on a strict content-security policy |
| `JWT_SECRET` | — (required, ≥ 16 chars) | signs login tokens |
| `JWT_EXPIRES_IN` | `24h` | login lifetime |
| `DATABASE_URL` | unset | PostgreSQL connection; **unset = in-memory storage** |
| `TEST_DATABASE_URL` | unset | database used (and emptied) by tests |
| `LOCK_TIMEOUT_MINUTES` | `30` | edit-lock lease length (renewed by the heartbeat) |
| `ALLOW_REGISTRATION` | `true` | turn self-service sign-up on/off |
| `REGISTRATION_LIMIT_PER_HOUR` | `10` | sign-ups per client address per hour |
| `SEED_DEMO_DATA` | `false` | load the demo accounts and items into an empty system |
| `LOG_LEVEL` | `info` | `warn` makes the console quieter |

### Production-style run

```bash
cd backend
npm run build
npm run db:migrate
NODE_ENV=production npm start
```

---

## How it is built

```mermaid
flowchart LR
  Browser[Web app<br/>HTML + JS] -->|JSON over HTTP| Routes
  subgraph Backend[Fastify backend]
    Routes[Routes<br/>validate input] --> Services[Services<br/>business rules + authorization]
    Services --> Repos{{Repository interfaces}}
    Services -->|activity entries| Queue[Job queue]
    Queue --> Notify[Notification worker]
  end
  Repos --> PG[(PostgreSQL<br/>via Prisma)]
  Repos -.same tests.-> Mem[(In-memory<br/>implementations)]
  Notify --> Repos
```

- **Routes → services → repository interfaces → Prisma/PostgreSQL.** Services never import Prisma; each repository has an in-memory and a Prisma implementation, selected once in `src/container.ts`.
- The decisions behind the important choices (locking, transactions, sync vs async, authorization, layering) are explained, with their trade-offs, in [`ENGINEERING_DECISIONS.md`](ENGINEERING_DECISIONS.md).
- Test-by-test documentation of what the suite proves is in [`backend/src/TEST_CASES.md`](backend/src/TEST_CASES.md).

```
backend/
  prisma/                 schema + migrations
  src/
    modules/              auth, users, teams, authorization, work-items (+ locking),
                          activity, comments, notifications, dashboard
    shared/               errors, queue, idempotency, db, validation, utils
    container.ts          wires everything; the only place that picks memory vs PostgreSQL
    seed.ts               demo data
frontend/                 the web app (served at /)
ENGINEERING_DECISIONS.md  key decisions and trade-offs
```

---

## Known limitations

These are deliberate scope choices, not hidden bugs.

- **Part of the state is still in memory.** Login sessions (logout list), idempotency keys, login/sign-up rate-limit counters and the background job queue live in the server process: they reset on restart and are not shared between several server instances. Work data (users, teams, items, locks, history, comments, notifications) is in PostgreSQL. The natural next step is Redis for these.
- **A restart can drop pending notifications.** Notifications are produced by an in-process queue (retried, then dead-lettered). A crash between saving a change and delivering its notification loses that notification; the history entry is never lost. A transactional "outbox" would close this.
- **Lock expiry is not logged.** Locks expire lazily (an expired lock is simply treated as absent), so no event is recorded at the moment of expiry — the next person's *started editing* entry shows it happened.
- **Lock timing uses the application server's clock.** With several servers whose clocks drift, a lease could end slightly early or late. A single server (or synchronised clocks) is assumed.
- **Registration is open and unverified.** Anyone who can reach the server can create an account (rate-limited, switchable with `ALLOW_REGISTRATION`). There is no email verification, password reset, or multi-factor sign-in. New accounts can see nothing until a manager adds them.
- **No account administration screen.** There is no UI to disable a user or change someone's global role; this is done in the database.
- **Search is simple substring matching** (case-insensitive over title, description and key), not ranked full-text search.
- **Updates appear by polling** (dashboard every 30 s, open item every 15 s, notifications every 20 s); there is no live push.
- **Deliberately not built** (present in the design mockups but with no backend): approvals and sign-off flows, SLA / overdue tracking, linked dependencies, system telemetry, batch operations, CSV export, SSO / FIDO / TOTP.
- **The page needs internet** for fonts, icons and Tailwind (CDN). The production content-security policy allows exactly those sources; precompiling the CSS would allow a stricter policy and offline use.
- **Tested on Windows with Node 22 and PostgreSQL 17.** Other environments should work but have not been exercised.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Invalid environment configuration` on start | `JWT_SECRET` missing or shorter than 16 characters in `backend/.env` |
| `password authentication failed` | wrong user/password in `DATABASE_URL` |
| `relation "User" does not exist` | run `npm run db:migrate` |
| `Cannot find module '@prisma/client'` / client not generated | run `npm run db:generate` |
| `EADDRINUSE` | something else uses port 3000 — change `PORT` or stop the other process |
| Page looks unstyled or icons show as words | the browser cannot reach the CDN (offline / blocked) |
| Demo users missing | the database already had data; the seed only fills an empty one. Reset by dropping and recreating the database, then `db:migrate` and start with `SEED_DEMO_DATA=true` |
