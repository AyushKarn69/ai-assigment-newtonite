# Initial Setup - Test Cases

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
