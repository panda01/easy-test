import { classifyPathSegment, type IdSegmentShape } from "./classifyPathSegment.js";
import { compareStructureSkeletons } from "./summarizePageStructure.js";

/**
 * How many distinct sibling values a path segment needs before it can count
 * as a slug (`/blog/a`, `/blog/b`, `/blog/c`) - and how many pages of one
 * pattern a crawl visits (see `crawlPatternSampling`).
 */
export const MIN_SLUG_SIBLING_COUNT = 3;

/** How alike (see `compareStructureSkeletons`) sibling pages must be to share a slug pattern. */
export const STRUCTURE_SIMILARITY_THRESHOLD = 0.8;

/** Path segments that, right after an object's list page, name the page that creates one. */
const CREATE_PAGE_SEGMENTS: ReadonlySet<string> = new Set(["new", "create", "add"]);

/** The placeholder (and name) used when no word comes before a variable. */
const FALLBACK_PLACEHOLDER = "item";

/** An object's name when neither its path nor its pages' titles name it. */
const FALLBACK_OBJECT_NAME = "Page";

/** What a variable path segment holds: an id of a recognised shape, or a slug. */
export type VariableValueShape = IdSegmentShape | "slug";

/** One segment of a page pattern's path. */
export type PathSegment =
  | { kind: "static"; value: string }
  | { kind: "variable"; placeholder: string; valueShape: VariableValueShape };

/** How a page pattern relates to its web object (see the `PagePattern` model). */
export type PagePatternRole = "instance" | "view" | "collection" | "create";

/** How a pattern's variable was recognised: by an id's shape, or as a slug from its siblings. */
export type PatternDetectionMethod = "idShape" | "siblingStructure";

/**
 * One path segment while patterns are being worked out: its value, or that it
 * is variable. Placeholders are only named when the pattern is written out
 * (see `buildPathSegments`).
 */
export type PathToken =
  | { kind: "static"; value: string }
  | { kind: "variable"; valueShape: VariableValueShape };

/** A crawled page as pattern detection reads it. */
export interface PatternPage {
  /** The page's id. */
  id: string;
  /** The page's identity: origin + path. */
  url: string;
  /** The page's `<title>`, or null. */
  title: string | null;
  /**
   * The page's role skeleton (see `summarizePageStructure`), or null when it
   * has none: no aria snapshot, or a URL that never had enough siblings to be
   * a slug (see `collapseSlugsAtPosition`), so it was never built.
   */
  structureSkeleton: string | null;
}

/**
 * Reads a page's role skeleton when slug detection needs it - only for pages
 * whose URL has enough siblings to be a slug (see `collapseSlugsAtPosition`).
 * @param page - A sibling page about to be compared
 * @returns The page's skeleton, or null when it has none
 */
export type ReadStructureSkeleton = (page: PatternPage) => string | null;

/**
 * Reads the skeleton a page already carries - what grouping a crawl's saved
 * pages uses.
 * @param page - A sibling page about to be compared
 * @returns The page's `structureSkeleton`
 */
function readStoredStructureSkeleton(page: PatternPage): string | null {
  return page.structureSkeleton;
}

/** One URL pattern that matched some of a crawl's pages. */
export interface DetectedPagePattern {
  /** The pattern as a path: `/websites/{website}/actions/{action}/edit`. */
  key: string;
  /** The pattern's path, one entry per segment. */
  segments: PathSegment[];
  /** How the pattern relates to its web object. */
  role: PagePatternRole;
  /** For a `view`, the static part after the object's variable (`edit`, `scripts/compare`); otherwise null. */
  viewName: string | null;
  /** How the pattern's variable was recognised. */
  detectedBy: PatternDetectionMethod;
  /** The pages it matched, in visiting order. */
  pageIds: string[];
}

/** A kind of thing the site has many of, with the patterns of its pages. */
export interface DetectedWebObject {
  /** The pattern of one instance's own page; the object's key. */
  instancePatternKey: string;
  /** Its name: the singular of the path segment before its variable (`Action`). */
  detectedName: string;
  /** The `instancePatternKey` of the object whose variable comes earlier in the path, or null. */
  parentInstancePatternKey: string | null;
  /** The distinct values its variable had, in visiting order (the instances the crawl saw). */
  instanceValues: string[];
  /** Links to its pages the crawl skipped because it already had enough of the same pattern. */
  skippedLinkCount: number;
  /** Its patterns: its instance page, then its views, its list page, and its create page, each in first-visit order. */
  patterns: DetectedPagePattern[];
}

/** A crawl's pages, grouped into web objects. */
export interface DetectedPageGrouping {
  /** The web objects, each parent before its children. */
  webObjects: DetectedWebObject[];
  /** The pages that belong to no web object, in visiting order. */
  standalonePageIds: string[];
}

/** A page with its path cut into segments, while patterns are being worked out. */
interface TokenizedPage {
  /** The page. */
  page: PatternPage;
  /** Its path's segments, exactly as they appear (empty for `/`). */
  rawSegments: string[];
  /** The same segments as tokens: variable once an id shape or a slug was recognised. */
  tokens: PathToken[];
  /** Its position in visiting order. */
  visitIndex: number;
}

/**
 * Cuts a page URL's path into its segments. Empty segments (from a trailing
 * or doubled `/`) are dropped, so `/websites/` and `/websites` give the same
 * segments.
 * @param url - An absolute URL
 * @returns The path's segments (empty for `/`), or null when the URL does not parse
 */
export function readPathSegments(url: string): string[] | null {
  try {
    return new URL(url).pathname.split("/").filter((segment) => segment !== "");
  } catch {
    return null;
  }
}

/**
 * Turns path segments into tokens, marking each segment that is shaped like
 * an id as variable (see `classifyPathSegment`). Slugs are not recognised
 * here - they need siblings (see `collapseSlugSegments`).
 * @param rawSegments - A path's segments
 * @returns One token per segment
 */
export function tokenizePathSegments(rawSegments: string[]): PathToken[] {
  return rawSegments.map((segment) => {
    const idShape = classifyPathSegment(segment);
    return idShape === null
      ? { kind: "static", value: segment }
      : { kind: "variable", valueShape: idShape };
  });
}

/**
 * Splits a path segment into lowercase words (`crawl-runs` → `crawl`,
 * `runs`). A percent-encoded segment is decoded first.
 * @param segmentValue - A static path segment
 * @returns Its words; empty when it has no letters or digits
 */
function splitSegmentIntoWords(segmentValue: string): string[] {
  let decodedValue = segmentValue;
  try {
    decodedValue = decodeURIComponent(segmentValue);
  } catch {
    // A malformed escape is read as it is.
  }
  return decodedValue
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== "");
}

/**
 * Makes a plural English word singular, by the common spelling rules:
 * `categories` → `category`, `boxes` → `box`, `actions` → `action`. Words
 * ending in `ss`, `us`, or `is` (`class`, `status`, `analysis`) are kept.
 * @param word - A lowercase word
 * @returns The word in the singular
 */
export function singularizeWord(word: string): string {
  const wordIsTooShortToBePlural = word.length <= 2;
  if (wordIsTooShortToBePlural) return word;
  if (word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (/(ss|x|z|ch|sh)es$/.test(word)) return word.slice(0, -2);
  if (/(ss|us|is)$/.test(word)) return word;
  if (word.endsWith("s")) return word.slice(0, -1);
  return word;
}

/**
 * Reads the singular words a static segment names, the last one made
 * singular (`crawl-runs` → `crawl`, `run`). Words that start with a digit
 * cannot name anything, so a segment like `2024` names nothing.
 * @param segmentValue - A static path segment
 * @returns The words, or an empty list when the segment names nothing
 */
function readSingularWords(segmentValue: string): string[] {
  const words = splitSegmentIntoWords(segmentValue);
  const segmentNamesNothing = words.length === 0 || /^\p{N}/u.test(words[0]);
  if (segmentNamesNothing) return [];
  return [...words.slice(0, -1), singularizeWord(words[words.length - 1])];
}

/**
 * Names a variable after the segment before it, in camelCase:
 * `websites` → `website`, `crawl-runs` → `crawlRun`.
 * @param segmentValue - The static segment before the variable
 * @returns The placeholder name, or `item` when the segment names nothing
 */
function placeholderFromSegment(segmentValue: string): string {
  const words = readSingularWords(segmentValue);
  if (words.length === 0) return FALLBACK_PLACEHOLDER;
  const [firstWord, ...laterWords] = words;
  const capitalizedLaterWords = laterWords.map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`);
  return [firstWord, ...capitalizedLaterWords].join("");
}

/**
 * Names a web object after the segment before its variable, in sentence
 * case: `websites` → `Website`, `crawl-runs` → `Crawl run`.
 * @param segmentValue - The static segment before the object's variable
 * @returns The name, or null when the segment names nothing
 */
function nameFromSegment(segmentValue: string): string | null {
  const words = readSingularWords(segmentValue);
  if (words.length === 0) return null;
  const name = words.join(" ");
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

/**
 * Finds the part every title shares - titles are often `Post A | Blog` and
 * `Post B | Blog` - splitting each at ` | `, ` - `, ` – `, ` — `, ` · `, and
 * ` : `.
 * @param titles - The pages' titles
 * @returns The first part all titles have, or null when there is none (or no titles)
 */
function findCommonTitlePart(titles: string[]): string | null {
  const titleParts = titles.map((title) =>
    title
      .split(/\s[|\-–—·:]\s/)
      .map((part) => part.trim())
      .filter((part) => part !== ""),
  );
  const firstTitleParts = titleParts.at(0);
  if (firstTitleParts === undefined) return null;
  const commonPart = firstTitleParts.find((part) =>
    titleParts.every((otherParts) => otherParts.includes(part)),
  );
  return commonPart ?? null;
}

/**
 * Writes tokens out as a pattern's path segments, naming each variable after
 * the segment before it (see `placeholderFromSegment`). A placeholder that
 * would repeat within the pattern gets a number: `{item}`, `{item2}`. Each
 * name only depends on the segments BEFORE it, so a prefix of a pattern
 * always gets the same names as the pattern itself.
 * @param tokens - The pattern's tokens
 * @returns The pattern's segments
 */
export function buildPathSegments(tokens: PathToken[]): PathSegment[] {
  const placeholderUseCounts = new Map<string, number>();
  return tokens.map((token, tokenIndex): PathSegment => {
    if (token.kind === "static") return token;
    const previousToken = tokenIndex > 0 ? tokens[tokenIndex - 1] : undefined;
    const basePlaceholder =
      previousToken?.kind === "static" ? placeholderFromSegment(previousToken.value) : FALLBACK_PLACEHOLDER;
    const earlierUseCount = placeholderUseCounts.get(basePlaceholder) ?? 0;
    placeholderUseCounts.set(basePlaceholder, earlierUseCount + 1);
    const placeholder = earlierUseCount === 0 ? basePlaceholder : `${basePlaceholder}${String(earlierUseCount + 1)}`;
    return { kind: "variable", placeholder, valueShape: token.valueShape };
  });
}

/**
 * Writes a pattern's segments as its key: the path with each variable as
 * `{placeholder}` - `/websites/{website}/actions/{action}`. No segments is `/`.
 * @param segments - The pattern's segments
 * @returns The key
 */
export function formatPatternKey(segments: PathSegment[]): string {
  const segmentTexts = segments.map((segment) =>
    segment.kind === "static" ? segment.value : `{${segment.placeholder}}`,
  );
  return `/${segmentTexts.join("/")}`;
}

/**
 * Writes tokens straight out as a pattern key (see `buildPathSegments` and
 * `formatPatternKey`).
 * @param tokens - The pattern's tokens
 * @returns The key
 */
export function formatTokensAsPatternKey(tokens: PathToken[]): string {
  return formatPatternKey(buildPathSegments(tokens));
}

/**
 * Reads a pattern key back into tokens: `{...}` segments are variable, the
 * rest static.
 * @param patternKey - A key from `formatPatternKey`
 * @returns The key's tokens (variables carry the `slug` shape: the key does not keep shapes)
 */
export function parsePatternKey(patternKey: string): PathToken[] {
  return patternKey
    .split("/")
    .filter((segment) => segment !== "")
    .map((segment) =>
      /^\{.+\}$/.test(segment)
        ? { kind: "variable", valueShape: "slug" }
        : { kind: "static", value: segment },
    );
}

/**
 * Checks whether a page's tokens fit a pattern: the same number of segments,
 * every static segment of the pattern equal, and a variable segment of the
 * pattern facing anything - a value or a variable. A variable of the page
 * only fits a variable of the pattern.
 * @param patternTokens - The pattern
 * @param pageTokens - The page's (or another pattern's) tokens
 * @returns True when the pattern covers them
 */
export function matchPagePattern(patternTokens: PathToken[], pageTokens: PathToken[]): boolean {
  const lengthsMatch = patternTokens.length === pageTokens.length;
  if (!lengthsMatch) return false;
  return patternTokens.every((patternToken, tokenIndex) => {
    const pageToken = pageTokens[tokenIndex];
    if (patternToken.kind === "variable") return true;
    return pageToken.kind === "static" && pageToken.value === patternToken.value;
  });
}

/**
 * Describes a token for grouping siblings: a static segment by its value,
 * every variable alike.
 * @param token - A path token
 * @returns The token's grouping text
 */
function describeTokenForGrouping(token: PathToken): string {
  return token.kind === "static" ? `=${token.value}` : "*";
}

/**
 * Groups pages that are siblings at one path position: the same number of
 * segments, a static segment at `position` right after another static
 * segment (a slug sits under a list's name, like `/blog/{post}` - while the
 * pages right after an id, like `/projects/{project}/settings` and
 * `.../members`, are different pages of one project), and every OTHER
 * segment the same (variables count as the same).
 * @param tokenizedPages - The pages
 * @param position - The segment position to compare them at (1 or more)
 * @returns The sibling groups, in first-visit order
 */
function groupSiblingsAtPosition(tokenizedPages: TokenizedPage[], position: number): TokenizedPage[][] {
  const siblingsByShape = new Map<string, TokenizedPage[]>();
  for (const tokenizedPage of tokenizedPages) {
    const tokenAtPosition = tokenizedPage.tokens.at(position);
    const tokenBeforePosition = tokenizedPage.tokens.at(position - 1);
    const pageHasAStaticSegmentThere = tokenAtPosition?.kind === "static";
    const segmentFollowsAStaticSegment = tokenBeforePosition?.kind === "static";
    const pageCanHaveASlugThere = pageHasAStaticSegmentThere && segmentFollowsAStaticSegment;
    if (!pageCanHaveASlugThere) continue;
    const shape = tokenizedPage.tokens
      .map((token, tokenIndex) => (tokenIndex === position ? "?" : describeTokenForGrouping(token)))
      .join("/");
    const shapeKey = `${String(tokenizedPage.tokens.length)}:${shape}`;
    const siblings = siblingsByShape.get(shapeKey) ?? [];
    siblings.push(tokenizedPage);
    siblingsByShape.set(shapeKey, siblings);
  }
  return [...siblingsByShape.values()];
}

/**
 * Splits sibling pages into clusters of pages built alike: each page joins
 * the first cluster whose first page's skeleton is at least
 * `STRUCTURE_SIMILARITY_THRESHOLD` similar to its own, or starts a new one.
 * This is the only place a skeleton is read, and the read goes through
 * `readStructureSkeleton`, so a crawl can build a page's skeleton only now
 * (see `crawlPatternSampling`). Pages with no (or an empty) skeleton cannot
 * be compared and are left out.
 * @param siblings - Sibling pages (see `groupSiblingsAtPosition`)
 * @param readStructureSkeleton - Reads (or builds) a sibling's skeleton
 * @returns The clusters, in first-visit order
 */
function clusterByStructure(
  siblings: TokenizedPage[],
  readStructureSkeleton: ReadStructureSkeleton,
): TokenizedPage[][] {
  const clusters: { representativeSkeleton: string; members: TokenizedPage[] }[] = [];
  for (const sibling of siblings) {
    const skeleton = readStructureSkeleton(sibling.page);
    const siblingHasAStructure = skeleton !== null && skeleton !== "";
    if (!siblingHasAStructure) continue;
    const matchingCluster = clusters.find(
      (cluster) =>
        compareStructureSkeletons(cluster.representativeSkeleton, skeleton) >= STRUCTURE_SIMILARITY_THRESHOLD,
    );
    if (matchingCluster === undefined) {
      clusters.push({ representativeSkeleton: skeleton, members: [sibling] });
    } else {
      matchingCluster.members.push(sibling);
    }
  }
  return clusters.map((cluster) => cluster.members);
}

/**
 * Counts the distinct values cluster members have at one position.
 * @param cluster - Sibling pages built alike
 * @param position - The segment position
 * @returns How many different segments they have there
 */
function countDistinctValuesAtPosition(cluster: TokenizedPage[], position: number): number {
  const values = new Set(cluster.map((member) => member.rawSegments[position]));
  return values.size;
}

/**
 * Recognises SLUGS (signal 2): marks a static segment variable (`slug`) on
 * pages that are siblings at that position (see `groupSiblingsAtPosition`),
 * built alike (see `clusterByStructure`), and have at least
 * `MIN_SLUG_SIBLING_COUNT` different values there - `/blog/a`, `/blog/b`,
 * `/blog/c` become `/blog/{blog}`. The first segment never collapses (so
 * `/about`, `/pricing`, `/contact` stay apart), and neither does a segment
 * right after a variable. Repeats until nothing more collapses, because
 * collapsing one position can make pages siblings at another
 * (`/docs/guides/a`, `/docs/reference/b`, ...).
 * @param tokenizedPages - The pages; their `tokens` are changed in place
 * @param readStructureSkeleton - Reads (or builds) a sibling's skeleton
 */
function collapseSlugSegments(tokenizedPages: TokenizedPage[], readStructureSkeleton: ReadStructureSkeleton): void {
  const longestPathLength = Math.max(0, ...tokenizedPages.map((tokenizedPage) => tokenizedPage.tokens.length));
  let somethingCollapsed = true;
  while (somethingCollapsed) {
    somethingCollapsed = false;
    for (let position = 1; position < longestPathLength; position += 1) {
      const slugsCollapsedHere = collapseSlugsAtPosition(tokenizedPages, position, readStructureSkeleton);
      somethingCollapsed ||= slugsCollapsedHere;
    }
  }
}

/**
 * One pass of `collapseSlugSegments` at one path position: every cluster of
 * sibling pages built alike with at least `MIN_SLUG_SIBLING_COUNT` values
 * there gets a `slug` variable there.
 *
 * The URLs decide first: a sibling group with fewer than
 * `MIN_SLUG_SIBLING_COUNT` values there is passed over before any skeleton
 * is read - a cluster is part of its group, so it could never have enough.
 * Only the pages of a group whose URLs could be a slug are compared by
 * structure, to confirm it.
 * @param tokenizedPages - The pages; their `tokens` are changed in place
 * @param position - The segment position (1 or more)
 * @param readStructureSkeleton - Reads (or builds) a sibling's skeleton
 * @returns True when any page's segment became a slug
 */
function collapseSlugsAtPosition(
  tokenizedPages: TokenizedPage[],
  position: number,
  readStructureSkeleton: ReadStructureSkeleton,
): boolean {
  let somethingCollapsed = false;
  for (const siblings of groupSiblingsAtPosition(tokenizedPages, position)) {
    const urlsCouldBeASlug = countDistinctValuesAtPosition(siblings, position) >= MIN_SLUG_SIBLING_COUNT;
    if (!urlsCouldBeASlug) continue;
    for (const cluster of clusterByStructure(siblings, readStructureSkeleton)) {
      const clusterHasEnoughSiblings = countDistinctValuesAtPosition(cluster, position) >= MIN_SLUG_SIBLING_COUNT;
      if (!clusterHasEnoughSiblings) continue;
      for (const member of cluster) {
        member.tokens[position] = { kind: "variable", valueShape: "slug" };
      }
      somethingCollapsed = true;
    }
  }
  return somethingCollapsed;
}

/**
 * Cuts each page's path into tokens: id-shaped segments first, then slugs
 * recognised from siblings. Pages whose URL does not parse are left out.
 * @param pages - The pages, in visiting order
 * @param readStructureSkeleton - Reads (or builds) a sibling's skeleton
 * @returns The tokenized pages, in visiting order
 */
function tokenizePages(pages: PatternPage[], readStructureSkeleton: ReadStructureSkeleton): TokenizedPage[] {
  const tokenizedPages: TokenizedPage[] = [];
  pages.forEach((page, visitIndex) => {
    const rawSegments = readPathSegments(page.url);
    if (rawSegments === null) return;
    tokenizedPages.push({ page, rawSegments, tokens: tokenizePathSegments(rawSegments), visitIndex });
  });
  collapseSlugSegments(tokenizedPages, readStructureSkeleton);
  return tokenizedPages;
}

/**
 * Finds the slug patterns a set of visited pages confirms (see
 * `collapseSlugSegments`) - what a crawl uses, mid-crawl, to stop visiting
 * more pages of a slug pattern it already has enough of.
 * @param pages - The pages visited so far
 * @param readStructureSkeleton - Reads (or builds) a sibling's skeleton; by default the one the page carries
 * @returns Each pattern with at least one slug segment, once, in first-visit order
 */
export function findConfirmedSlugPatterns(
  pages: PatternPage[],
  readStructureSkeleton: ReadStructureSkeleton = readStoredStructureSkeleton,
): PathToken[][] {
  const slugPatternsByKey = new Map<string, PathToken[]>();
  for (const tokenizedPage of tokenizePages(pages, readStructureSkeleton)) {
    const pageHasASlug = tokenizedPage.tokens.some(
      (token) => token.kind === "variable" && token.valueShape === "slug",
    );
    if (!pageHasASlug) continue;
    const patternKey = formatTokensAsPatternKey(tokenizedPage.tokens);
    if (!slugPatternsByKey.has(patternKey)) {
      slugPatternsByKey.set(patternKey, tokenizedPage.tokens);
    }
  }
  return [...slugPatternsByKey.values()];
}

/**
 * Works out the pattern a link belongs to before it is visited: its
 * id-shaped segments are variables, and so is any segment one of the
 * confirmed slug patterns makes a slug.
 * @param identityUrl - The link's identity (origin + path)
 * @param confirmedSlugPatterns - The slug patterns the crawl has confirmed so far (see `findConfirmedSlugPatterns`)
 * @returns The pattern key, or null when the path has no variable segment (or does not parse)
 */
export function patternKeyForPath(identityUrl: string, confirmedSlugPatterns: PathToken[][]): string | null {
  const rawSegments = readPathSegments(identityUrl);
  if (rawSegments === null) return null;
  const idTokens = tokenizePathSegments(rawSegments);
  const matchingSlugPattern = confirmedSlugPatterns.find((slugPattern) => matchPagePattern(slugPattern, idTokens));
  const tokens = matchingSlugPattern ?? idTokens;
  const pathHasAVariable = tokens.some((token) => token.kind === "variable");
  if (!pathHasAVariable) return null;
  return formatTokensAsPatternKey(tokens);
}

/** A web object while the grouping is being built. */
interface ObjectDraft {
  /** The tokens of one instance's page: the path up to and including the object's variable. */
  anchorTokens: PathToken[];
  /** The object's key. */
  instancePatternKey: string;
  /** The parent object's key, or null. */
  parentInstancePatternKey: string | null;
  /** When the object was first seen, by visiting order. */
  firstVisitIndex: number;
  /** Its patterns by key, in first-visit order. */
  patternsByKey: Map<string, DetectedPagePattern>;
  /** Its own pages (instance and views), to read its instance values from. */
  ownPages: TokenizedPage[];
  /** Every page under it (its own and its descendants'), the fallback for instance values. */
  pagesUnderIt: TokenizedPage[];
  /** Links to its pages the crawl skipped. */
  skippedLinkCount: number;
}

/**
 * Lists the positions of a page's variable segments.
 * @param tokens - The page's tokens
 * @returns The positions, in path order
 */
function listVariablePositions(tokens: PathToken[]): number[] {
  return tokens.flatMap((token, tokenIndex) => (token.kind === "variable" ? [tokenIndex] : []));
}

/**
 * Collects every web object the pages reveal - one per variable segment of
 * every page: `/websites/{website}/actions/{action}/edit` reveals Website and
 * Action, even when no Action page of its own was crawled.
 * @param tokenizedPages - The pages, in visiting order
 * @returns The objects by key, in first-visit order
 */
function collectObjectDrafts(tokenizedPages: TokenizedPage[]): Map<string, ObjectDraft> {
  const draftsByKey = new Map<string, ObjectDraft>();
  for (const tokenizedPage of tokenizedPages) {
    let parentInstancePatternKey: string | null = null;
    for (const variablePosition of listVariablePositions(tokenizedPage.tokens)) {
      const anchorTokens = tokenizedPage.tokens.slice(0, variablePosition + 1);
      const instancePatternKey = formatTokensAsPatternKey(anchorTokens);
      const existingDraft = draftsByKey.get(instancePatternKey);
      const draft: ObjectDraft = existingDraft ?? {
        anchorTokens,
        instancePatternKey,
        parentInstancePatternKey,
        firstVisitIndex: tokenizedPage.visitIndex,
        patternsByKey: new Map(),
        ownPages: [],
        pagesUnderIt: [],
        skippedLinkCount: 0,
      };
      draft.pagesUnderIt.push(tokenizedPage);
      draftsByKey.set(instancePatternKey, draft);
      parentInstancePatternKey = instancePatternKey;
    }
  }
  return draftsByKey;
}

/** Where one page belongs: which object, and as which of its patterns. */
interface PagePlacement {
  /** The object's key. */
  instancePatternKey: string;
  /** How the page relates to the object. */
  role: PagePatternRole;
  /** For a view, the static part after the object's variable; otherwise null. */
  viewName: string | null;
}

/**
 * Indexes the objects' list and create pages by pattern key: an object whose
 * variable follows a static segment (`.../actions/{action}`) has its list at
 * the path before the variable (`.../actions`), and its create page one
 * `new`, `create`, or `add` below that (`.../actions/new`).
 * @param draftsByKey - The objects
 * @returns The object keys by their list page's key, and by their create pages' keys
 */
function indexCollectionAndCreateKeys(draftsByKey: Map<string, ObjectDraft>): {
  objectKeyByCollectionKey: Map<string, string>;
  objectKeyByCreateKey: Map<string, string>;
} {
  const objectKeyByCollectionKey = new Map<string, string>();
  const objectKeyByCreateKey = new Map<string, string>();
  for (const draft of draftsByKey.values()) {
    const collectionTokens = draft.anchorTokens.slice(0, -1);
    const variableFollowsAStaticSegment = collectionTokens.at(-1)?.kind === "static";
    if (!variableFollowsAStaticSegment) continue;
    const collectionKey = formatTokensAsPatternKey(collectionTokens);
    if (!objectKeyByCollectionKey.has(collectionKey)) {
      objectKeyByCollectionKey.set(collectionKey, draft.instancePatternKey);
    }
    for (const createSegment of CREATE_PAGE_SEGMENTS) {
      const createKey = formatTokensAsPatternKey([...collectionTokens, { kind: "static", value: createSegment }]);
      if (!objectKeyByCreateKey.has(createKey)) {
        objectKeyByCreateKey.set(createKey, draft.instancePatternKey);
      }
    }
  }
  return { objectKeyByCollectionKey, objectKeyByCreateKey };
}

/**
 * Decides where a page belongs:
 * 1. its path is an object's list page → that object's `collection`;
 * 2. its path is an object's create page → that object's `create`;
 * 3. it ends in a variable → the `instance` of that variable's object;
 * 4. static segments follow its last variable → a `view` of that object;
 * 5. otherwise it is a standalone page.
 * @param tokenizedPage - The page
 * @param indexes - The objects' list and create page keys (see `indexCollectionAndCreateKeys`)
 * @param indexes.objectKeyByCollectionKey - Object keys by their list page's key
 * @param indexes.objectKeyByCreateKey - Object keys by their create pages' keys
 * @returns Where the page belongs, or null for a standalone page
 */
function placePage(
  tokenizedPage: TokenizedPage,
  indexes: { objectKeyByCollectionKey: Map<string, string>; objectKeyByCreateKey: Map<string, string> },
): PagePlacement | null {
  const pageKey = formatTokensAsPatternKey(tokenizedPage.tokens);
  const collectionObjectKey = indexes.objectKeyByCollectionKey.get(pageKey);
  if (collectionObjectKey !== undefined) {
    return { instancePatternKey: collectionObjectKey, role: "collection", viewName: null };
  }
  const createObjectKey = indexes.objectKeyByCreateKey.get(pageKey);
  if (createObjectKey !== undefined) {
    return { instancePatternKey: createObjectKey, role: "create", viewName: null };
  }

  const lastVariablePosition = listVariablePositions(tokenizedPage.tokens).at(-1);
  const pageHasNoVariable = lastVariablePosition === undefined;
  if (pageHasNoVariable) return null;
  const instancePatternKey = formatTokensAsPatternKey(tokenizedPage.tokens.slice(0, lastVariablePosition + 1));
  const pageEndsInTheVariable = lastVariablePosition === tokenizedPage.tokens.length - 1;
  if (pageEndsInTheVariable) {
    return { instancePatternKey, role: "instance", viewName: null };
  }
  const viewName = tokenizedPage.rawSegments.slice(lastVariablePosition + 1).join("/");
  return { instancePatternKey, role: "view", viewName };
}

/**
 * Says how a pattern's variable was recognised: as a slug when its object's
 * own variable, or any variable in the pattern, is a slug.
 * @param tokens - The pattern's tokens
 * @param anchorTokens - The object's instance tokens
 * @returns `siblingStructure` for a slug, otherwise `idShape`
 */
function decideDetectionMethod(tokens: PathToken[], anchorTokens: PathToken[]): PatternDetectionMethod {
  const tokensIncludeASlug = [...tokens, ...anchorTokens].some(
    (token) => token.kind === "variable" && token.valueShape === "slug",
  );
  return tokensIncludeASlug ? "siblingStructure" : "idShape";
}

/**
 * Adds a page to its object's pattern, creating the pattern the first time.
 * @param draft - The page's object
 * @param tokenizedPage - The page
 * @param placement - Where the page belongs (see `placePage`)
 */
function addPageToPattern(draft: ObjectDraft, tokenizedPage: TokenizedPage, placement: PagePlacement): void {
  const segments = buildPathSegments(tokenizedPage.tokens);
  const patternKey = formatPatternKey(segments);
  const existingPattern = draft.patternsByKey.get(patternKey);
  if (existingPattern !== undefined) {
    existingPattern.pageIds.push(tokenizedPage.page.id);
    return;
  }
  draft.patternsByKey.set(patternKey, {
    key: patternKey,
    segments,
    role: placement.role,
    viewName: placement.viewName,
    detectedBy: decideDetectionMethod(tokenizedPage.tokens, draft.anchorTokens),
    pageIds: [tokenizedPage.page.id],
  });
}

/**
 * Adds the links the crawl skipped (by the pattern key it skipped them
 * under) to the objects they belong to: the first object with a pattern -
 * its instance pattern, or one its pages matched - that covers the key (see
 * `matchPagePattern`). A key no object covers is not counted on any object.
 * @param draftsByKey - The objects
 * @param skippedLinkCountsByPatternKey - How many links the crawl skipped, per pattern key
 */
function countSkippedLinks(
  draftsByKey: Map<string, ObjectDraft>,
  skippedLinkCountsByPatternKey: Record<string, number>,
): void {
  const candidatePatterns = [...draftsByKey.values()].flatMap((draft) => [
    { draft, tokens: draft.anchorTokens },
    ...[...draft.patternsByKey.keys()].map((patternKey) => ({ draft, tokens: parsePatternKey(patternKey) })),
  ]);
  for (const [skippedPatternKey, skippedLinkCount] of Object.entries(skippedLinkCountsByPatternKey)) {
    const skippedTokens = parsePatternKey(skippedPatternKey);
    const coveringPattern = candidatePatterns.find((candidate) => matchPagePattern(candidate.tokens, skippedTokens));
    if (coveringPattern !== undefined) {
      coveringPattern.draft.skippedLinkCount += skippedLinkCount;
    }
  }
}

/**
 * Lists the distinct values an object's variable had: on its own pages
 * (instance and views) when it has any, otherwise on every page under it.
 * @param draft - The object
 * @returns The values, in visiting order
 */
function listInstanceValues(draft: ObjectDraft): string[] {
  const variablePosition = draft.anchorTokens.length - 1;
  const pagesToRead = draft.ownPages.length > 0 ? draft.ownPages : draft.pagesUnderIt;
  return [...new Set(pagesToRead.map((tokenizedPage) => tokenizedPage.rawSegments[variablePosition]))];
}

/**
 * Names an object: after the static segment before its variable
 * (`/websites/{website}` → `Website`); when that names nothing, after the
 * part its instance pages' titles share; otherwise `Page`.
 * @param draft - The object
 * @returns The object's detected name
 */
function nameObject(draft: ObjectDraft): string {
  const segmentBeforeTheVariable = draft.anchorTokens.at(-2);
  const nameFromPath =
    segmentBeforeTheVariable?.kind === "static" ? nameFromSegment(segmentBeforeTheVariable.value) : null;
  if (nameFromPath !== null) return nameFromPath;
  const titles = draft.ownPages.flatMap((tokenizedPage) =>
    tokenizedPage.page.title === null ? [] : [tokenizedPage.page.title],
  );
  return findCommonTitlePart(titles) ?? FALLBACK_OBJECT_NAME;
}

/** The order an object's patterns are listed in, by role. */
const PATTERN_ROLE_ORDER: Record<PagePatternRole, number> = { instance: 0, view: 1, collection: 2, create: 3 };

/**
 * Orders objects so each parent comes before its children: the top-level
 * objects in first-visit order, each followed by its children (and theirs)
 * in first-visit order.
 * @param draftsByKey - The objects, in first-visit order
 * @returns The objects, parents first
 */
function orderParentsBeforeChildren(draftsByKey: Map<string, ObjectDraft>): ObjectDraft[] {
  const childrenByParentKey = new Map<string | null, ObjectDraft[]>();
  for (const draft of draftsByKey.values()) {
    const parentIsKnown =
      draft.parentInstancePatternKey !== null && draftsByKey.has(draft.parentInstancePatternKey);
    const groupKey = parentIsKnown ? draft.parentInstancePatternKey : null;
    const siblings = childrenByParentKey.get(groupKey) ?? [];
    siblings.push(draft);
    childrenByParentKey.set(groupKey, siblings);
  }
  const orderedDrafts: ObjectDraft[] = [];
  /**
   * Appends objects, each followed by its descendants.
   * @param drafts - Sibling objects
   */
  const appendWithDescendants = (drafts: ObjectDraft[]): void => {
    const draftsInVisitOrder = [...drafts].sort((first, second) => first.firstVisitIndex - second.firstVisitIndex);
    for (const draft of draftsInVisitOrder) {
      orderedDrafts.push(draft);
      appendWithDescendants(childrenByParentKey.get(draft.instancePatternKey) ?? []);
    }
  };
  appendWithDescendants(childrenByParentKey.get(null) ?? []);
  return orderedDrafts;
}

/**
 * Groups a crawl's pages into WEB OBJECTS by their URL patterns - every
 * object a kind of thing the site has many of (Website, Action), with the
 * patterns of its pages - using only these pages (a crawl never learns from
 * an earlier one).
 *
 * 1. Each path is cut into segments; a segment shaped like an id (see
 *    `classifyPathSegment`) is variable.
 * 2. Slugs are recognised from siblings built alike (see
 *    `collapseSlugSegments`).
 * 3. Every variable segment reveals an object, keyed by its instance
 *    pattern (`/websites/{website}/actions/{action}`), named after the
 *    segment before it (`Action`), under the object of the variable before
 *    it (Website).
 * 4. Each page joins one object's pattern as its `instance`, a `view`
 *    (`.../{action}/edit`), its `collection` (`.../actions`), or its
 *    `create` page (`.../actions/new`) - see `placePage` - or is standalone.
 *
 * Pure: the same pages give the same grouping.
 * @param pages - The crawl's pages, in visiting order
 * @param skippedLinkCountsByPatternKey - How many links the crawl skipped, per pattern key (its `skippedSimilarUrlCountsByPattern`)
 * @returns The web objects (parents before children) and the standalone pages
 */
export function detectPagePatterns(
  pages: PatternPage[],
  skippedLinkCountsByPatternKey: Record<string, number> = {},
): DetectedPageGrouping {
  const tokenizedPages = tokenizePages(pages, readStoredStructureSkeleton);
  const draftsByKey = collectObjectDrafts(tokenizedPages);
  const collectionAndCreateKeys = indexCollectionAndCreateKeys(draftsByKey);
  const placedPageIds = new Set<string>();
  for (const tokenizedPage of tokenizedPages) {
    const placement = placePage(tokenizedPage, collectionAndCreateKeys);
    const draft = placement === null ? undefined : draftsByKey.get(placement.instancePatternKey);
    if (placement === null || draft === undefined) continue;
    addPageToPattern(draft, tokenizedPage, placement);
    const pageIsTheObjectsOwn = placement.role === "instance" || placement.role === "view";
    if (pageIsTheObjectsOwn) {
      draft.ownPages.push(tokenizedPage);
    }
    placedPageIds.add(tokenizedPage.page.id);
  }
  countSkippedLinks(draftsByKey, skippedLinkCountsByPatternKey);

  const webObjects = orderParentsBeforeChildren(draftsByKey).map(
    (draft): DetectedWebObject => ({
      instancePatternKey: draft.instancePatternKey,
      detectedName: nameObject(draft),
      parentInstancePatternKey: draft.parentInstancePatternKey,
      instanceValues: listInstanceValues(draft),
      skippedLinkCount: draft.skippedLinkCount,
      patterns: [...draft.patternsByKey.values()].sort(
        (first, second) => PATTERN_ROLE_ORDER[first.role] - PATTERN_ROLE_ORDER[second.role],
      ),
    }),
  );
  const standalonePageIds = pages.filter((page) => !placedPageIds.has(page.id)).map((page) => page.id);
  return { webObjects, standalonePageIds };
}
