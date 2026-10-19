import {
  listCrawledPageSummariesForRun,
  replaceWebsiteWebObjects,
  type WebObjectInput,
  type WebObjectName,
} from "./dbService.js";
import {
  detectPagePatterns,
  type DetectedPageGrouping,
  type PagePatternRole,
  type PatternDetectionMethod,
  type PatternPage,
} from "../utils/detectPagePatterns.js";
import { describeError } from "../utils/describeError.js";

/** One page pattern of a web object, as a crawl run's grouping lists it. */
export interface CrawlPageGroupingPattern {
  /** The pattern as a path: `/websites/{website}/actions/{action}/edit`. */
  key: string;
  /** How the pattern relates to its web object. */
  role: PagePatternRole;
  /** For a `view`, the part after the object's variable; otherwise null. */
  viewName: string | null;
  /** How the pattern's variable was recognised. */
  detectedBy: PatternDetectionMethod;
  /** The crawled pages it matched, in visiting order. */
  pageIds: string[];
}

/** One web object of a crawl run's grouping. */
export interface CrawlPageGroupingWebObject {
  /** The saved web object's cuid, or null when this run's objects are not saved (it is still running, or a newer crawl replaced them). */
  webObjectId: string | null;
  /** The pattern of one instance's page; the object's key. */
  instancePatternKey: string;
  /** The name to show: the user's rename, or the detected name. */
  displayName: string;
  /** What detection named it. */
  detectedName: string;
  /** The parent object's key, or null. */
  parentInstancePatternKey: string | null;
  /** The distinct instances the crawl saw, in visiting order. */
  instanceValues: string[];
  /** Links to its pages the crawl skipped because it already had enough of the same pattern. */
  skippedLinkCount: number;
  /** Its patterns: instance, views, list page, create page. */
  patterns: CrawlPageGroupingPattern[];
}

/** A crawl run's pages grouped into web objects - what the crawl run read returns as `pageGrouping`. */
export interface CrawlPageGrouping {
  /** The web objects, each parent before its children. */
  webObjects: CrawlPageGroupingWebObject[];
  /** The pages that belong to no web object, in visiting order. */
  standalonePageIds: string[];
}

/**
 * Reads a crawl run's `skippedSimilarUrlCountsByPattern` column - JSON, so
 * anything could be stored there - keeping only the entries that are whole
 * numbers.
 * @param storedCounts - The column's value
 * @returns The skipped link counts by pattern key; empty when the value is not an object
 */
export function readSkippedLinkCounts(storedCounts: unknown): Record<string, number> {
  const countsAreAnObject =
    typeof storedCounts === "object" && storedCounts !== null && !Array.isArray(storedCounts);
  if (!countsAreAnObject) return {};
  const countEntries = Object.entries(storedCounts).filter(
    (entry): entry is [string, number] => Number.isInteger(entry[1]),
  );
  return Object.fromEntries(countEntries);
}

/**
 * Groups a crawl run's pages into web objects (see `detectPagePatterns`) -
 * always from the run's OWN pages - and joins in the saved web objects of
 * that same run by key, for their id and the user's name. A run whose
 * objects are not saved (still running, or replaced by a newer crawl) gets
 * `webObjectId: null` and the detected names.
 * @param pages - The run's pages, in visiting order
 * @param storedSkippedLinkCounts - The run's `skippedSimilarUrlCountsByPattern` column
 * @param savedWebObjectNames - The run's saved web objects (see `findWebObjectNamesForCrawlRun`)
 * @returns The run's grouping
 */
export function buildCrawlPageGrouping(
  pages: PatternPage[],
  storedSkippedLinkCounts: unknown,
  savedWebObjectNames: WebObjectName[],
): CrawlPageGrouping {
  const detectedGrouping = detectPagePatterns(pages, readSkippedLinkCounts(storedSkippedLinkCounts));
  const savedNamesByKey = new Map(
    savedWebObjectNames.map((savedName) => [savedName.instancePatternKey, savedName]),
  );
  const webObjects = detectedGrouping.webObjects.map((webObject): CrawlPageGroupingWebObject => {
    const savedName = savedNamesByKey.get(webObject.instancePatternKey);
    return {
      webObjectId: savedName?.id ?? null,
      instancePatternKey: webObject.instancePatternKey,
      displayName: savedName?.name ?? webObject.detectedName,
      detectedName: webObject.detectedName,
      parentInstancePatternKey: webObject.parentInstancePatternKey,
      instanceValues: webObject.instanceValues,
      skippedLinkCount: webObject.skippedLinkCount,
      patterns: webObject.patterns.map(({ key, role, viewName, detectedBy, pageIds }) => ({
        key,
        role,
        viewName,
        detectedBy,
        pageIds,
      })),
    };
  });
  return { webObjects, standalonePageIds: detectedGrouping.standalonePageIds };
}

/**
 * Turns a detected grouping into the rows a crawl's end saves.
 * @param grouping - From `detectPagePatterns`
 * @returns One input per web object, parents first
 */
export function buildWebObjectInputs(grouping: DetectedPageGrouping): WebObjectInput[] {
  return grouping.webObjects.map((webObject) => ({
    instancePatternKey: webObject.instancePatternKey,
    detectedName: webObject.detectedName,
    parentInstancePatternKey: webObject.parentInstancePatternKey,
    instanceCount: webObject.instanceValues.length,
    skippedLinkCount: webObject.skippedLinkCount,
    pagePatterns: webObject.patterns.map((pattern) => ({
      key: pattern.key,
      segments: pattern.segments,
      role: pattern.role,
      viewName: pattern.viewName,
      detectedBy: pattern.detectedBy,
      pageCount: pattern.pageIds.length,
    })),
  }));
}

/**
 * Saves what a crawl that just ended found as its website's web objects,
 * REPLACING the website's previous ones, renames included (see
 * `replaceWebsiteWebObjects`): the run's pages are grouped (see
 * `detectPagePatterns`) and written in one transaction.
 *
 * NEVER rejects: the web objects are a by-product of the crawl, so a failure
 * is logged and the crawl stays finished - and, the transaction having
 * rolled back, the previous crawl's objects stay.
 * @param websiteId - The crawled website's cuid
 * @param crawlRunId - The crawl run that just ended
 * @param skippedLinkCountsByPatternKey - The links the crawl skipped, per pattern key
 * @returns Resolves once the objects are saved, or the failure is logged
 */
export async function saveCrawlWebObjects(
  websiteId: string,
  crawlRunId: string,
  skippedLinkCountsByPatternKey: Record<string, number>,
): Promise<void> {
  try {
    const pages = await listCrawledPageSummariesForRun(websiteId, crawlRunId);
    const grouping = detectPagePatterns(pages, skippedLinkCountsByPatternKey);
    await replaceWebsiteWebObjects(websiteId, crawlRunId, buildWebObjectInputs(grouping));
  } catch (saveError: unknown) {
    console.error(
      `[crawl] crawl run ${crawlRunId} of website ${websiteId} could not save its web objects: ${describeError(saveError)}`,
    );
  }
}
