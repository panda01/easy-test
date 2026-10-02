import { type WebsiteItemKind } from "./websiteItemKinds";

/*
 * Every page URL and API URL in the client is built here, so a link, a
 * navigate() call, and a fetch can never disagree about where something lives.
 * The route PATTERNS (with `:websiteId`) are declared literally in `App.tsx`.
 *
 * Ids are cuids and need no escaping, but they are still passed through
 * encodeURIComponent so a malformed id can never change the path's shape.
 */

// === Page paths ===

/** The website list page. */
export const WEBSITE_LIST_PATH = "/websites";

/** The create-website form page. */
export const NEW_WEBSITE_PATH = "/websites/new";

/**
 * Builds the path of a website's detail page.
 * @param websiteId - The website's cuid
 * @returns `/websites/<websiteId>`
 */
export function websiteDetailPath(websiteId: string): string {
  return `/websites/${encodeURIComponent(websiteId)}`;
}

/**
 * Builds the path of a website's edit form page.
 * @param websiteId - The website's cuid
 * @returns `/websites/<websiteId>/edit`
 */
export function websiteEditPath(websiteId: string): string {
  return `${websiteDetailPath(websiteId)}/edit`;
}

/**
 * Builds the path of the create form page for a use case or action.
 * @param itemKind - Which kind of website item
 * @param websiteId - The owning website's cuid
 * @returns `/websites/<websiteId>/<use-cases|actions>/new`
 */
export function newWebsiteItemPath(itemKind: WebsiteItemKind, websiteId: string): string {
  return `${websiteDetailPath(websiteId)}/${itemKind.pathSegment}/new`;
}

/**
 * Builds the path of a use case's or action's detail page.
 * @param itemKind - Which kind of website item
 * @param websiteId - The owning website's cuid
 * @param itemId - The item's cuid
 * @returns `/websites/<websiteId>/<use-cases|actions>/<itemId>`
 */
export function websiteItemDetailPath(
  itemKind: WebsiteItemKind,
  websiteId: string,
  itemId: string,
): string {
  return `${websiteDetailPath(websiteId)}/${itemKind.pathSegment}/${encodeURIComponent(itemId)}`;
}

/**
 * Builds the path of a use case's or action's edit form page.
 * @param itemKind - Which kind of website item
 * @param websiteId - The owning website's cuid
 * @param itemId - The item's cuid
 * @returns `/websites/<websiteId>/<use-cases|actions>/<itemId>/edit`
 */
export function websiteItemEditPath(
  itemKind: WebsiteItemKind,
  websiteId: string,
  itemId: string,
): string {
  return `${websiteItemDetailPath(itemKind, websiteId, itemId)}/edit`;
}

// === API urls (relative: the Vite dev server proxies /api to Express) ===

/** The website collection endpoint. */
export const WEBSITES_API_URL = "/api/websites";

/**
 * Builds the API url of one website.
 * @param websiteId - The website's cuid
 * @returns `/api/websites/<websiteId>`
 */
export function websiteApiUrl(websiteId: string): string {
  return `${WEBSITES_API_URL}/${encodeURIComponent(websiteId)}`;
}

/**
 * Builds the API url of a website's use case or action collection.
 * @param itemKind - Which kind of website item
 * @param websiteId - The owning website's cuid
 * @returns `/api/websites/<websiteId>/<use-cases|actions>`
 */
export function websiteItemsApiUrl(itemKind: WebsiteItemKind, websiteId: string): string {
  return `${websiteApiUrl(websiteId)}/${itemKind.pathSegment}`;
}

/**
 * Builds the API url of one use case or action.
 * @param itemKind - Which kind of website item
 * @param websiteId - The owning website's cuid
 * @param itemId - The item's cuid
 * @returns `/api/websites/<websiteId>/<use-cases|actions>/<itemId>`
 */
export function websiteItemApiUrl(
  itemKind: WebsiteItemKind,
  websiteId: string,
  itemId: string,
): string {
  return `${websiteItemsApiUrl(itemKind, websiteId)}/${encodeURIComponent(itemId)}`;
}
