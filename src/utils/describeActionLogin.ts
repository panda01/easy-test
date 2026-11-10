import { type WebsiteItemRecord } from "../hooks/useWebsiteItems";
import { LOGIN_ACTION_KIND } from "./actionParameters";

/** The parts of an action that say how its runs log in. */
export type ActionLoginFields = Pick<WebsiteItemRecord, "userActionKind" | "credential">;

/**
 * Says whether an action is the website's Login action. The Login kind is
 * never detected from the title, so this is exactly "the kind is Login".
 * @param action - The action's stored kind choice
 * @param action.userActionKind - The user's kind, or null / undefined for "detect"
 * @returns True for the Login action
 */
export function isLoginActionRecord(action: Pick<WebsiteItemRecord, "userActionKind">): boolean {
  return action.userActionKind === LOGIN_ACTION_KIND;
}

/**
 * Words how an action logs in, for the website's action list: "Login" for
 * the Login action itself, the credential another action runs as ("As
 * Admin"), or "Logged out".
 * @param action - The action, with its kind and credential
 * @returns The short text
 */
export function describeActionLoginShort(action: ActionLoginFields): string {
  if (isLoginActionRecord(action)) {
    return "Login";
  }
  const credentialName = action.credential?.name ?? null;
  return credentialName === null ? "Logged out" : `As ${credentialName}`;
}
