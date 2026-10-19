import {
  MIN_SLUG_SIBLING_COUNT,
  findConfirmedSlugPatterns,
  formatTokensAsPatternKey,
  patternKeyForPath,
  type PathToken,
  type PatternPage,
} from "./detectPagePatterns.js";
import { summarizePageStructure } from "./summarizePageStructure.js";

/**
 * The most pages of one URL pattern a crawl visits (the user's choice): the
 * 4th link to `/websites/{website}/actions/{action}` is skipped, so a list of
 * 40 items cannot use up the crawl's page limit. The same number of sibling
 * pages confirms a slug pattern.
 */
export const MAX_PAGES_PER_PATTERN = MIN_SLUG_SIBLING_COUNT;

/**
 * What one crawl's sampling tracks. Built fresh for every crawl and fed only
 * by that crawl's own links and pages - nothing from an earlier crawl.
 */
export interface CrawlPatternSampler {
  /** How many pages of each pattern the crawl has visited or queued. */
  pageCountByPatternKey: Map<string, number>;
  /** How many links of each pattern the crawl skipped. */
  skippedLinkCountByPatternKey: Map<string, number>;
  /** The slug patterns the crawl's visited pages confirmed (see `findConfirmedSlugPatterns`). */
  confirmedSlugPatterns: PathToken[][];
  /** The pages visited so far, as slug detection reads them. */
  visitedPages: PatternPage[];
  /**
   * The aria snapshots of visited pages that have no skeleton yet, by page
   * id. A page's skeleton is only built once slug detection compares it (see
   * `readSamplerStructureSkeleton`); its snapshot is dropped then.
   */
  ariaSnapshotsAwaitingSkeleton: Map<string, string>;
}

/** A skeleton the crawl's sampling built for a page it already recorded, to be saved on that page. */
export interface NewStructureSkeleton {
  /** The recorded page's id. */
  crawledPageId: string;
  /** The page's role skeleton (see `summarizePageStructure`). */
  structureSkeleton: string;
}

/** What adding a visited page to a crawl's sampling changed. */
export interface VisitedPatternPageOutcome {
  /** True when the confirmed slug patterns changed - the queue then needs `dropOverSampledQueueEntries`. */
  slugPatternsChanged: boolean;
  /** The skeletons slug detection just built - for this page or earlier ones - to save on their pages. */
  newStructureSkeletons: NewStructureSkeleton[];
}

/** How many links a crawl's sampling skipped, as the crawl run records it. */
export interface SkippedLinkSummary {
  /** All the links skipped. */
  skippedSimilarUrlCount: number;
  /** The links skipped per pattern key. */
  skippedSimilarUrlCountsByPattern: Record<string, number>;
}

/**
 * Starts the sampling of one crawl, with nothing counted yet.
 * @returns An empty sampler
 */
export function createCrawlPatternSampler(): CrawlPatternSampler {
  return {
    pageCountByPatternKey: new Map(),
    skippedLinkCountByPatternKey: new Map(),
    confirmedSlugPatterns: [],
    visitedPages: [],
    ariaSnapshotsAwaitingSkeleton: new Map(),
  };
}

/**
 * Adds one to a count in a map.
 * @param counts - The counts by key
 * @param key - The key to count
 */
function incrementCount(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

/**
 * Decides whether a NEW link may be queued, and counts it either way: a link
 * whose path has no variable segment always may; a link of a pattern (see
 * `patternKeyForPath`) may until `MAX_PAGES_PER_PATTERN` pages of that
 * pattern are visited or queued - after that it is counted as skipped.
 * @param sampler - The crawl's sampler, updated in place
 * @param identityUrl - The link's identity (origin + path)
 * @returns True when the link may be queued; false when it is skipped
 */
export function claimPatternSlot(sampler: CrawlPatternSampler, identityUrl: string): boolean {
  const patternKey = patternKeyForPath(identityUrl, sampler.confirmedSlugPatterns);
  const linkHasNoPattern = patternKey === null;
  if (linkHasNoPattern) return true;
  const patternIsFull = (sampler.pageCountByPatternKey.get(patternKey) ?? 0) >= MAX_PAGES_PER_PATTERN;
  if (patternIsFull) {
    incrementCount(sampler.skippedLinkCountByPatternKey, patternKey);
    return false;
  }
  incrementCount(sampler.pageCountByPatternKey, patternKey);
  return true;
}

/**
 * Describes a set of slug patterns, so a change to it can be noticed.
 * @param slugPatterns - The patterns
 * @returns Their keys, joined
 */
function describeSlugPatterns(slugPatterns: PathToken[][]): string {
  return slugPatterns.map((slugPattern) => formatTokensAsPatternKey(slugPattern)).join("\n");
}

/**
 * Reads a visited page's skeleton for slug detection, building it the first
 * time it is asked for. Slug detection only asks for the pages whose URL has
 * enough siblings to be a slug (see `findConfirmedSlugPatterns`), so no other
 * page ever gets one. A built skeleton is kept on the page, its snapshot is
 * dropped, and it is added to `newStructureSkeletons` to be saved.
 * @param sampler - The crawl's sampler, updated in place
 * @param page - A visited page slug detection is comparing
 * @param newStructureSkeletons - The skeletons built so far in this round, added to in place
 * @returns The page's skeleton, or null when it has no aria snapshot
 */
function readSamplerStructureSkeleton(
  sampler: CrawlPatternSampler,
  page: PatternPage,
  newStructureSkeletons: NewStructureSkeleton[],
): string | null {
  const pageAlreadyHasASkeleton = page.structureSkeleton !== null;
  if (pageAlreadyHasASkeleton) return page.structureSkeleton;
  const ariaSnapshot = sampler.ariaSnapshotsAwaitingSkeleton.get(page.id);
  const pageHasNoSnapshot = ariaSnapshot === undefined;
  if (pageHasNoSnapshot) return null;
  const structureSkeleton = summarizePageStructure(ariaSnapshot);
  page.structureSkeleton = structureSkeleton;
  sampler.ariaSnapshotsAwaitingSkeleton.delete(page.id);
  newStructureSkeletons.push({ crawledPageId: page.id, structureSkeleton });
  return structureSkeleton;
}

/**
 * Adds a page the crawl just recorded, and looks again for slug patterns
 * among every page visited so far. The page's aria snapshot is kept until
 * slug detection compares the page - which only happens once its URL has
 * enough siblings to be a slug - and its skeleton is built from it then (see
 * `readSamplerStructureSkeleton`). That can be this round or a later one, so
 * the skeletons built for earlier pages come back too, to be saved on them.
 * @param sampler - The crawl's sampler, updated in place
 * @param visitedPage - The page just recorded
 * @param ariaSnapshot - The page's aria snapshot, or null when it has none
 * @returns Whether the confirmed slug patterns changed, and the skeletons built this round
 */
export function recordVisitedPatternPage(
  sampler: CrawlPatternSampler,
  visitedPage: PatternPage,
  ariaSnapshot: string | null,
): VisitedPatternPageOutcome {
  sampler.visitedPages.push(visitedPage);
  const pageCanBeSummarizedLater = visitedPage.structureSkeleton === null && ariaSnapshot !== null;
  if (pageCanBeSummarizedLater) {
    sampler.ariaSnapshotsAwaitingSkeleton.set(visitedPage.id, ariaSnapshot);
  }
  const newStructureSkeletons: NewStructureSkeleton[] = [];
  const confirmedSlugPatterns = findConfirmedSlugPatterns(sampler.visitedPages, (page) =>
    readSamplerStructureSkeleton(sampler, page, newStructureSkeletons),
  );
  const slugPatternsChanged =
    describeSlugPatterns(confirmedSlugPatterns) !== describeSlugPatterns(sampler.confirmedSlugPatterns);
  sampler.confirmedSlugPatterns = confirmedSlugPatterns;
  return { slugPatternsChanged, newStructureSkeletons };
}

/**
 * Re-counts every pattern after new slug patterns were confirmed, and takes
 * the queued links a pattern now has too many of off the queue: the visited
 * pages count first, then the queue in order, and each queued link past
 * `MAX_PAGES_PER_PATTERN` for its pattern is dropped and counted as skipped.
 * Earlier skips stay counted.
 * @param sampler - The crawl's sampler, updated in place
 * @param visitedIdentityUrls - The identities the crawl recorded its pages under
 * @param queue - The links waiting to be visited, oldest first
 * @returns The queue without the dropped links, in the same order
 */
export function dropOverSampledQueueEntries<TQueuedUrl extends { identityUrl: string }>(
  sampler: CrawlPatternSampler,
  visitedIdentityUrls: Iterable<string>,
  queue: TQueuedUrl[],
): TQueuedUrl[] {
  sampler.pageCountByPatternKey = new Map();
  for (const visitedIdentityUrl of visitedIdentityUrls) {
    const patternKey = patternKeyForPath(visitedIdentityUrl, sampler.confirmedSlugPatterns);
    if (patternKey !== null) {
      incrementCount(sampler.pageCountByPatternKey, patternKey);
    }
  }
  return queue.filter((queuedUrl) => claimPatternSlot(sampler, queuedUrl.identityUrl));
}

/**
 * Totals the links a crawl's sampling skipped, for the crawl run.
 * @param sampler - The crawl's sampler
 * @returns How many links were skipped, in all and per pattern key
 */
export function summarizeSkippedLinks(sampler: CrawlPatternSampler): SkippedLinkSummary {
  const skippedSimilarUrlCountsByPattern = Object.fromEntries(sampler.skippedLinkCountByPatternKey);
  const skippedSimilarUrlCount = [...sampler.skippedLinkCountByPatternKey.values()].reduce(
    (total, skippedLinkCount) => total + skippedLinkCount,
    0,
  );
  return { skippedSimilarUrlCount, skippedSimilarUrlCountsByPattern };
}
