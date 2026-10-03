import { useRecordListWithAdditions } from "./useRecordListWithAdditions";
import { actionScriptsApiUrl } from "../utils/routePaths";

/**
 * One saved script version for an action, as the API returns it. Scripts are
 * immutable: converting again creates a new one. Dates arrive as ISO strings
 * because they travel as JSON. Declared here rather than imported from the
 * server: the client never imports server code.
 */
export interface ActionScriptRecord {
  id: string;
  websiteId: string;
  actionId: string;
  /** The website's name when the script was generated. */
  websiteName: string;
  /** The website's URL when the script was generated - the script's START_URL. */
  startUrl: string;
  /** The action's title when the script was generated. */
  actionTitle: string;
  /** The action's description when the script was generated. */
  actionDescription: string;
  /** Claude's one-line summary of what the script does. */
  summary: string;
  /** The assumptions Claude made where the action was ambiguous. */
  assumptions: string[];
  /** The complete `.mjs` source. */
  code: string;
  /** Warn-only rule scan results ("Line N: ..."); empty when the code is clean. */
  ruleViolations: string[];
  /** The model that wrote the script. */
  modelId: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/** What `useActionScripts` hands back. */
export interface ActionScriptsState {
  /** Every saved version, newest first. */
  scripts: ActionScriptRecord[];
  /** True until the script list for the current action has arrived. */
  isLoading: boolean;
  /** Why the script list could not be fetched, or null. */
  errorMessage: string | null;
  /** Adds a script a "Convert to script" POST just saved to the front of `scripts`. */
  addCreatedScript: (createdScript: ActionScriptRecord) => void;
}

/**
 * Fetches an action's saved script versions
 * (`GET /api/websites/:websiteId/actions/:actionId/scripts`), newest first,
 * and lets the page add the version a "Convert to script" POST just saved
 * without refetching.
 * @param websiteId - The owning website's cuid
 * @param actionId - The action's cuid
 * @returns The scripts, the list request's state, and `addCreatedScript`
 */
export function useActionScripts(websiteId: string, actionId: string): ActionScriptsState {
  /**
   * Keeps an added script only while it belongs to the action shown.
   * @param script - A script added on this visit
   * @returns True when it belongs to the current action
   */
  const scriptBelongsToThisAction = (script: ActionScriptRecord): boolean =>
    script.actionId === actionId;

  const scriptList = useRecordListWithAdditions<ActionScriptRecord>(
    actionScriptsApiUrl(websiteId, actionId),
    scriptBelongsToThisAction,
  );

  return {
    scripts: scriptList.records,
    isLoading: scriptList.isLoading,
    errorMessage: scriptList.errorMessage,
    addCreatedScript: scriptList.addRecord,
  };
}
