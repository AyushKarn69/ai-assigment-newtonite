# Engineering Decisions

Five decisions that shaped this system, the alternatives I weighed, and what each choice costs. There was rarely one right answer; where a trade-off is still open I say so.

---

## 1. Concurrent edits: an exclusive lock lease, not "last write wins" or version checks alone

**The problem.** Two people editing the same incident at the same time must not silently overwrite each other, and people write long descriptions — losing five minutes of typing to a rejected save is a real cost.

**What I chose.** *Single writer, many readers.* Anyone can read an item; to edit, a person takes an **edit lock** — a 30-minute lease that the browser renews with a heartbeat while the edit form is open and that expires on its own if the tab dies.

- The database enforces it: `WorkItemLock.workItemId` is the **primary key**, so a second lock row for the same item is impossible. Acquiring is one atomic step (`INSERT … ON CONFLICT DO NOTHING`, then `SELECT … FOR UPDATE` on the existing row). In a test, 25 people acquiring at the same instant produce exactly one winner.
- Every save re-checks **user + secret token + expiry inside the same transaction** that writes the change, and locks that row until commit. A lease that expires or changes hands between "the service checked" and "the database wrote" is still rejected.
- An expired lease is simply treated as absent; the next person to ask replaces it. A manager or administrator can release someone else's lock (so a colleague who went to lunch does not block the team for 30 minutes).

**Alternatives.**
- *Optimistic concurrency only* (compare a version number on save): no one is ever blocked, but the loser finds out *after* writing their text, and I'd have to build a merge screen. I kept a `version` counter, but only as a precondition ("what you were looking at is out of date") and for the audit trail — the write itself is protected by the lock, not by comparing versions.
- *Pessimistic row locks held for the whole edit session*: simple, but a database transaction held open while a human thinks is a connection leak waiting to happen.

**Cost.** People can be blocked, and a forgotten lock stays for up to 30 minutes unless a manager releases it. The lease length is a guess (configurable). Expiry is decided with the application server's clock, so several servers with drifting clocks could end a lease slightly early or late.

---

## 2. A change and its history entry are one transaction; history is append-only

**The problem.** The audit trail is only worth anything if it can never disagree with the data: no change without an entry, no entry for a change that did not happen.

**What I chose.** Creating or updating a work item writes the item **and** its activity entry in a single PostgreSQL transaction. If the entry cannot be written, the item change is rolled back (tested by forcing a foreign-key failure). Entries are insert-only (the API has no edit or delete) and ordered by a **per-item sequence number**. The sequence is handed out by incrementing a counter on the work item's own row in the same statement as the change; that row lock serialises concurrent writers, so numbers are unique and gap-free (25 simultaneous appends → 1…25), with a unique `(workItemId, sequence)` constraint as a backstop.

**Alternatives.**
- *Event sourcing* (the log **is** the data, state is rebuilt from it): the strongest guarantee, but every read needs projections and the model is heavier than this problem needs. A consistency test replays the history of randomly edited items and checks it reproduces the stored item, which gives much of the safety at a fraction of the complexity.
- *Writing the entry afterwards, in a second call*: simplest, and that is how an early version worked in memory — but a crash between the two calls leaves silent gaps.
- *A global sequence or timestamps for ordering*: timestamps tie; a global sequence is a contention point. Per-item order is all anyone reads.

**Cost.** Every write takes the item's row lock briefly (fine at this scale, a hot spot for an item edited thousands of times a second). Only changes that *succeed* are recorded; refused attempts leave no trace.

---

## 3. What is synchronous and what is asynchronous

**The problem.** Notifications ("you were assigned NW-1004") are useful but must never make saving slow or fail.

**What I chose.**
- **Synchronous, inside the request:** validation, authorization, the lock check, the work item change and its history entry. The caller gets a definite answer, and the history is correct at the moment the response is sent.
- **Asynchronous, after the response:** notifications. A committed history entry is handed to a background queue; a worker decides who to notify and stores the notifications. The queue retries with backoff, then keeps failed jobs in a dead-letter list, and a broken queue never fails the user's request (tested with a queue that always throws).
- Delivery is **at-least-once**, so the consumer is **idempotent**: a notification is unique per `(user, history entry, kind)` in the database, so a retried or replayed job cannot create duplicates.
- Create endpoints also accept an `Idempotency-Key`, so a double-click or a retry after a dropped connection cannot create two items.

**Alternatives.** Doing notifications inline (simpler, but a failure or slow step would take the save down with it); or a real message broker (BullMQ/Redis) now.

**Cost.** The queue is **in-process**: it is lost on a crash, so a notification can be missed in the window between commit and delivery (the history entry is never lost). The proper fix is a transactional *outbox* (write the "to notify" row in the same transaction) with a durable worker — I stopped short of it because it needs Redis or a polling worker, and I preferred to ship the contract and name the gap.

---

## 4. Authorization: roles per team, decided on the server on every request

**The problem.** Which actions are allowed depends on both *who you are globally* (administrator or not) and *what you are in this particular team* (manager or member) — and it must stop applying the instant someone is removed or demoted.

**What I chose.**
- Two kinds of role: a **global** role (administrator / user) and a **per-team** role (manager / member). Rules live in one `AuthorizationService`; the services call it, so a new endpoint cannot forget — and the checks are not scattered over route handlers.
- Permissions are **evaluated against the database on each request**, not copied into the login token. The token proves identity only; the account's current state and role are reloaded every time. Removing someone from a team, demoting an administrator or disabling an account takes effect immediately, not when their token expires (all tested).
- Members can create, edit (with the lock) and comment; **assigning, closing and reopening need a manager**, so ownership and "done" are management decisions. A holder of the lock gains no extra rights.
- Someone outside a team gets **403** rather than 404 for its items. Existence of an item id is not secret (ids are random UUIDs); 403 gives a clearer message. Emails are different: only managers can look a person up by email, and the permission check runs *before* the lookup, so members cannot probe which emails are registered.
- Self-registration creates a plain user in **no team**, and the server ignores any attempt to supply a role.

**Alternatives.** Putting roles in the token (one fewer lookup per request, but stale until expiry); a full permission matrix or policy engine (flexible, but far more machinery than four roles justify).

**Cost.** An extra account and membership lookup per request. The manager-only rules are my reading of a brief that only said managers "assign items and change workflow"; they live in two small places (`requiresManager`, the service) so they are easy to change.

---

## 5. One set of tests, two implementations: layered persistence behind interfaces

**The problem.** The brief called for PostgreSQL, but I wanted fast feedback while building and confidence that the real database behaves the same as my mental model.

**What I chose.** Strict layering: routes → services → **repository interfaces** → Prisma/PostgreSQL. Services never import Prisma. Each repository has an in-memory and a Prisma implementation, chosen in one file (`container.ts`) from `DATABASE_URL`. The same ~390 behavioural tests run against both: `npm test` (memory, seconds) and `npm run test:db` (every test on a real PostgreSQL). On top of that, 20 tests only make sense with a real database — constraints, rollback, atomic lock acquisition, expiry, stale-lock rejection.

This paid for itself: running the suite on PostgreSQL immediately exposed a real bug that memory could never show (the database server's time zone shifted dates passed to raw SQL by 5½ hours, silently breaking lock expiry), and writing the sign-up tests exposed a duplicate-email race that only the database's unique index had been preventing.

**Alternatives.** Mocking the database in unit tests (fast, but proves little); testing only against PostgreSQL (honest, but slow and needs a database for every contributor).

**Cost.** Every repository is written twice, and interface methods are limited to what both can do atomically (e.g. the in-memory "transaction" is just sequential steps). The in-memory version is also deliberately *not* a second source of truth in production — it exists for tests and quick trials.

---

## What I intentionally did not build

- **Approvals, SLA/overdue tracking, dependencies, telemetry, batch operations** — shown in the design mockups but with no requirement behind them; I built only screens whose behaviour exists.
- **Real-time push (WebSockets).** The UI polls every 15–30 s; with edit locks, nothing is lost if a screen is a few seconds stale.
- **Email verification, password reset, multi-factor sign-in.** Needed before real use; each pulls in an email service. Registration is rate-limited and can be switched off meanwhile.
- **Redis** (durable sessions, locks across servers, a real job queue). The seams exist (`WorkItemLockStore`, `JobQueue`, `IdempotencyStore`, `SessionStore` are interfaces); the in-memory versions are documented as single-server only.
- **Ranked full-text search.** Case-insensitive substring search is enough for a few thousand items and has no extra moving parts; PostgreSQL full-text or trigram indexes are the next step.
