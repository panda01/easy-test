import { useCallback, useState } from "react";
import { type JsonResourceState, useJsonResource } from "./useJsonResource";
import { useJsonMutation } from "./useJsonMutation";
import {
  type PagePatternRoleRecord,
  type PatternDetectionMethodRecord,
} from "./useCrawlRunProgress";
import { webObjectApiUrl, webObjectsApiUrl } from "../utils/routePaths";

/**
 * One saved URL pattern of a web object, as the API returns it. Dates arrive
 * as ISO strings because they travel as JSON. Declared here rather than
 * imported from the server: the client never imports server code.
 */
export interface PagePatternRecord {
  id: string;
  websiteId: string;
  crawlRunId: string;
  webObjectId: string;
  /** The pattern as a path: `/websites/{website}/actions/{action}/edit`. */
  key: string;
  role: PagePatternRoleRecord;
  /** For a `view`, the part after the object's variable (`edit`); otherwise null. */
  viewName: string | null;
  detectedBy: PatternDetectionMethodRecord;
  /** How many of the crawl's pages it matched. */
  pageCount: number;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/** The crawl a web object was found by. */
export interface WebObjectCrawlRunRecord {
  id: string;
  /** When the crawl started. */
  createdAt: string;
}

/**
 * One saved web object - a kind of thing the website has many of, as its
 * latest crawl found it - as the API returns it.
 */
export interface WebObjectRecord {
  id: string;
  websiteId: string;
  crawlRunId: string;
  /** The object whose variable comes earlier in the path, or null. */
  parentWebObjectId: string | null;
  /** The pattern of one instance's page; the object's key. */
  instancePatternKey: string;
  /** What detection named it (`Action`). */
  detectedName: string;
  /** The user's rename, or null to show `detectedName`. */
  name: string | null;
  /** How many distinct instances the crawl saw. */
  instanceCount: number;
  /** Links to its pages the crawl skipped because it already had 3 of the same pattern. */
  skippedLinkCount: number;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  /** Its patterns, in order. */
  pagePatterns: PagePatternRecord[];
  /** The crawl that found it. */
  crawlRun: WebObjectCrawlRunRecord;
}

/**
 * Fetches a website's web objects (`GET /api/websites/:websiteId/web-objects`)
 * - the ones its latest crawl with pages found - each parent before its
 * children.
 * @param websiteId - The owning website's cuid
 * @returns The loading / error / data state of the web object list
 */
export function useWebObjects(websiteId: string): JsonResourceState<WebObjectRecord[]> {
  const webObjectsResource = useJsonResource(webObjectsApiUrl(websiteId));
  // The API is the contract for this shape; see useJsonResource for why the
  // generic hook returns unknown.
  return webObjectsResource as JsonResourceState<WebObjectRecord[]>;
}

/** What `useWebObjectRenaming` hands back. */
export interface WebObjectRenaming {
  /**
   * The names saved on this visit to the page, by web object id: a string,
   * or null for "back to the detected name". A page shows these over the
   * names it fetched, so a rename shows at once without a refetch.
   */
  renamedNamesById: ReadonlyMap<string, string | null>;
  /**
   * PUTs a new name for one web object; on success it joins
   * `renamedNamesById`.
   * @param webObjectId - The web object's cuid
   * @param name - The new name, or null to use the detected name
   * @returns True when the server saved it
   */
  renameWebObject: (webObjectId: string, name: string | null) => Promise<boolean>;
  /** True while a rename request is in flight. */
  isRenaming: boolean;
  /** Why the last rename failed (the server's `{ error }` text), or null. */
  renameErrorMessage: string | null;
}

/**
 * Renames a website's web objects (`PUT /api/websites/:websiteId/web-objects/:webObjectId`)
 * and remembers the names saved on this visit, so the page can show them
 * straight away. A name lasts until the website's next crawl replaces its
 * objects.
 * @param websiteId - The owning website's cuid
 * @returns The saved names, the rename function, and the request's state
 */
export function useWebObjectRenaming(websiteId: string): WebObjectRenaming {
  const { sendJsonRequest, isSubmitting, errorMessage } = useJsonMutation();
  const [renamedNamesById, setRenamedNamesById] = useState<ReadonlyMap<string, string | null>>(
    new Map(),
  );

  const renameWebObject = useCallback(
    async (webObjectId: string, name: string | null): Promise<boolean> => {
      const result = await sendJsonRequest("PUT", webObjectApiUrl(websiteId, webObjectId), { name });
      if (!result.succeeded) return false;
      // The API is the contract for this shape, as in the typed resource hooks.
      const renamedWebObject = result.data as WebObjectRecord;
      setRenamedNamesById((previousNames) =>
        new Map(previousNames).set(renamedWebObject.id, renamedWebObject.name),
      );
      return true;
    },
    [sendJsonRequest, websiteId],
  );

  return {
    renamedNamesById,
    renameWebObject,
    isRenaming: isSubmitting,
    renameErrorMessage: errorMessage,
  };
}
