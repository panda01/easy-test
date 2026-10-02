import { type JsonResourceState, useJsonResource } from "./useJsonResource";
import { websiteItemApiUrl, websiteItemsApiUrl } from "../utils/routePaths";
import { type WebsiteItemKind } from "../utils/websiteItemKinds";

/**
 * A use case or an action as the API returns it - both have this same shape.
 * Dates arrive as ISO strings because they travel as JSON.
 */
export interface WebsiteItemRecord {
  id: string;
  websiteId: string;
  title: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/** The body the client sends to create or replace a use case or an action. */
export interface WebsiteItemRequestBody {
  title: string;
  description: string;
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
