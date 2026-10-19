import { formatCount } from "./formatCount";
import { type PagePatternRoleRecord } from "../hooks/useCrawlRunProgress";

/** The parts of a web object its place in the object tree is read from. */
export interface WebObjectTreeFields {
  /** The pattern of one instance's page; the object's key. */
  instancePatternKey: string;
  /** The parent object's key, or null for a top-level object. */
  parentInstancePatternKey: string | null;
}

/**
 * Words what a URL pattern is to its web object, for the label above its
 * pages: "Instance page", "View · edit", "List page", or "Create page".
 * @param role - How the pattern relates to its object
 * @param viewName - For a view, the part after the object's variable; otherwise null
 * @returns The label
 */
export function describePagePatternRole(role: PagePatternRoleRecord, viewName: string | null): string {
  switch (role) {
    case "instance":
      return "Instance page";
    case "view":
      return `View · ${viewName ?? ""}`;
    case "collection":
      return "List page";
    case "create":
      return "Create page";
  }
}

/**
 * Words how many instances of a web object a crawl saw, and how many more
 * links it skipped: "3 instances", "3 instances · 2 more skipped".
 * @param instanceCount - The distinct instances the crawl saw
 * @param skippedLinkCount - The links to its pages the crawl skipped
 * @returns The summary
 */
export function describeWebObjectCounts(instanceCount: number, skippedLinkCount: number): string {
  const instanceText = formatCount(instanceCount, "instance", "instances");
  const crawlSkippedLinks = skippedLinkCount > 0;
  return crawlSkippedLinks ? `${instanceText} · ${String(skippedLinkCount)} more skipped` : instanceText;
}

/**
 * Picks the name to show for a web object: a name saved on this visit to the
 * page wins (null in it means "back to the detected name"), then the name it
 * came with.
 * @param webObjectId - The saved web object's cuid, or null when it is not saved
 * @param currentName - The name it came with (its display name, or its saved rename), or null for none
 * @param detectedName - What detection named it
 * @param renamedNamesById - The names saved on this visit, by web object id
 * @returns The name to show
 */
export function chooseWebObjectName(
  webObjectId: string | null,
  currentName: string | null,
  detectedName: string,
  renamedNamesById: ReadonlyMap<string, string | null>,
): string {
  const objectWasRenamedOnThisVisit = webObjectId !== null && renamedNamesById.has(webObjectId);
  const name = objectWasRenamedOnThisVisit ? renamedNamesById.get(webObjectId) : currentName;
  return name ?? detectedName;
}

/**
 * Works out how deeply each web object sits in the object tree: 0 for a
 * top-level object, one more than its parent otherwise. An object whose
 * parent is not in the list counts as top-level.
 * @param webObjects - The objects, each parent before its children
 * @returns Each object's depth, by its key
 */
export function measureWebObjectDepths(webObjects: WebObjectTreeFields[]): Map<string, number> {
  const depthsByKey = new Map<string, number>();
  for (const webObject of webObjects) {
    const { parentInstancePatternKey } = webObject;
    const parentDepth =
      parentInstancePatternKey === null ? undefined : depthsByKey.get(parentInstancePatternKey);
    depthsByKey.set(webObject.instancePatternKey, parentDepth === undefined ? 0 : parentDepth + 1);
  }
  return depthsByKey;
}
