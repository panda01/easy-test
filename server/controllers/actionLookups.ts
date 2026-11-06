import {
  findWebsiteById,
  findActionForWebsite,
  findActionScriptForAction,
} from "../services/dbService.js";
import type {
  WebsiteAndAction,
  WebsiteActionAndScript,
} from "../services/actionScriptExecutionService.js";

const WEBSITE_NOT_FOUND_MESSAGE = "Website not found";
const ACTION_NOT_FOUND_MESSAGE = "Action not found";
const SCRIPT_NOT_FOUND_MESSAGE = "Script not found";

/** The outcome of looking up a chain of parent rows: all found, or the first one missing. */
export type ParentLookup<TFound> =
  | { allWereFound: true; found: TFound }
  | { allWereFound: false; notFoundMessage: string };

/**
 * Looks up the active website, then the active action under it. Later lookups
 * use the FOUND rows' ids, never the raw path parameters. Shared by the action
 * script routes and the auto-refine job routes, which nest under the same
 * `/api/websites/:websiteId/actions/:actionId` prefix.
 * @param websiteId - Path parameter: the website's cuid
 * @param actionId - Path parameter: the action's cuid
 * @returns Both rows, or the 404 message for the first one missing
 */
export async function findWebsiteAndAction(
  websiteId: string,
  actionId: string,
): Promise<ParentLookup<WebsiteAndAction>> {
  const website = await findWebsiteById(websiteId);
  if (website === null) {
    return { allWereFound: false, notFoundMessage: WEBSITE_NOT_FOUND_MESSAGE };
  }
  const action = await findActionForWebsite(website.id, actionId);
  if (action === null) {
    return { allWereFound: false, notFoundMessage: ACTION_NOT_FOUND_MESSAGE };
  }
  return { allWereFound: true, found: { website, action } };
}

/**
 * Looks up the active website, action, and script, in that order.
 * @param websiteId - Path parameter: the website's cuid
 * @param actionId - Path parameter: the action's cuid
 * @param actionScriptId - Path parameter: the script's cuid
 * @returns All three rows, or the 404 message for the first one missing
 */
export async function findWebsiteActionAndScript(
  websiteId: string,
  actionId: string,
  actionScriptId: string,
): Promise<ParentLookup<WebsiteActionAndScript>> {
  const websiteAndActionLookup = await findWebsiteAndAction(websiteId, actionId);
  if (!websiteAndActionLookup.allWereFound) {
    return websiteAndActionLookup;
  }
  const { website, action } = websiteAndActionLookup.found;
  const script = await findActionScriptForAction(website.id, action.id, actionScriptId);
  if (script === null) {
    return { allWereFound: false, notFoundMessage: SCRIPT_NOT_FOUND_MESSAGE };
  }
  return { allWereFound: true, found: { website, action, script } };
}
