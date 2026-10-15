/** An action field a plan snapshots when it is generated. */
export type ActionTextField = "title" | "description" | "credential";

/** The snapshot a plan keeps of the action that generated it. */
export interface ActionTextSnapshot {
  /** The action's title when the plan was generated. */
  actionTitle: string;
  /** The action's description when the plan was generated. */
  actionDescription: string;
  /** The credential the action ran as when the plan was generated, or null for logged out. */
  credentialId: string | null;
}

/** The action as it is now. */
export interface CurrentActionText {
  /** The action's current title. */
  title: string;
  /** The action's current description. */
  description: string;
  /** The credential the action runs as now, or null for logged out. */
  credentialId: string | null;
}

/**
 * Finds which of the action's fields changed since a plan was generated
 * from it - a plan with any change is out of date and should be converted
 * again (a different credential means a different logged-in site). Compared
 * exactly: both sides are stored trimmed by the server.
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
  const credentialChanged = script.credentialId !== action.credentialId;
  if (credentialChanged) {
    changedFields.push("credential");
  }
  return changedFields;
}
