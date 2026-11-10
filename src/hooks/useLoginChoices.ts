import { type LoginActionOption, type LoginChoices } from "../components/TitleDescriptionForm";
import { useCredentials } from "./useCredentials";
import { type WebsiteItemRecord } from "./useWebsiteItems";
import { useJsonResource } from "./useJsonResource";
import { LOGIN_ACTION_KIND } from "../utils/actionParameters";
import { websiteItemsApiUrl } from "../utils/routePaths";
import { ACTION_KIND } from "../utils/websiteItemKinds";

/** What the action create and edit pages need for the form's login fields. */
export interface LoginChoicesState {
  /** The credentials to offer and the website's Login action; null until both lists have loaded (or while not needed). */
  loginChoices: LoginChoices | null;
  /** True while either list is still loading. */
  isLoading: boolean;
  /** Why a list could not be loaded, or null. */
  errorMessage: string | null;
}

/**
 * Picks the website's Login action out of its action list, as the action
 * form names it. The action being edited is left out, so editing the Login
 * action itself does not count it as "another" one.
 * @param actions - The website's actions
 * @param editedActionId - The action being edited, or null on the create page
 * @returns The Login action's id and title, or null when there is none (other than the edited action)
 */
export function findLoginActionOption(
  actions: WebsiteItemRecord[],
  editedActionId: string | null,
): LoginActionOption | null {
  const loginAction = actions.find(
    (action) => action.userActionKind === LOGIN_ACTION_KIND && action.id !== editedActionId,
  );
  return loginAction === undefined ? null : { id: loginAction.id, title: loginAction.title };
}

/**
 * Loads what an action's form needs to say how it logs in: the website's
 * credentials (any other action picks the one it runs as) and its Login
 * action (named in the hint, and why the Kind select does not offer a
 * second Login), plus the website's default login page.
 *
 * `isNeeded` lets the shared use case / action pages call this
 * unconditionally: when it is false nothing is fetched and `loginChoices`
 * stays null.
 * @param websiteId - The owning website's cuid
 * @param isNeeded - False to skip the requests (use cases)
 * @param websiteLoginUrl - The website's default login page, or null
 * @param editedActionId - The action being edited (never counted as the website's Login action), or null on the create page
 * @returns The choices once both lists have loaded, with the loading and error state
 */
export function useLoginChoices(
  websiteId: string,
  isNeeded: boolean,
  websiteLoginUrl: string | null,
  editedActionId: string | null,
): LoginChoicesState {
  const credentialsResource = useCredentials(websiteId, isNeeded);
  const actionsResource = useJsonResource(isNeeded ? websiteItemsApiUrl(ACTION_KIND, websiteId) : null);
  // The API is the contract for this shape; see useJsonResource for why the
  // generic hook returns unknown.
  const actions = actionsResource.data as WebsiteItemRecord[] | null;
  const credentials = credentialsResource.data;
  const bothListsHaveLoaded = credentials !== null && actions !== null;
  const loginChoices: LoginChoices | null = bothListsHaveLoaded
    ? {
        credentials: credentials.map((credential) => ({ id: credential.id, name: credential.name })),
        loginAction: findLoginActionOption(actions, editedActionId),
        websiteLoginUrl,
      }
    : null;
  return {
    loginChoices,
    isLoading: credentialsResource.isLoading || actionsResource.isLoading,
    errorMessage: credentialsResource.errorMessage ?? actionsResource.errorMessage,
  };
}
