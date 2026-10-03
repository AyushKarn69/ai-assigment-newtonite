// Turning activity-history entries into readable sentences. Pure, so it can be tested.

import { humanize } from './format.js';

const FIELD_LABEL = {
  title: 'title',
  description: 'description',
  priority: 'priority',
  type: 'type',
  status: 'status',
  assigneeId: 'owner',
};

/**
 * @param entry   an activity entry from the API
 * @param nameOf  (userId) => display name
 * @returns { icon, tone, actor, verb, changes }
 *   changes: [{ label, from, to }] — values already formatted for display
 */
export function describeActivity(entry, nameOf) {
  const actor = entry.actorName ?? 'Someone';

  switch (entry.type) {
    case 'CREATED':
      return { icon: 'add_circle', tone: 'neutral', actor, verb: 'created this work item', changes: [] };
    case 'UPDATED':
      return {
        icon: 'edit',
        tone: 'primary',
        actor,
        verb: 'updated this work item',
        changes: (entry.changes ?? []).map((c) => describeChange(c, nameOf)),
      };
    case 'COMMENT_ADDED':
      return { icon: 'chat_bubble', tone: 'neutral', actor, verb: 'added a comment', changes: [] };
    case 'LOCK_ACQUIRED':
      return { icon: 'lock', tone: 'muted', actor, verb: 'started editing', changes: [] };
    case 'LOCK_RELEASED':
      return { icon: 'lock_open', tone: 'muted', actor, verb: 'finished editing', changes: [] };
    case 'LOCK_FORCE_RELEASED': {
      const previous = entry.metadata?.previousHolderId;
      return {
        icon: 'lock_reset',
        tone: 'warning',
        actor,
        verb: previous ? `released ${nameOf(previous)}'s edit lock` : 'released an edit lock',
        changes: [],
      };
    }
    default:
      return { icon: 'history', tone: 'muted', actor, verb: humanize(entry.type).toLowerCase(), changes: [] };
  }
}

function describeChange(change, nameOf) {
  const label = FIELD_LABEL[change.field] ?? change.field;
  switch (change.field) {
    case 'status':
    case 'priority':
    case 'type':
      return { label, from: humanize(change.from), to: humanize(change.to) };
    case 'assigneeId':
      return {
        label,
        from: change.from ? nameOf(change.from) : 'Unassigned',
        to: change.to ? nameOf(change.to) : 'Unassigned',
      };
    case 'description':
      return { label, from: null, to: null, note: 'edited' };
    default:
      return { label, from: change.from, to: change.to };
  }
}
