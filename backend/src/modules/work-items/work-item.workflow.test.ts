import { describe, it, expect } from 'vitest';
import { WorkItemStatus } from './work-item.entity';
import { allowedTransitions, canTransition, requiresManager } from './work-item.workflow';

const { OPEN, IN_PROGRESS, BLOCKED, IN_REVIEW, RESOLVED, CLOSED } = WorkItemStatus;

describe('Work item workflow', () => {
  it('WF-001: the happy path is allowed step by step', () => {
    expect(canTransition(OPEN, IN_PROGRESS)).toBe(true);
    expect(canTransition(IN_PROGRESS, IN_REVIEW)).toBe(true);
    expect(canTransition(IN_REVIEW, RESOLVED)).toBe(true);
    expect(canTransition(RESOLVED, CLOSED)).toBe(true);
  });

  it('WF-002: items cannot skip stages', () => {
    expect(canTransition(OPEN, RESOLVED)).toBe(false);
    expect(canTransition(OPEN, IN_REVIEW)).toBe(false);
    expect(canTransition(BLOCKED, RESOLVED)).toBe(false);
    expect(canTransition(IN_REVIEW, CLOSED)).toBe(false);
  });

  it('WF-003: blocked items resume only via IN_PROGRESS', () => {
    expect(allowedTransitions(BLOCKED)).toEqual([IN_PROGRESS]);
  });

  it('WF-004: resolved and closed items can be reopened', () => {
    expect(canTransition(RESOLVED, IN_PROGRESS)).toBe(true);
    expect(canTransition(CLOSED, OPEN)).toBe(true);
    expect(canTransition(CLOSED, IN_PROGRESS)).toBe(false);
  });

  it('WF-005: no status transitions to itself', () => {
    for (const status of Object.values(WorkItemStatus)) {
      expect(canTransition(status, status)).toBe(false);
    }
  });

  it('WF-006: every status is reachable and has a way out', () => {
    for (const status of Object.values(WorkItemStatus)) {
      expect(allowedTransitions(status).length).toBeGreaterThan(0);
    }
  });

  it('WF-007: only closing and reopening-from-closed need a manager', () => {
    expect(requiresManager(RESOLVED, CLOSED)).toBe(true);
    expect(requiresManager(OPEN, CLOSED)).toBe(true);
    expect(requiresManager(CLOSED, OPEN)).toBe(true);
    expect(requiresManager(OPEN, IN_PROGRESS)).toBe(false);
    expect(requiresManager(RESOLVED, IN_PROGRESS)).toBe(false);
  });
});
