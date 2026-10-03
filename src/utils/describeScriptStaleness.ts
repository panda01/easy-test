/** An action field a script snapshots when it is generated. */
export type ActionTextField = "title" | "description";

/** The snapshot a script keeps of the action that generated it. */
export interface ActionTextSnapshot {
  /** The action's title when the script was generated. */
  actionTitle: string;
  /** The action's description when the script was generated. */
  actionDescription: string;
}

/** The action as it is now. */
export interface CurrentActionText {
  /** The action's current title. */
  title: string;
  /** The action's current description. */
  description: string;
}

/**
 * Finds which of the action's fields changed since a script was generated
 * from it - a script with any change is out of date and should be converted
 * again. Compared exactly: both sides are stored trimmed by the server.
 * @param script - The script's snapshot of the action
 * @param action - The action as it is now
 * @returns The changed fields, title first; empty when the script is up to date
 */
export function findChangedActionFields(
  script: ActionTextSnapshot,
  action: CurrentActionText,
): ActionTextField[] {
  const changedFields: ActionTextField[] = [];
  const titleChanged = script.actionTitle !== action.title;
  if (titleChanged) {
    changedFields.push("title");
  }
  const descriptionChanged = script.actionDescription !== action.description;
  if (descriptionChanged) {
    changedFields.push("description");
  }
  return changedFields;
}

/**
 * Names the changed fields for running text: "title", "description", or
 * "title and description".
 * @param changedFields - The fields that changed, as `findChangedActionFields` returns them
 * @returns The fields joined with "and"
 */
export function describeChangedActionFields(changedFields: ActionTextField[]): string {
  return changedFields.join(" and ");
}
