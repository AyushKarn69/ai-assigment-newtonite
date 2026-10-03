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
| WI-013 | Concurrency | Two simultaneous updates from same version | Exactly one 200 and one 409; final version 2 | PASS |
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
