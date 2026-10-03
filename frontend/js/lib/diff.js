// Comparing a user's unsaved draft with the server's current copy of a work item.

export const EDITABLE_FIELDS = ['title', 'description', 'priority', 'type'];

/** Fields whose value in `draft` differs from `base`. */
export function changedFields(base, draft, fields = EDITABLE_FIELDS) {
  return fields.filter((f) => draft[f] !== undefined && draft[f] !== base[f]);
}

/**
 * After a version conflict: for every field the user changed, show their draft next
 * to what is stored now, and flag whether someone else changed that field too.
 *
 *  - `base`    the item as it was when editing began
 *  - `draft`   what the user typed
 *  - `current` the item as it is on the server now
 */
export function conflictRows(base, draft, current, fields = EDITABLE_FIELDS) {
  return changedFields(base, draft, fields).map((field) => {
    const theirsChanged = current[field] !== base[field];
    return {
      field,
      mine: draft[field],
      current: current[field],
      /** true when both people changed this field to different values */
      collides: theirsChanged && current[field] !== draft[field],
      /** true when the stored value already equals the draft (nothing to merge) */
      same: current[field] === draft[field],
    };
  });
}

/** Fields someone else changed that the user did not touch (safe to take as-is). */
export function theirOnlyChanges(base, draft, current, fields = EDITABLE_FIELDS) {
  return fields.filter(
    (f) => current[f] !== base[f] && (draft[f] === undefined || draft[f] === base[f]),
  );
}
