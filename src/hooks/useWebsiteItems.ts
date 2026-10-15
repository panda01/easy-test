import { type LatestActionScriptRunRecord } from "./useActionScripts";
import { type JsonResourceState, useJsonResource } from "./useJsonResource";
import { websiteItemApiUrl, websiteItemsApiUrl } from "../utils/routePaths";
import { type WebsiteItemKind } from "../utils/websiteItemKinds";

/**
 * An action's newest script version as the action list returns it: its id,
 * its version number, the action text it was generated from (to tell whether
 * it is out of date), and its newest run.
 */
export interface NewestActionScriptRecord {
  /** The newest version's cuid. */
  id: string;
  /** Its version number: how many versions the action has, counting the oldest as 1. */
  versionNumber: number;
  /** The action's title when the version was generated. */
  actionTitle: string;
  /** The action's description when the version was generated. */
  actionDescription: string;
  /** The credential the action ran as when the version was generated, or null for logged out. */
  credentialId: string | null;
  /** That version's newest run, or null when it has not been run yet. */
  latestRun: LatestActionScriptRunRecord | null;
}

/**
 * A use case or an action as the API returns it - both have this same shape,
 * except that an action also names the credential it runs as, and the action
 * LIST also brings each action's newest script version. Dates arrive as ISO
 * strings because they travel as JSON.
 */
export interface WebsiteItemRecord {
  id: string;
  websiteId: string;
  title: string;
  description: string;
  /** Actions only: the credential the action logs in as before each run, or null to run logged out. Undefined on use cases. */
  credentialId?: string | null;
  /** Actions only: that credential's id and name, or null. Undefined on use cases. */
  credential?: { id: string; name: string } | null;
  /** The action list only: the action's newest script version and its newest run, or null when it has no versions. Undefined on use cases and on a single action. */
  newestScript?: NewestActionScriptRecord | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/** The body the client sends to create or replace a use case or an action. */
export interface WebsiteItemRequestBody {
  title: string;
  description: string;
  /** Actions only: the credential to run as, or null for logged out. Left out for use cases. */
  credentialId?: string | null;
}

/**
 * Fetches a website's active use cases or actions, newest first
 * (`GET /api/websites/:websiteId/<use-cases|actions>`).
 * @param itemKind - Which kind of website item to list
 * @param websiteId - The owning website's cuid
 * @returns The loading / error / data state of the item list
 */
export function useWebsiteItems(
  itemKind: WebsiteItemKind,
  websiteId: string,
): JsonResourceState<WebsiteItemRecord[]> {
  const itemsResource = useJsonResource(websiteItemsApiUrl(itemKind, websiteId));
  // The API is the contract for this shape; see useJsonResource for why the
  // generic hook returns unknown.
  return itemsResource as JsonResourceState<WebsiteItemRecord[]>;
}

/**
 * Fetches one active use case or action
 * (`GET /api/websites/:websiteId/<use-cases|actions>/:itemId`). A deleted or
 * unknown id reports the server's "... not found" text as `errorMessage`.
 * @param itemKind - Which kind of website item to fetch
 * @param websiteId - The owning website's cuid
 * @param itemId - The item's cuid
 * @returns The loading / error / data state of that item
 */
export function useWebsiteItem(
  itemKind: WebsiteItemKind,
  websiteId: string,
  itemId: string,
): JsonResourceState<WebsiteItemRecord> {
  const itemResource = useJsonResource(websiteItemApiUrl(itemKind, websiteId, itemId));
  return itemResource as JsonResourceState<WebsiteItemRecord>;
}
