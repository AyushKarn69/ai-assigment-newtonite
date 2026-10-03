import { WorkItemStatus } from './work-item.entity';

const { OPEN, IN_PROGRESS, BLOCKED, IN_REVIEW, RESOLVED, CLOSED } = WorkItemStatus;

/**
 * Allowed status transitions.
 *
 *   OPEN ──► IN_PROGRESS ──► IN_REVIEW ──► RESOLVED ──► CLOSED
 *     │          │  ▲            │            │           │
 *     │          ▼  │            ▼            ▼           ▼
 *     │       BLOCKED        (back to      (reopen to   (reopen to
 *     └──────────────────────► CLOSED       IN_PROGRESS)  OPEN)
 *            (won't do)
 */
const TRANSITIONS: Readonly<Record<WorkItemStatus, readonly WorkItemStatus[]>> = {
  [OPEN]: [IN_PROGRESS, CLOSED],
  [IN_PROGRESS]: [OPEN, BLOCKED, IN_REVIEW, RESOLVED],
  [BLOCKED]: [IN_PROGRESS],
  [IN_REVIEW]: [IN_PROGRESS, RESOLVED],
  [RESOLVED]: [IN_PROGRESS, CLOSED],
  [CLOSED]: [OPEN],
};

export function allowedTransitions(from: WorkItemStatus): readonly WorkItemStatus[] {
  return TRANSITIONS[from];
}

export function canTransition(from: WorkItemStatus, to: WorkItemStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Closing or reopening a closed item is a manager decision. */
export function requiresManager(from: WorkItemStatus, to: WorkItemStatus): boolean {
  return to === CLOSED || from === CLOSED;
}
