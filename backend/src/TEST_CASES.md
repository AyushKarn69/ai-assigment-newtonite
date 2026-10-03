# Test Cases

## Phase A — Initial Setup

| Test ID | Feature | Scenario | Expected Result | Status |
|-----------|-------------------|----------------------------------------|--------------------------------------|--------|
| SETUP-001 | Config | createTestConfig returns valid defaults | All defaults present and correct | PASS |
| SETUP-002 | Config | createTestConfig accepts overrides | Overridden values applied, others kept | PASS |
| SETUP-003 | Config | Config object is frozen | Assignment throws TypeError | PASS |
| SETUP-004 | AppError | AppError has correct properties | statusCode, code, message, isOperational set | PASS |
| SETUP-005 | BadRequestError | Default construction | statusCode=400, code=BAD_REQUEST | PASS |
| SETUP-006 | UnauthorizedError | Default construction | statusCode=401, code=UNAUTHORIZED | PASS |
| SETUP-007 | ForbiddenError | Default construction | statusCode=403, code=FORBIDDEN | PASS |
| SETUP-008 | NotFoundError | Default construction | statusCode=404, code=NOT_FOUND | PASS |
| SETUP-009 | ConflictError | Default construction | statusCode=409, code=CONFLICT | PASS |
| SETUP-010 | LockedError | Construction with lock info | statusCode=423, lockInfo attached | PASS |
| SETUP-011 | InternalError | Not operational flag | statusCode=500, isOperational=false | PASS |
| SETUP-012 | ApiResponse | successResponse wraps data | success=true, data present | PASS |
| SETUP-013 | ApiResponse | successResponse includes pagination | meta field present | PASS |
| SETUP-014 | ApiResponse | errorResponse wraps error | success=false, error.code/message present | PASS |
| SETUP-015 | ApiResponse | errorResponse includes details | details attached to error | PASS |
| SETUP-016 | Health | GET /api/health | 200 with status=ok, timestamp, uptime | PASS |
| SETUP-017 | Readiness | GET /api/ready | 200 with status=ready | PASS |
| SETUP-018 | Routing | Unknown route | 404 response | PASS |
| SETUP-019 | Error Handler | AppError formatting | Correct statusCode, code, message | PASS |
| SETUP-020 | Error Handler | ZodError formatting | 400 with VALIDATION_ERROR and details | PASS |
| SETUP-021 | Pagination Schema | Default values | page=1, pageSize=20 | PASS |
| SETUP-022 | Pagination Schema | Max pageSize enforcement | pageSize=200 rejected | PASS |
| SETUP-023 | Pagination Schema | Negative page rejected | page=-1 rejected | PASS |
| SETUP-024 | Sort Schema | Default values | sortOrder=desc, sortBy undefined | PASS |
| SETUP-025 | Sort Schema | Invalid sortOrder rejected | sortOrder=invalid rejected | PASS |

## Phase B — Users & Authentication

| Test ID | Feature | Scenario | Expected Result | Status |
|---|---|---|---|---|
| USER-001 | UserService | createUser returns the user | No passwordHash/password in result; role=USER, isActive=true | PASS |
| USER-002 | UserService | Password storage | Stored value is a bcrypt hash, never the plain password | PASS |
| USER-003 | UserService | Email normalisation | Email lowercased; lookup is case-insensitive | PASS |
| USER-004 | UserService | Duplicate email (any case) | ConflictError | PASS |
| USER-005 | UserService | Explicit role on create | Role honoured (ADMIN) | PASS |
| USER-006 | UserService | findById | User returned without password hash | PASS |
| USER-007 | UserService | findById unknown id | NotFoundError | PASS |
| USER-008 | UserService | findByIdInternal unknown id | null | PASS |
| USER-009 | UserRepository | update merges fields | updatedAt bumped; email index re-pointed to new email | PASS |
| USER-010 | UserRepository | update unknown id | Throws 'User not found' | PASS |
| USER-011 | UserRepository | clear | All users and email index removed | PASS |
| AUTH-001 | Login | Valid credentials | 200, token + user info, no passwordHash | PASS |
| AUTH-002 | Login | Email in different case | 200 | PASS |
| AUTH-003 | Login | Wrong password | 401 INVALID_CREDENTIALS | PASS |
| AUTH-004 | Login | Unknown email | 401 INVALID_CREDENTIALS (same as wrong password) | PASS |
| AUTH-005 | Login | Disabled account | 401 ACCOUNT_DISABLED | PASS |
| AUTH-006 | Login | Invalid email format / missing password | 400 VALIDATION_ERROR | PASS |
| AUTH-007 | GET /api/users/me | Valid token | 200 with authenticated user | PASS |
| AUTH-008 | Auth Middleware | No Authorization header | 401 MISSING_AUTH | PASS |
| AUTH-009 | Auth Middleware | Malformed token | 401 INVALID_TOKEN | PASS |
| AUTH-010 | Auth Middleware | Token signed with another secret | 401 INVALID_TOKEN | PASS |
| AUTH-011 | Auth Middleware | Expired token | 401 INVALID_TOKEN | PASS |
| AUTH-012 | Logout | Token used after logout | Logout 200; later request 401 TOKEN_INVALIDATED | PASS |
| AUTH-013 | Logout | Other session of same user | Unaffected, still 200 | PASS |
| AUTH-014 | Logout | No token | 401 | PASS |

## Phase C — Teams & Authorization

| Test ID | Feature | Scenario | Expected Result | Status |
|---|---|---|---|---|
| AUTHZ-001 | AuthorizationService | isAdmin | True only for global ADMIN | PASS |
| AUTHZ-002 | AuthorizationService | assertAdmin | Throws ForbiddenError ADMIN_REQUIRED for non-admins | PASS |
| AUTHZ-003 | AuthorizationService | getTeamRole | MANAGER / MEMBER for that team, null otherwise | PASS |
| AUTHZ-004 | AuthorizationService | assertTeamMember | Allows member, manager, admin; outsider 403 NOT_TEAM_MEMBER | PASS |
| AUTHZ-005 | AuthorizationService | assertTeamManager | Allows manager, admin; member/outsider TEAM_MANAGER_REQUIRED | PASS |
| AUTHZ-006 | AuthorizationService | Manager of another team | Forbidden (no cross-team rights) | PASS |
| TEAM-001 | Auth | Team endpoint without token | 401 | PASS |
| TEAM-002 | Create Team | Admin creates team with managerId | 201; manager listed as MANAGER; admin myRole=null | PASS |
| TEAM-003 | Create Team | Non-admin creates team | 403 ADMIN_REQUIRED | PASS |
| TEAM-004 | Create Team | Duplicate name, different case | 409 TEAM_NAME_TAKEN | PASS |
| TEAM-005 | Create Team | Blank name / unknown managerId | 400 VALIDATION_ERROR / 404 USER_NOT_FOUND; no team left behind | PASS |
| TEAM-006 | List Teams | Member lists teams | Only own teams, with myRole | PASS |
| TEAM-007 | List Teams | User with no teams | 200, empty list, totalCount=0 | PASS |
| TEAM-008 | List Teams | Admin lists teams | All teams visible | PASS |
| TEAM-009 | List Teams | Pagination | meta page/pageSize/hasNext/hasPrev correct; pageSize=1000 rejected (400) | PASS |
| TEAM-010 | Get Team | Member, manager, admin, outsider | 200 with myRole for members/admin; outsider 403 NOT_TEAM_MEMBER | PASS |
| TEAM-011 | Get Team | Unknown id / malformed id | 404 TEAM_NOT_FOUND / 400 | PASS |
| TEAM-012 | List Members | Member lists members | Names, emails, roles; no password data | PASS |
| TEAM-013 | List Members | Outsider lists members | 403 | PASS |
| TEAM-014 | Add Member | Manager adds user without role | 201, default role MEMBER; user can now read team | PASS |
| TEAM-015 | Add Member | Plain member adds user | 403 TEAM_MANAGER_REQUIRED | PASS |
| TEAM-016 | Add Member | Manager of a different team | 403 | PASS |
| TEAM-017 | Add Member | Admin (not a member) adds manager | 201, role MANAGER | PASS |
| TEAM-018 | Add Member | Duplicate / unknown user / invalid role | 409 ALREADY_TEAM_MEMBER / 404 USER_NOT_FOUND / 400 | PASS |
| TEAM-019 | Change Role | Member tries; manager promotes | 403; 200, promoted user gains manager powers | PASS |
| TEAM-020 | Change Role | Target is not a member | 404 MEMBER_NOT_FOUND | PASS |
| TEAM-021 | Last Manager | Demote or remove the only manager | 422 TEAM_REQUIRES_MANAGER | PASS |
| TEAM-022 | Last Manager | Manager steps down after another is promoted | 200; remaining manager keeps role | PASS |
| TEAM-023 | Remove Member | Removed member requests team | Removal 200; next request 403 | PASS |
| TEAM-024 | Remove Member | Member removes others / target not a member | 403 / 404 MEMBER_NOT_FOUND | PASS |

## Phase D — Work Items

| Test ID | Feature | Scenario | Expected Result | Status |
|---|---|---|---|---|
| WF-001 | Workflow | Happy path OPEN→IN_PROGRESS→IN_REVIEW→RESOLVED→CLOSED | Each step allowed | PASS |
| WF-002 | Workflow | Skipping stages (OPEN→RESOLVED, OPEN→IN_REVIEW, BLOCKED→RESOLVED, IN_REVIEW→CLOSED) | Not allowed | PASS |
| WF-003 | Workflow | BLOCKED item | Can only resume via IN_PROGRESS | PASS |
| WF-004 | Workflow | Reopening | RESOLVED→IN_PROGRESS and CLOSED→OPEN allowed; CLOSED→IN_PROGRESS not | PASS |
| WF-005 | Workflow | Transition to same status | Never allowed | PASS |
| WF-006 | Workflow | Every status | Has at least one way out | PASS |
| WF-007 | Workflow | Manager requirement | Only closing, and reopening a closed item, need a manager | PASS |
| WI-001 | Auth | Work item endpoint without token | 401 | PASS |
| WI-002 | Create | Member creates item | 201; status=OPEN, priority=MEDIUM, version=1, createdBy set, assignee null | PASS |
| WI-003 | Create | Non-member creates in team | 403 NOT_TEAM_MEMBER | PASS |
| WI-004 | Create | Unknown team | 404 TEAM_NOT_FOUND | PASS |
| WI-005 | Create | Blank/overlong title, bad type, bad priority, bad teamId | 400 VALIDATION_ERROR each | PASS |
| WI-006 | Create | Assignee at creation | Member 403 TEAM_MANAGER_REQUIRED; manager 201; non-team assignee 422 ASSIGNEE_NOT_TEAM_MEMBER | PASS |
| WI-007 | Get | Member, admin, outsider | 200 / 200 / 403 NOT_TEAM_MEMBER | PASS |
| WI-008 | Get | Unknown id / malformed id | 404 WORK_ITEM_NOT_FOUND / 400 | PASS |
| WI-009 | Update | Member edits title, priority, description | 200; version 1→2; updatedAt advances; createdBy unchanged | PASS |
| WI-010 | Update | Re-sending identical values | 200 no-op; version not bumped | PASS |
| WI-011 | Update | Missing version / no fields / blank title | 400 each | PASS |
| WI-012 | Concurrency | Stale version | 409 VERSION_CONFLICT; stored item unchanged | PASS |
| WI-013 | Concurrency | Repository compare-and-set: two racing writers with the same version | Exactly one succeeds; final version 2 | PASS |
| WI-014 | Update | Outsider update; attempt to change teamId | 403; teamId ignored (400, nothing to update) and unchanged | PASS |
| WI-015 | Update | Unknown item | 404 | PASS |
| WI-016 | Workflow | Member walks OPEN→IN_PROGRESS→BLOCKED→IN_PROGRESS→IN_REVIEW→RESOLVED | All 200; version increments each step | PASS |
| WI-017 | Workflow | Invalid transition OPEN→RESOLVED | 422 INVALID_STATUS_TRANSITION listing allowed statuses | PASS |
| WI-018 | Workflow | Close / reopen closed item | Member 403 TEAM_MANAGER_REQUIRED; manager 200 | PASS |
| WI-019 | Workflow | CLOSED→IN_PROGRESS as manager | 422 (only CLOSED→OPEN allowed) | PASS |
| WI-020 | Assignment | Assign / unassign / reassign | Member 403; manager 200 (including assigneeId=null) | PASS |
| WI-021 | Assignment | Assignee outside the team | 422 ASSIGNEE_NOT_TEAM_MEMBER | PASS |
| WI-022 | Assignment | Member sends title change + assignee change | 403 and the title change is NOT applied (all-or-nothing) | PASS |
| WI-023 | List | User lists items | Only items from teams the user belongs to | PASS |
| WI-024 | List | User with no teams / admin | Empty page / items from all teams | PASS |
| WI-025 | List | teamId filter | Non-member 403; member sees that team's items | PASS |
| WI-026 | List | Filters: status, type, priority, assigneeId | Correct subset each; invalid enum 400 | PASS |
| WI-027 | List | Sorting by priority and createdAt, both directions | Correct order; default is updatedAt desc; invalid sortBy 400 | PASS |
| WI-028 | List | Pagination | Correct slices and meta (totalPages, hasNext, hasPrev); pageSize>100 rejected | PASS |

## Phase E — Work Item Locking

| Test ID | Feature | Scenario | Expected Result | Status |
|---|---|---|---|---|
| LSTORE-001 | Lock Store | Acquire a free lock | Acquired; expiresAt = now + TTL | PASS |
| LSTORE-002 | Lock Store | Acquire a lock held by someone else | Refused; holder reported; expiry unchanged | PASS |
| LSTORE-003 | Lock Store | Holder re-acquires | Renewed; acquiredAt kept, expiresAt extended | PASS |
| LSTORE-004 | Lock Store | Acquire after expiry (exactly at expiry time) | Taken over by the new user | PASS |
| LSTORE-005 | Lock Store | get on active / expired / unknown lock | Lock / null / null | PASS |
| LSTORE-006 | Lock Store | extend | Only the active holder; null for others, expired or unknown | PASS |
| LSTORE-007 | Lock Store | release | Only the holder can release | PASS |
| LSTORE-008 | Lock Store | forceRelease | Removes the lock regardless of holder | PASS |
| LSTORE-009 | Lock Store | Locks on different items | Independent | PASS |
| LSTORE-010 | Lock Store | 20 simultaneous acquirers | Exactly one wins; all see the same holder | PASS |
| LOCK-001 | Auth | Lock endpoint without token | 401 | PASS |
| LOCK-002 | Acquire | Member acquires | 200; lockedBy self; expiresAt = now + LOCK_TIMEOUT_MINUTES | PASS |
| LOCK-003 | Acquire | Outsider / unknown item / admin / malformed id | 403 NOT_TEAM_MEMBER / 404 / 200 / 400 | PASS |
| LOCK-004 | Acquire | Second user while held | 423 WORK_ITEM_LOCKED with error.lockInfo {lockedBy, expiresAt} | PASS |
| LOCK-005 | Acquire | Holder re-acquires | 200; acquiredAt unchanged, expiry renewed | PASS |
| LOCK-006 | Acquire | Two users acquire simultaneously | Exactly one 200 and one 423 | PASS |
| LOCK-007 | Acquire | Lock on item A, acquire item B | Independent, both succeed | PASS |
| LOCK-008 | Inspect | GET lock when free / held | data null / lock details | PASS |
| LOCK-009 | Inspect | Outsider inspects; member reads locked item | 403; item still readable | PASS |
| LOCK-010 | Heartbeat | Heartbeat at 8 of 10 minutes | Expiry pushed to now + timeout; still held after a further 8 minutes | PASS |
| LOCK-011 | Heartbeat | Non-holder heartbeat | 423 with lockInfo | PASS |
| LOCK-012 | Heartbeat | Heartbeat with no lock | 409 LOCK_NOT_HELD | PASS |
| LOCK-013 | Expiry | Lock reaches its timeout | Reported as free; another user can acquire; still 423 one minute earlier | PASS |
| LOCK-014 | Expiry | Original holder heartbeats after expiry | 409 LOCK_NOT_HELD if free; 423 naming the new holder if taken | PASS |
| LOCK-015 | Release | Holder releases | 200; others can then lock | PASS |
| LOCK-016 | Release | Another member releases | 403 NOT_LOCK_HOLDER; lock intact | PASS |
| LOCK-017 | Release | Team manager / admin force-release | 200; lock removed | PASS |
| LOCK-018 | Release | Manager of another team | 403 NOT_TEAM_MEMBER | PASS |
| LOCK-019 | Release | Release when nothing is locked | 409 LOCK_NOT_HELD | PASS |
| LOCK-020 | Enforcement | PATCH without holding the lock | 409 LOCK_REQUIRED; item unchanged | PASS |
| LOCK-021 | Enforcement | PATCH while someone else holds the lock | 423 WORK_ITEM_LOCKED with lockInfo; item unchanged | PASS |
| LOCK-022 | Enforcement | Holder edits repeatedly | All 200; lock kept afterwards | PASS |
| LOCK-023 | Enforcement | PATCH after the lock expired | 409 LOCK_REQUIRED | PASS |
| LOCK-024 | Enforcement | Holder idles past timeout, another user locks and saves, first user saves | First user gets 423; second user's edit preserved | PASS |
| LOCK-025 | Enforcement | Lock holder sends a stale version | 409 VERSION_CONFLICT (version check still active) | PASS |
| LOCK-026 | Enforcement | Edit after releasing the lock | 409 LOCK_REQUIRED | PASS |
| LOCK-027 | Enforcement | Lock on one item, edit another | 409 LOCK_REQUIRED (lock is per item) | PASS |
| LOCK-028 | Enforcement | Lock holder (member) tries to assign | 403 TEAM_MANAGER_REQUIRED (lock does not widen permissions) | PASS |
| LOCK-029 | Enforcement | Member of team A locks team B's item | 403; team B's manager can lock it | PASS |

## Phase F — Activity History

| Test ID | Feature | Scenario | Expected Result | Status |
|---|---|---|---|---|
| ACTREPO-001 | Activity Repository | Sequence numbers | Start at 1 and are independent per work item | PASS |
| ACTREPO-002 | Activity Repository | 25 concurrent appends | Distinct, gap-free sequence numbers 1..25 | PASS |
| ACTREPO-003 | Activity Repository | List scoping, type filter, ordering | Only that item's entries; filter and asc/desc work | PASS |
| ACTREPO-004 | Activity Repository | Pagination | Correct slices; totalCount unaffected by page | PASS |
| ACTREPO-005 | Activity Repository | Mutating supplied or returned objects | Stored history unchanged (immutable) | PASS |
| ACTREPO-006 | Activity Repository | Entry without changes/metadata | Both default to empty | PASS |
| ACT-001 | Recording | Create an item | CREATED entry: initial values from null, actor id+name, version 1 | PASS |
| ACT-002 | Recording | Save changing title and priority | One UPDATED entry listing exactly those two fields with before/after; version 2 | PASS |
| ACT-003 | Recording | Manager changes status and assignee | Both in one UPDATED entry, attributed to the manager | PASS |
| ACT-004 | Recording | Three successive title edits | Each 'from' equals the previous 'to' | PASS |
| ACT-005 | Recording | No-op save (same values) | Nothing recorded | PASS |
| ACT-006 | Recording | 403, 422, 409 (stale), 409 (no lock), 423 requests | Nothing recorded; only the one successful save adds an entry | PASS |
| ACT-007 | Lock events | Acquire, renew, two heartbeats | Exactly one LOCK_ACQUIRED (with expiresAt) | PASS |
| ACT-008 | Lock events | Holder releases | LOCK_RELEASED by the holder | PASS |
| ACT-009 | Lock events | Manager force-releases | LOCK_FORCE_RELEASED by manager with metadata.previousHolderId | PASS |
| ACT-010 | Lock events | Blocked acquire, refused release, outsider acquire | Nothing recorded | PASS |
| ACT-011 | Lock events | Lock taken over after expiry | Second LOCK_ACQUIRED by the new user | PASS |
| ACT-012 | Reading | Create → lock → 2 saves → release | CREATED, LOCK_ACQUIRED, UPDATED, UPDATED, LOCK_RELEASED; sequences 1..5 | PASS |
| ACT-013 | Reading | Default order / order=asc | Newest first / oldest first | PASS |
| ACT-014 | Reading | Timestamps | Taken from the clock; gaps match elapsed time | PASS |
| ACT-015 | Reading | type filter | Only that type; invalid type 400 | PASS |
| ACT-016 | Reading | Pagination | Correct slices and meta (totalPages, hasNext, hasPrev); pageSize>100 rejected | PASS |
| ACT-017 | Reading | Two items | Histories are separate; each starts at sequence 1 | PASS |
| ACT-018 | Access | No token | 401 | PASS |
| ACT-019 | Access | Member, manager, admin, other-team user | 200 / 200 / 200 / 403 NOT_TEAM_MEMBER | PASS |
| ACT-020 | Access | Unknown item / malformed id | 404 WORK_ITEM_NOT_FOUND / 400 | PASS |
| ACT-021 | Access | POST/PATCH/PUT/DELETE on the activity path (as admin) | 404 for all; history unchanged (read-only) | PASS |

## Phase G — Comments

| Test ID | Feature | Scenario | Expected Result | Status |
|---|---|---|---|---|
| COMM-001 | Auth | Comment endpoints without token | 401 | PASS |
| COMM-002 | Add | Member adds a comment | 201; author id and name, body and time recorded | PASS |
| COMM-003 | Add | Manager, admin, user from another team | 201 / 201 / 403 NOT_TEAM_MEMBER | PASS |
| COMM-004 | Add | Empty, whitespace, >5000 chars, missing, non-string | 400 VALIDATION_ERROR each; text is trimmed; exactly 5000 chars allowed | PASS |
| COMM-005 | Add | Unknown item / malformed id | 404 WORK_ITEM_NOT_FOUND / 400 | PASS |
| COMM-006 | List | Default order and order=desc | Oldest first / newest first | PASS |
| COMM-007 | List | Comments created in the same instant | Keep creation order | PASS |
| COMM-008 | List | Pagination | Correct slice and meta; pageSize>100 rejected | PASS |
| COMM-009 | List | Two items; item with no comments | Separate lists; empty list with totalCount 0 | PASS |
| COMM-010 | List | Members/admin vs other teams | 200 / 403 | PASS |
| COMM-011 | Locking | Comment while another user holds the edit lock | 201 (comments need no lock) | PASS |
| COMM-012 | Rules | Comment on a closed item | 201; the item itself is unchanged | PASS |
| COMM-013 | Activity | Add a comment | COMMENT_ADDED entry linking commentId, without duplicating the text | PASS |
| COMM-014 | Immutability | PATCH/PUT/DELETE a comment | 404 for all; comment unchanged | PASS |
| COMM-015 | Safety | Markdown and <script> in a comment | Stored verbatim (clients escape on display) | PASS |

## Phase H — Search, Filters, Keys, Dashboard

| Test ID | Feature | Scenario | Expected Result | Status |
|---|---|---|---|---|
| SRCH-001 | Search | Title substring, any case | Matching item only | PASS |
| SRCH-002 | Search | Text in the description | Matching item found | PASS |
| SRCH-003 | Search | Term present in several items | All matches, across title and description | PASS |
| SRCH-004 | Search | By key (NW-…, lower case) or number | Item found | PASS |
| SRCH-005 | Search | No match | Empty page, totalCount 0 | PASS |
| SRCH-006 | Search | Blank search | Ignored; all items | PASS |
| SRCH-007 | Search | Search combined with type/priority filters | AND semantics | PASS |
| SRCH-008 | Search | Search for another team's item | Never leaks; own team finds it | PASS |
| SRCH-009 | Search | Paging through search results | totalCount reflects the filtered set | PASS |
| SRCH-010 | Search | Search term over 200 characters | 400 | PASS |
| FILT-001 | Filter | status=BLOCKED,CLOSED | Any of the listed statuses | PASS |
| FILT-002 | Filter | priority=HIGH,CRITICAL | Both priorities | PASS |
| FILT-003 | Filter | type with two values | Both types | PASS |
| FILT-004 | Filter | Invalid, empty or malformed list values | 400 VALIDATION_ERROR | PASS |
| FILT-005 | Filter | assignee=me and assignee=unassigned | My items / unowned items | PASS |
| FILT-006 | Filter | assignee=<user id>, legacy assigneeId, bogus value | Same result for both forms; bogus 400 | PASS |
| FILT-007 | Filter | createdBy | Items reported by that user | PASS |
| FILT-008 | Filter | Several filters plus sort | Combined correctly; priority ties broken by creation time | PASS |
| KEY-001 | Keys | Sequential NW-numbers | Unique, stable, increasing by one | PASS |
| KEY-002 | Keys | 10 simultaneous creations | 10 distinct keys | PASS |
| PROF-001 | Profile | GET /api/users/me | id, email, name, role; no password data | PASS |
| WI-029 | Transitions | Create/get/update responses | Include allowedTransitions for the current status | PASS |
| WI-030 | Transitions | Take an offered transition as manager | Always accepted | PASS |
| WI-031 | Transitions | List endpoint | Items do not carry allowedTransitions | PASS |
| DASH-001 | Auth | Dashboard without token | 401 | PASS |
| DASH-002 | Counts | Member's counters | Only open work in their teams (closed/resolved excluded) | PASS |
| DASH-003 | Counts | byStatus | Every status counted | PASS |
| DASH-004 | Counts | Another member of the same team | Their own 'my work' number | PASS |
| DASH-005 | Team load | Visible teams | Open, blocked, unassigned per team | PASS |
| DASH-006 | Scope | User of a different team | Only their team's numbers | PASS |
| DASH-007 | Scope | Admin | All teams, busiest first | PASS |
| DASH-008 | Scope | User with no teams | Zeros and empty lists | PASS |
| DASH-009 | Activity | Recent activity | Newest first, capped at 10, with item key, title and actor name | PASS |
| DASH-010 | Activity | Other teams' items | Never included; admin sees them | PASS |
| DASH-011 | Counts | Block an item | Blocked counter rises by one | PASS |

## Phase I — Background Jobs & Notifications

| Test ID | Feature | Scenario | Expected Result | Status |
|---|---|---|---|---|
| QUEUE-001 | Job Queue | enqueue then drain | enqueue returns before the job runs; drain waits for it | PASS |
| QUEUE-002 | Job Queue | Two jobs, first slower | Run one at a time, in order | PASS |
| QUEUE-003 | Job Queue | Job fails twice then succeeds | Retried; succeeds; nothing dead-lettered | PASS |
| QUEUE-004 | Job Queue | Job always fails | Dead-lettered after maxAttempts with payload and error | PASS |
| QUEUE-005 | Job Queue | A failing job followed by a good one | Later job still runs | PASS |
| QUEUE-006 | Job Queue | No handler registered | Dead-lettered with explanation | PASS |
| QUEUE-007 | Job Queue | Job enqueues another job | Both processed before drain resolves | PASS |
| QUEUE-008 | Job Queue | drain on an idle queue; two drains | Resolve immediately / both resolve | PASS |
| QUEUE-009 | Job Queue | close() | Queued jobs finish; new jobs refused | PASS |
| QUEUE-010 | Job Queue | Retries and dead letters | Reported to the logger | PASS |
| NOTIF-001 | Auth | All notification endpoints without token | 401 | PASS |
| NOTIF-002 | Rules | Manager assigns an item | Assignee notified (ASSIGNED); assigner is not | PASS |
| NOTIF-003 | Rules | Create with an assignee | Assignee notified | PASS |
| NOTIF-004 | Rules | Reassign | New assignee ASSIGNED, previous UNASSIGNED | PASS |
| NOTIF-005 | Rules | Status change | Assignee and reporter notified, not the actor | PASS |
| NOTIF-006 | Rules | Assign + status change in one save | Assignee gets only the assignment notice; reporter gets the status one | PASS |
| NOTIF-007 | Rules | Comment | Assignee and reporter notified, not the commenter | PASS |
| NOTIF-008 | Rules | Assignee who is also the reporter | One notification, not two | PASS |
| NOTIF-009 | Rules | Force-release a lock | Previous holder notified | PASS |
| NOTIF-010 | Rules | Own actions, lock events, no-op saves | No notifications | PASS |
| NOTIF-011 | Rules | Rejected request | No notifications | PASS |
| NOTIF-012 | Rules | Recipient removed from the team | Not notified | PASS |
| NOTIF-013 | Rules | Admin who reported an item | Notified even though not a team member | PASS |
| NOTIF-014 | Privacy | Inboxes | Each user sees only their own | PASS |
| NOTIF-015 | List | Ordering, pagination, unread filter | Newest first; correct meta; invalid unread value 400 | PASS |
| NOTIF-016 | Count | Unread count | Follows reading | PASS |
| NOTIF-017 | Read | Mark read twice | Idempotent; first read time kept | PASS |
| NOTIF-018 | Read | Someone else's / unknown / malformed id | 404 NOTIFICATION_NOT_FOUND / 404 / 400; untouched | PASS |
| NOTIF-019 | Read | read-all | Marks only mine; returns how many changed | PASS |
| NOTIF-020 | Async | Immediately after the request | No notification yet; arrives after the queue runs | PASS |
| NOTIF-021 | Reliability | Same job replayed | No duplicate notification | PASS |
| NOTIF-022 | Reliability | Transient failure twice | Retried; delivered exactly once | PASS |
| NOTIF-023 | Reliability | Permanent notification failure | Request unaffected; job dead-lettered | PASS |
| NOTIF-024 | Reliability | Queue itself unavailable | Request still succeeds | PASS |

## Phase J — Idempotency & Hardening

| Test ID | Feature | Scenario | Expected Result | Status |
|---|---|---|---|---|
| IDEMSTORE-001 | Idempotency Store | First sight / repeat while running | new / in_progress | PASS |
| IDEMSTORE-002 | Idempotency Store | After completion | Same request replays the stored response | PASS |
| IDEMSTORE-003 | Idempotency Store | Same key, different request | conflict (before and after completion) | PASS |
| IDEMSTORE-004 | Idempotency Store | Same key, different users | Independent | PASS |
| IDEMSTORE-005 | Idempotency Store | abandon | Unfinished key can be retried; completed key keeps replaying | PASS |
| IDEMSTORE-006 | Idempotency Store | Expiry | Results after the TTL; stuck in-progress keys sooner | PASS |
| IDEMSTORE-007 | Idempotency Store | 20 simultaneous begin calls | Exactly one new, 19 in_progress | PASS |
| IDEM-001 | Idempotency-Key | Retry with the same key | First response replayed (Idempotent-Replayed: true); one item | PASS |
| IDEM-002 | Idempotency-Key | Same key, different body | 409 IDEMPOTENCY_KEY_REUSED; nothing created | PASS |
| IDEM-003 | Idempotency-Key | No key | Behaves as before (two items) | PASS |
| IDEM-004 | Idempotency-Key | Two users, same key | Independent | PASS |
| IDEM-005 | Idempotency-Key | Two simultaneous requests, same key | Exactly one item; loser gets 409 IN_PROGRESS or a replay | PASS |
| IDEM-006 | Idempotency-Key | 400/403 first, then a corrected retry | Failures are not remembered; retry succeeds | PASS |
| IDEM-007 | Idempotency-Key | Empty, spaces, 256 chars, tab | 400 INVALID_IDEMPOTENCY_KEY | PASS |
| IDEM-008 | Idempotency-Key | Comments | Posted once | PASS |
| IDEM-009 | Idempotency-Key | Team creation and member add | Replayed instead of 409 duplicate | PASS |
| IDEM-010 | Idempotency-Key | Routes that do not use it (lock) | Header ignored | PASS |
| IDEM-011 | Idempotency-Key | Unauthenticated with a key | 401; key not stored | PASS |
| IDEM-012 | Idempotency-Key | After 24 hours | Stored result forgotten; new item | PASS |
| HARD-001 | Requests | Malformed JSON | 400 INVALID_JSON, no parser internals | PASS |
| HARD-002 | Requests | Unknown route | 404 NOT_FOUND in the standard envelope | PASS |
| HARD-003 | Requests | 2 MB body | 413 | PASS |
| HARD-004 | Requests | Security headers | nosniff, frame options and HSTS present | PASS |
| HARD-005 | Requests | x-request-id | On every response, unique per request | PASS |
| HARD-006 | Shutdown | app.close() with a queued job | Job finishes first; closing twice is harmless | PASS |
| HARD-007 | Login throttle | 5 failures | 429 TOO_MANY_LOGIN_ATTEMPTS with Retry-After, even for the right password | PASS |
| HARD-008 | Login throttle | Unknown email | Same lockout (reveals nothing) | PASS |
| HARD-009 | Login throttle | Per email, case-insensitive | Other users unaffected | PASS |
| HARD-010 | Login throttle | Successful login | Clears the failure count | PASS |
| HARD-011 | Login throttle | After the 15-minute window | Lockout lifts | PASS |
| HARD-012 | Login throttle | Failures spread over time | Never accumulate | PASS |
| HARD-013 | Accounts | Disable an account | Existing token rejected immediately (ACCOUNT_DISABLED) | PASS |
| HARD-014 | Accounts | Demote an admin | Admin rights lost at once | PASS |
| HARD-015 | Accounts | Signed token for a user that does not exist | 401 INVALID_TOKEN | PASS |
| HARD-016 | Sessions | Logged-out tokens | Forgotten after they would have expired; no unbounded growth | PASS |

## Phase K — End-to-End Integration

| Test ID | Feature | Scenario | Expected Result | Status |
|---|---|---|---|---|
| INT-001 | Lifecycle | Create team → report → assign → edit → comment → resolve → close | History, search, dashboard and notifications all agree | PASS |
| INT-002 | Contention | 12 users race for one lock, twice | Exactly one winner each round; only the holder can save | PASS |
| INT-003 | Consistency | 3 runs of 25 random valid edits | Replaying the history reproduces the item; versions line up | PASS |
| INT-004 | Access | Outsiders hit every item/team endpoint | All 403; search, dashboard and inbox leak nothing | PASS |
| INT-005 | Access | Member removed from team while holding a lock | All access cut at once; manager clears the lock | PASS |
| INT-006 | Envelope | 13 successes and failures | Every response follows the standard envelope; no stack traces | PASS |
| INT-007 | Load | 25 simultaneous creations | Unique ids/keys; list, dashboard and history consistent | PASS |
| INT-008 | Jobs | After a full run | No dead-lettered jobs | PASS |

## Web App — Demo Data, Serving and UI Logic

| Test ID | Feature | Scenario | Expected Result | Status |
|---|---|---|---|---|
| SEED-001 | Demo data | Seed summary | 6 users, 4 teams, 14 items | PASS |
| SEED-002 | Demo data | Demo logins | Work; admin is a real administrator | PASS |
| SEED-003 | Demo data | Teams per person | Own teams only; admin sees all | PASS |
| SEED-004 | Demo data | Items | Span every status in use and every priority | PASS |
| SEED-005 | Demo data | A worked item's history | Genuine created, lock, update, comment events | PASS |
| SEED-006 | Demo data | Notifications | Delivered without failed jobs | PASS |
| SEED-007 | Demo data | Locks | None left held | PASS |
| SEED-008 | Demo data | Dashboard | Has counts, team load and activity | PASS |
| WEB-001 | Web app | GET / | index.html as text/html, no-cache | PASS |
| WEB-002 | Web app | .js and .css files | Correct content types | PASS |
| WEB-003 | Web app | Unknown file | 404 in the standard error format | PASS |
| WEB-004 | Web app | Path traversal (plain, encoded, nested) | 404; outside file never served | PASS |
| WEB-005 | Web app | Dotfile | 404 | PASS |
| WEB-006 | Web app | Directory | 404 | PASS |
| WEB-007 | Web app | API unaffected | Health works; unknown /api path is a JSON 404 | PASS |
| WEB-008 | Web app | Malformed percent-encoding | No crash (< 500) | PASS |
| WEB-009 | Web app | No frontend directory configured | API only; / is 404 | PASS |
| UILIB-001 | format | esc() | Neutralises markup in text and attributes; null/undefined → empty | PASS |
| UILIB-002 | format | humanize, initials, shortId | Readable labels; '?' for blank names | PASS |
| UILIB-003 | format | relativeTime | just now / s / m / h / d ago; bad input → empty | PASS |
| UILIB-004 | format | formatDuration, excerpt | Compact durations; whitespace-collapsed, ellipsised text | PASS |
| UILIB-005 | presets | Quick filters | Match the dashboard counters' definitions | PASS |
| UILIB-006 | presets | buildApiQuery defaults | Sort, page, pageSize defaults applied | PASS |
| UILIB-007 | presets | Dropdown vs preset | Explicit choice overrides only that field | PASS |
| UILIB-008 | presets | Blank search, bad sizes | Dropped / fall back to defaults | PASS |
| UILIB-009 | presets | URL round trip | Defaults omitted; values survive encoding | PASS |
| UILIB-010 | presets | pageWindow | First, last, neighbours with gaps | PASS |
| UILIB-011 | permissions | isManagerOf / isAdmin | Managers and admins only | PASS |
| UILIB-012 | permissions | transitionNeedsManager | Only closing and reopening | PASS |
| UILIB-013 | permissions | usableTransitions | Hides moves the user would be refused | PASS |
| UILIB-014 | permissions | roleLabel | Administrator / Team Manager / Team Member / No team yet | PASS |
| UILIB-015 | diff | changedFields | Only what the draft changed | PASS |
| UILIB-016 | diff | conflictRows | Flags fields both people changed differently | PASS |
| UILIB-017 | diff | Field only I changed | Not a collision | PASS |
| UILIB-018 | diff | theirOnlyChanges | Updates I did not touch | PASS |
| UILIB-019 | activity wording | Created, comment, lock events | Readable sentences | PASS |
| UILIB-020 | activity wording | Update with several changes | Readable before/after values (names for owners) | PASS |
| UILIB-021 | activity wording | Unknown type / missing name | Degrades gracefully | PASS |

### Browser verification (manual, done in the built-in browser against demo data)

These flows were exercised end to end in a real browser; they are not automated.

| Area | What was checked | Result |
|---|---|---|
| Sign in | Wrong password message; success; sign out; protected route returns to the page you wanted after login; invalid stored token falls back to login | OK |
| Sign in | Five wrong passwords show a lockout message with a live countdown | OK |
| Dashboard | Counters, urgent work, my work, team load, recent activity; matches the API | OK |
| Work items | Quick filters (counts match), search by text and by key, dropdown filters, sorting, pagination incl. out-of-range page, empty state and "Clear Active Filters" | OK |
| Create | Validation, creation with a double submit (one item), HTML in the description shown as text | OK |
| Detail | Edit with lock, save, lock released, history updated | OK |
| Detail | Version conflict: panel shows both versions; "Keep my changes" saves only my fields | OK |
| Detail | Another user holds the lock: banner, controls disabled, manager can release | OK |
| Detail | Status change, reassign (correct team members), comment with injected HTML shown as text | OK |
| Detail | Reloading mid-edit releases the lock | OK |
| Errors | 403 "Operational Clearance Denied", 404 "Item Not Located", unknown page | OK |
| Notifications | Bell count, dropdown, click-through marks read, mark all read | OK |
| Layout | Phone width: no horizontal page overflow on list, dashboard, detail | OK |

Bugs found and fixed during this pass: views stacking event listeners on a shared container (several dialogs opened for one click), dialogs left in the page after closing, and the dashboard overflowing at phone width.

## PostgreSQL / Prisma — database integration

These run against a real PostgreSQL database (`TEST_DATABASE_URL`, see `.env.example`) in `src/db/postgres.integration.test.ts`
and are skipped when it is not configured. `npm run test:db` additionally runs the **entire** suite (all phases) against
PostgreSQL instead of memory; both modes pass (366 tests).

| Test ID | Feature | Scenario | Expected Result | Status |
|---|---|---|---|---|
| DB-PERSIST-001 | Persistence | Create item, edit, comment, hold a lock; then open a brand-new connection and container | Item, history (seq 1-4), comments, team, membership, the lock (same token), login and notifications are all still there | PASS |
| DB-PERSIST-002 | Constraints | Duplicate user email, team name (any case), activity sequence, membership | Rejected by the database (unique violation) | PASS |
| DB-PERSIST-002 | Constraints | Work item in unknown team, comment/lock on unknown item | Rejected by the database (foreign key violation) | PASS |
| DB-PERSIST-003 | Numbering | 15 simultaneous creations | 15 distinct numbers; key = NW-<number> | PASS |
| DB-PERSIST-004 | Cascade | Delete a work item | Its lock, history and comments go with it | PASS |
| DB-ATOM-001 | Transaction | A save through the API | Item change and UPDATED entry stored together; entry holds the before/after values; sequence is the next number | PASS |
| DB-ATOM-002 | Transaction | History entry cannot be written (foreign key failure) | Whole transaction rolled back: item unchanged, no entry, sequence number not consumed | PASS |
| DB-ATOM-003 | Transaction | Building the history entry throws | Nothing stored | PASS |
| DB-ATOM-004 | Transaction | Create with a failing history entry; create normally | No work item left behind / item and CREATED entry (seq 1) both stored | PASS |
| DB-ATOM-005 | Invariant | Lock, two saves, comment, release, lock, force-release | Entries = the item's counter; sequences 1..n without gaps; expected order | PASS |
| DB-ATOM-006 | Ordering | 25 simultaneous appends | Distinct, gap-free sequence numbers | PASS |
| DB-ATOM-007 | Concurrency | 10 simultaneous saves by the lock holder | All land: no lost updates, 10 distinct sequences — protected by the lock, not by comparing versions | PASS |
| DB-LOCK-001 | Lock | 25 users acquire at the same instant | Exactly one winner; one lock row; losers are told the winner | PASS |
| DB-LOCK-002 | Lock | 4 users race through the API | One 200, three 423 naming the holder | PASS |
| DB-LOCK-003 | Lock | Renew, heartbeat, expiry | Renewal keeps token and start time; heartbeat at +20 min extends the 30-minute window to +50; gone exactly at expiry; times round-trip exactly | PASS |
| DB-LOCK-004 | Lock | Extend/release by non-holder, extend after expiry | Refused; only the live holder can extend or release | PASS |
| DB-LOCK-005 | Lock | Acquire while held (+29), after expiry (+30) | Refused, then the expired lease is replaced with a new token and start time; 12 simultaneous takeovers give one winner | PASS |
| DB-LOCK-006 | Stale lock | Write with a forged token, wrong user, expired lease, taken-over lease, force-released lease | All rejected (LOCK_LOST); item, version, sequence and history unchanged; a live proof is accepted | PASS |
| DB-LOCK-007 | Stale lock | Lease lost between the service's check and the write | Caught inside the transaction; the new holder's write succeeds | PASS |
| DB-LOCK-008 | Stale lock | API: wrong/right X-Lock-Token, 31 minutes idle, takeover | 409 LOCK_TOKEN_MISMATCH / 200; 409 LOCK_REQUIRED after expiry; old holder gets 423 and cannot revive; token hidden from non-holders | PASS |
| DB-LOCK-009 | Heartbeat | Four heartbeats 20 minutes apart (80 minutes total), then save | Session stays alive; save succeeds | PASS |

## Registration (self-service sign-up)

| Test ID | Feature | Scenario | Expected Result | Status |
|---|---|---|---|---|
| REG-001 | Register | Valid name, email, password | 201; account created with role USER; signed in at once (token works on /users/me); no password data in the response | PASS |
| REG-002 | Register | Body also contains role=ADMIN, isActive, id | Ignored: still a plain user; admin-only actions refused (403) | PASS |
| REG-003 | Register | Email with spaces/capitals; padded name | Stored trimmed, email lower-case | PASS |
| REG-004 | Register | Email already registered (any case, or a seeded user) | 409 EMAIL_ALREADY_EXISTS | PASS |
| REG-005 | Register | 5 simultaneous sign-ups with the same email | Exactly one account (201), four 409 | PASS |
| REG-006 | Register | Bad email, 7-char / 73-byte / multi-byte over-limit password, blank or long name, missing or non-string fields | 400 VALIDATION_ERROR each; nothing created; 8 and 72 character passwords accepted | PASS |
| REG-007 | Register | Sign in afterwards | Right password works (email any case); wrong password 401 | PASS |
| REG-008 | Register | Stored password | Only a bcrypt hash | PASS |
| REG-009 | Register | New account's view of the system | No teams, empty lists, zero dashboard; others' items 403; cannot create items | PASS |
| REG-010 | Team | Manager adds the new person by email | 201; person now sees the team and can create work | PASS |
| REG-011 | Team | Add by email: unknown email, duplicate, userId+email, neither, bad email; plain member asking | 404 USER_NOT_FOUND; 409 ALREADY_TEAM_MEMBER; 400; member gets 403 before any lookup (emails cannot be probed); userId still works | PASS |
| REG-012 | Limits | More sign-ups than the per-address limit in an hour | 429 TOO_MANY_REGISTRATIONS with Retry-After; nothing created; allowed again after the hour | PASS |
| REG-013 | Switch | ALLOW_REGISTRATION=false | 403 REGISTRATION_DISABLED; nothing created | PASS |
| REG-014 | Session | Sign out after registering | Token stops working | PASS |
| UILIB-022 | sign-up form | Valid form (padded name and email) | No errors | PASS |
| UILIB-023 | sign-up form | Empty form; long name; bad emails | Each field reports its own problem | PASS |
| UILIB-024 | sign-up form | Password at 7 / 72 / 73 characters; 37 two-byte characters | Mirrors the server: 8 characters minimum, 72 bytes maximum | PASS |
| UILIB-025 | sign-up form | Confirmation differs; password already invalid | 'Do not match' only once the password itself is fine | PASS |
| UILIB-026 | sign-up form | Password strength hint | Increases with length and variety; never blocks sign-up | PASS |

### Browser verification (manual)

| Area | What was checked | Result |
|---|---|---|
| Sign-up form | Empty form, short password, mismatched confirmation, password strength hint, email already registered (with link to sign in) | OK |
| Sign-up | A real registration signs the person in and opens the dashboard with a welcome notice that shows their email | OK |
| Onboarding | After a manager adds them by email, the welcome notice disappears and the team's work shows | OK |

## Teams page (web app)

| Test ID | Feature | Scenario | Expected Result | Status |
|---|---|---|---|---|
| UILIB-027 | teams page | Sort members | Managers first, then alphabetical ignoring case; input untouched | PASS |
| UILIB-028 | teams page | Last-manager protection | Only manager is protected; with two managers neither is; a member never is | PASS |
| UILIB-029 | teams page | Summary line | '4 members · 2 managers', singular forms read correctly | PASS |
| UILIB-030 | teams page | Add-member email check | Accepts a normal email; rejects blank, partial and spaced addresses | PASS |

### Browser verification (manual)

| Area | What was checked | Result |
|---|---|---|
| Teams (administrator) | Sees all teams; *New Team* validates the name, rejects a duplicate name, creates a team with a first manager by email | OK |
| Teams (managers) | Add by email: unknown email gives a clear message; adding a registered person works; summary updates | OK |
| Teams (roles) | Promote and demote; demoting or removing the only manager is refused with an explanation and the control resets; removing a plain member works | OK |
| Teams (permissions) | A person who manages one team and is only a member of others sees add/role/remove controls only for the team they manage; no *New Team* button for non-administrators | OK |
