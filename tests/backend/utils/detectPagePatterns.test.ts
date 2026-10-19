import { describe, it, expect, vi } from "vitest";
import {
  buildPathSegments,
  detectPagePatterns,
  findConfirmedSlugPatterns,
  formatPatternKey,
  matchPagePattern,
  parsePatternKey,
  patternKeyForPath,
  readPathSegments,
  singularizeWord,
  tokenizePathSegments,
  type DetectedWebObject,
  type PatternPage,
  type ReadStructureSkeleton,
} from "../../../server/utils/detectPagePatterns.js";

const ORIGIN = "http://localhost:5180";
const WEBSITE_IDS = ["cmurhdofb000c93uhb9b32qka", "cmurhdquz000e93uhqn7ew0v7", "cmurdtjk000007yuhdtuqkwsp"];
const ACTION_IDS = ["cmv5roxo70000i23yrnm4xwqe", "cmurdv06i00087yuh3yvj5uk1"];
const USE_CASE_ID = "cmuseaaaa0000aaaaaaaaaaa1";
const CRAWL_RUN_ID = "cmuscrawl0000aaaaaaaaaaa1";
const CREDENTIAL_ID = "cmuscred00000aaaaaaaaaaa1";

/** A page skeleton shared by the pages of one template. */
const POST_SKELETON = "banner\n  link\nmain\n  heading[level=1]\n  paragraph";

/**
 * Builds pages from paths, in visiting order, ids `page-0`, `page-1`, ...
 * @param paths - The pages' paths
 * @param skeletonForPath - The structure skeleton of each path; `main` by default
 * @returns The pages
 */
function buildPages(paths: string[], skeletonForPath: (path: string) => string | null = () => "main"): PatternPage[] {
  return paths.map((path, pathIndex) => ({
    id: `page-${String(pathIndex)}`,
    url: `${ORIGIN}${path}`,
    title: null,
    structureSkeleton: skeletonForPath(path),
  }));
}

/**
 * Summarises a grouping as readable lines: each object with its parent,
 * instance count, and skipped links, then each pattern with its role and
 * pages.
 * @param webObjects - The detected objects
 * @returns One line per object and per pattern
 */
function describeObjects(webObjects: DetectedWebObject[]): string[] {
  return webObjects.flatMap((webObject) => [
    `${webObject.detectedName} ${webObject.instancePatternKey} parent=${String(webObject.parentInstancePatternKey)} instances=${String(webObject.instanceValues.length)} skipped=${String(webObject.skippedLinkCount)}`,
    ...webObject.patterns.map(
      (pattern) =>
        `  ${pattern.role} ${pattern.key}${pattern.viewName === null ? "" : ` (${pattern.viewName})`} [${pattern.detectedBy}] ${pattern.pageIds.join(",")}`,
    ),
  ]);
}

describe("detectPagePatterns", () => {
  it("groups this app's own routes into Website, Action, Use case, Crawl run, and Credential, each under its parent", () => {
    const pages = buildPages([
      "/",
      "/websites/new",
      ...WEBSITE_IDS.map((websiteId) => `/websites/${websiteId}`),
      `/websites/${WEBSITE_IDS[0]}/edit`,
      `/websites/${WEBSITE_IDS[0]}/actions/new`,
      ...ACTION_IDS.map((actionId) => `/websites/${WEBSITE_IDS[0]}/actions/${actionId}`),
      `/websites/${WEBSITE_IDS[0]}/actions/${ACTION_IDS[0]}/edit`,
      `/websites/${WEBSITE_IDS[0]}/actions/${ACTION_IDS[0]}/scripts/compare`,
      `/websites/${WEBSITE_IDS[0]}/use-cases/${USE_CASE_ID}`,
      `/websites/${WEBSITE_IDS[0]}/crawl-runs/${CRAWL_RUN_ID}`,
      `/websites/${WEBSITE_IDS[0]}/credentials/${CREDENTIAL_ID}/edit`,
      `/websites/${WEBSITE_IDS[0]}/credentials/new`,
    ]);

    const grouping = detectPagePatterns(pages, { "/websites/{website}/actions/{action}": 2 });

    expect(describeObjects(grouping.webObjects)).toEqual([
      "Website /websites/{website} parent=null instances=3 skipped=0",
      "  instance /websites/{website} [idShape] page-2,page-3,page-4",
      "  view /websites/{website}/edit (edit) [idShape] page-5",
      "  create /websites/new [idShape] page-1",
      "Action /websites/{website}/actions/{action} parent=/websites/{website} instances=2 skipped=2",
      "  instance /websites/{website}/actions/{action} [idShape] page-7,page-8",
      "  view /websites/{website}/actions/{action}/edit (edit) [idShape] page-9",
      "  view /websites/{website}/actions/{action}/scripts/compare (scripts/compare) [idShape] page-10",
      "  create /websites/{website}/actions/new [idShape] page-6",
      "Use case /websites/{website}/use-cases/{useCase} parent=/websites/{website} instances=1 skipped=0",
      "  instance /websites/{website}/use-cases/{useCase} [idShape] page-11",
      "Crawl run /websites/{website}/crawl-runs/{crawlRun} parent=/websites/{website} instances=1 skipped=0",
      "  instance /websites/{website}/crawl-runs/{crawlRun} [idShape] page-12",
      "Credential /websites/{website}/credentials/{credential} parent=/websites/{website} instances=1 skipped=0",
      "  view /websites/{website}/credentials/{credential}/edit (edit) [idShape] page-13",
      "  create /websites/{website}/credentials/new [idShape] page-14",
    ]);
    expect(grouping.standalonePageIds).toEqual(["page-0"]);
    expect(grouping.webObjects[0].instanceValues).toEqual(WEBSITE_IDS);
  });

  it("keeps each pattern's segments, with placeholders named after the segment before them", () => {
    const grouping = detectPagePatterns(buildPages([`/websites/${WEBSITE_IDS[0]}/actions/${ACTION_IDS[0]}`]));

    const actionPattern = grouping.webObjects[1].patterns[0];
    expect(actionPattern.segments).toEqual([
      { kind: "static", value: "websites" },
      { kind: "variable", placeholder: "website", valueShape: "cuid" },
      { kind: "static", value: "actions" },
      { kind: "variable", placeholder: "action", valueShape: "cuid" },
    ]);
  });

  it("puts an object's list page in its collection pattern", () => {
    const grouping = detectPagePatterns(buildPages(["/products", "/products/12", "/products/13"]));

    expect(describeObjects(grouping.webObjects)).toEqual([
      "Product /products/{product} parent=null instances=2 skipped=0",
      "  instance /products/{product} [idShape] page-1,page-2",
      "  collection /products [idShape] page-0",
    ]);
    expect(grouping.standalonePageIds).toEqual([]);
  });

  it("recognises slugs from 3 or more sibling pages built alike", () => {
    const pages = buildPages(["/blog", "/blog/first-post", "/blog/second-post", "/blog/third-post"], () => POST_SKELETON);

    const grouping = detectPagePatterns(pages);

    expect(describeObjects(grouping.webObjects)).toEqual([
      "Blog /blog/{blog} parent=null instances=3 skipped=0",
      "  instance /blog/{blog} [siblingStructure] page-1,page-2,page-3",
      "  collection /blog [siblingStructure] page-0",
    ]);
    expect(grouping.webObjects[0].patterns[0].segments[1]).toEqual({
      kind: "variable",
      placeholder: "blog",
      valueShape: "slug",
    });
  });

  it("does not make a slug of only 2 siblings", () => {
    const grouping = detectPagePatterns(buildPages(["/blog/first-post", "/blog/second-post"], () => POST_SKELETON));

    expect(grouping.webObjects).toEqual([]);
    expect(grouping.standalonePageIds).toEqual(["page-0", "page-1"]);
  });

  it("keeps siblings built differently apart, like a settings area's pages", () => {
    const skeletonsByPath: Record<string, string> = {
      "/settings/profile": "main\n  textbox\n  button",
      "/settings/billing": "main\n  table\n    row\n      cell",
      "/settings/team": "main\n  list\n    listitem",
    };

    const grouping = detectPagePatterns(
      buildPages(Object.keys(skeletonsByPath), (path) => skeletonsByPath[path]),
    );

    expect(grouping.webObjects).toEqual([]);
    expect(grouping.standalonePageIds).toHaveLength(3);
  });

  it("only makes slugs of the siblings that are built alike, leaving the odd one out static", () => {
    const pages = buildPages(["/docs/a", "/docs/b", "/docs/c", "/docs/search"], (path) =>
      path === "/docs/search" ? "main\n  searchbox\n  table" : POST_SKELETON,
    );

    const grouping = detectPagePatterns(pages);

    expect(grouping.webObjects.map((webObject) => webObject.instancePatternKey)).toEqual(["/docs/{doc}"]);
    expect(grouping.webObjects[0].patterns[0].pageIds).toEqual(["page-0", "page-1", "page-2"]);
    expect(grouping.standalonePageIds).toEqual(["page-3"]);
  });

  it("never makes a slug of the first path segment, so /about, /pricing, and /contact stay apart", () => {
    const grouping = detectPagePatterns(buildPages(["/about", "/pricing", "/contact"]));

    expect(grouping.webObjects).toEqual([]);
  });

  it("never makes a slug of a segment right after an id, so one project's pages stay apart", () => {
    const projectId = "cmprojec0000aaaaaaaaaaaa1";
    const grouping = detectPagePatterns(
      buildPages([`/projects/${projectId}/settings`, `/projects/${projectId}/members`, `/projects/${projectId}/billing`]),
    );

    expect(describeObjects(grouping.webObjects)).toEqual([
      "Project /projects/{project} parent=null instances=1 skipped=0",
      "  view /projects/{project}/settings (settings) [idShape] page-0",
      "  view /projects/{project}/members (members) [idShape] page-1",
      "  view /projects/{project}/billing (billing) [idShape] page-2",
    ]);
  });

  it("cannot compare pages without a skeleton, so they never make a slug", () => {
    const grouping = detectPagePatterns(buildPages(["/blog/a", "/blog/b", "/blog/c"], () => null));

    expect(grouping.webObjects).toEqual([]);
  });

  it("repeats until nothing more collapses, so a slug can reveal siblings one level down", () => {
    const pages = buildPages(
      ["/docs/guides/a", "/docs/guides/b", "/docs/guides/c", "/docs/reference/x", "/docs/reference/y", "/docs/reference/z", "/docs/tutorials/q", "/docs/tutorials/r", "/docs/tutorials/s"],
      () => POST_SKELETON,
    );

    const grouping = detectPagePatterns(pages);

    // First /docs/guides/{guide}, /docs/reference/{reference}, ...; then those
    // three are siblings at the second segment, which collapses too.
    expect(grouping.webObjects.map((webObject) => webObject.instancePatternKey)).toEqual([
      "/docs/{doc}",
      "/docs/{doc}/{item}",
    ]);
    expect(grouping.webObjects[0].instanceValues).toEqual(["guides", "reference", "tutorials"]);
    expect(grouping.webObjects[1].patterns[0].pageIds).toHaveLength(9);
    expect(grouping.standalonePageIds).toEqual([]);
  });

  it("numbers a placeholder that would repeat, and names a variable with no word before it `item`", () => {
    const grouping = detectPagePatterns(buildPages(["/2024/05/17", "/2025/06/18"]));

    expect(grouping.webObjects.map((webObject) => webObject.instancePatternKey)).toEqual([
      "/{item}",
      "/{item}/{item2}",
      "/{item}/{item2}/{item3}",
    ]);
  });

  it("names an object with no word before it after the part its pages' titles share, otherwise `Page`", () => {
    const pages: PatternPage[] = [
      { id: "a", url: `${ORIGIN}/1001`, title: "Shoe A | Acme Store", structureSkeleton: "main" },
      { id: "b", url: `${ORIGIN}/1002`, title: "Shoe B | Acme Store", structureSkeleton: "main" },
    ];

    expect(detectPagePatterns(pages).webObjects[0].detectedName).toBe("Acme Store");
    const untitledPages = pages.map((page) => ({ ...page, title: null }));
    expect(detectPagePatterns(untitledPages).webObjects[0].detectedName).toBe("Page");
    const unrelatedTitles = [
      { ...pages[0], title: "Shoe A" },
      { ...pages[1], title: "Shoe B" },
    ];
    expect(detectPagePatterns(unrelatedTitles).webObjects[0].detectedName).toBe("Page");
  });

  it("names objects in sentence case after a plural, dashed, or encoded segment", () => {
    const grouping = detectPagePatterns(
      buildPages([
        "/categories/7",
        "/boxes/7",
        "/status/7",
        "/crawl-runs/7",
        "/user%20profiles/7",
        "/2024-q1/7",
        "/-/7",
      ]),
    );

    expect(grouping.webObjects.map((webObject) => webObject.detectedName)).toEqual([
      "Category",
      "Box",
      "Status",
      "Crawl run",
      "User profile",
      "Page",
      "Page",
    ]);
    expect(grouping.webObjects.map((webObject) => webObject.instancePatternKey)).toEqual([
      "/categories/{category}",
      "/boxes/{box}",
      "/status/{status}",
      "/crawl-runs/{crawlRun}",
      "/user%20profiles/{userProfile}",
      "/2024-q1/{item}",
      "/-/{item}",
    ]);
  });

  it("reads a segment with a malformed escape as it is", () => {
    const grouping = detectPagePatterns(buildPages(["/caf%E9s/7"]));

    expect(grouping.webObjects[0].instancePatternKey).toBe("/caf%E9s/{cafE9}");
  });

  it("reads an object's instances from the pages under it when it has no page of its own", () => {
    const grouping = detectPagePatterns(
      buildPages([`/websites/${WEBSITE_IDS[0]}/actions/${ACTION_IDS[0]}`, `/websites/${WEBSITE_IDS[1]}/actions/${ACTION_IDS[1]}`]),
    );

    expect(grouping.webObjects[0].detectedName).toBe("Website");
    expect(grouping.webObjects[0].patterns).toEqual([]);
    expect(grouping.webObjects[0].instanceValues).toEqual([WEBSITE_IDS[0], WEBSITE_IDS[1]]);
  });

  it("adds skipped links to the object whose pattern covers them, and drops counts no object covers", () => {
    const grouping = detectPagePatterns(buildPages([`/websites/${WEBSITE_IDS[0]}`, `/websites/${WEBSITE_IDS[0]}/edit`]), {
      "/websites/{website}": 3,
      "/websites/{website}/edit": 2,
      "/elsewhere/{item}": 9,
    });

    expect(grouping.webObjects[0].skippedLinkCount).toBe(5);
  });

  it("orders top-level objects by first visit, each followed by its children", () => {
    const grouping = detectPagePatterns(
      buildPages([`/teams/12/members/34`, `/products/99`, `/teams/12`]),
    );

    expect(grouping.webObjects.map((webObject) => webObject.instancePatternKey)).toEqual([
      "/teams/{team}",
      "/teams/{team}/members/{member}",
      "/products/{product}",
    ]);
  });

  it("leaves a page whose URL does not parse standalone, and handles no pages at all", () => {
    expect(detectPagePatterns([{ id: "broken", url: "not a url", title: null, structureSkeleton: null }])).toEqual({
      webObjects: [],
      standalonePageIds: ["broken"],
    });
    expect(detectPagePatterns([])).toEqual({ webObjects: [], standalonePageIds: [] });
  });

  it("is the same for /websites/ and /websites (a trailing slash adds no segment)", () => {
    expect(readPathSegments(`${ORIGIN}/websites/`)).toEqual(["websites"]);
    expect(readPathSegments(`${ORIGIN}/`)).toEqual([]);
    expect(readPathSegments("not a url")).toBeNull();
  });
});

describe("findConfirmedSlugPatterns", () => {
  it("returns each slug pattern the pages confirm, once", () => {
    const slugPatterns = findConfirmedSlugPatterns(
      buildPages(["/blog/a", "/blog/b", "/blog/c", "/about"], () => POST_SKELETON),
    );

    expect(slugPatterns).toEqual([
      [
        { kind: "static", value: "blog" },
        { kind: "variable", valueShape: "slug" },
      ],
    ]);
  });

  it("returns nothing when no slug is confirmed", () => {
    expect(findConfirmedSlugPatterns(buildPages(["/websites/42", "/websites/43", "/websites/44"]))).toEqual([]);
  });

  it("reads a skeleton only for pages whose URL has enough siblings to be a slug", () => {
    const pages = buildPages(
      [
        "/about",
        "/pricing",
        "/contact",
        "/blog/a",
        "/blog/b",
        "/blog/c",
        "/news/x",
        "/news/y",
        `/websites/${WEBSITE_IDS[0]}/edit`,
        `/websites/${WEBSITE_IDS[0]}/settings`,
        `/websites/${WEBSITE_IDS[0]}/members`,
      ],
      () => null,
    );
    const readStructureSkeleton = vi.fn<ReadStructureSkeleton>(() => POST_SKELETON);

    const slugPatterns = findConfirmedSlugPatterns(pages, readStructureSkeleton);

    const readPaths = readStructureSkeleton.mock.calls.map(([page]) => new URL(page.url).pathname);
    expect(new Set(readPaths)).toEqual(new Set(["/blog/a", "/blog/b", "/blog/c"]));
    expect(slugPatterns.map((slugPattern) => formatPatternKey(buildPathSegments(slugPattern)))).toEqual([
      "/blog/{blog}",
    ]);
  });

  it("reads skeletons through the reader it is given, also for siblings a collapse reveals one level up", () => {
    const pages = buildPages(
      ["/docs/guides/a", "/docs/guides/b", "/docs/guides/c", "/docs/reference/x", "/docs/reference/y", "/docs/reference/z", "/docs/tutorials/q", "/docs/tutorials/r", "/docs/tutorials/s"],
      () => null,
    );
    const readStructureSkeleton = vi.fn<ReadStructureSkeleton>(() => POST_SKELETON);

    const slugPatterns = findConfirmedSlugPatterns(pages, readStructureSkeleton);

    expect(new Set(readStructureSkeleton.mock.calls.map(([page]) => page.id))).toEqual(
      new Set(pages.map((page) => page.id)),
    );
    expect(slugPatterns.map((slugPattern) => formatPatternKey(buildPathSegments(slugPattern)))).toEqual([
      "/docs/{doc}/{item}",
    ]);
  });
});

describe("patternKeyForPath", () => {
  const blogSlugPattern = parsePatternKey("/blog/{blog}");

  it("keys a link by its id-shaped segments", () => {
    expect(patternKeyForPath(`${ORIGIN}/websites/${WEBSITE_IDS[0]}/actions/${ACTION_IDS[0]}`, [])).toBe(
      "/websites/{website}/actions/{action}",
    );
  });

  it("keys a link by a confirmed slug pattern", () => {
    expect(patternKeyForPath(`${ORIGIN}/blog/fourth-post`, [blogSlugPattern])).toBe("/blog/{blog}");
  });

  it("gives no key to a link without a variable segment, or one that does not parse", () => {
    expect(patternKeyForPath(`${ORIGIN}/blog/fourth-post`, [])).toBeNull();
    expect(patternKeyForPath(`${ORIGIN}/`, [blogSlugPattern])).toBeNull();
    expect(patternKeyForPath("not a url", [])).toBeNull();
  });
});

describe("pattern helpers", () => {
  it("formats tokens as a key and parses a key back", () => {
    const tokens = tokenizePathSegments(["websites", WEBSITE_IDS[0], "edit"]);

    expect(formatPatternKey(buildPathSegments(tokens))).toBe("/websites/{website}/edit");
    expect(formatPatternKey([])).toBe("/");
    expect(parsePatternKey("/websites/{website}/edit")).toEqual([
      { kind: "static", value: "websites" },
      { kind: "variable", valueShape: "slug" },
      { kind: "static", value: "edit" },
    ]);
  });

  it("matches a pattern against tokens: statics equal, a pattern variable facing anything, a token variable only a variable", () => {
    const pattern = parsePatternKey("/websites/{website}");

    expect(matchPagePattern(pattern, parsePatternKey("/websites/abc"))).toBe(true);
    expect(matchPagePattern(pattern, parsePatternKey("/websites/{website}"))).toBe(true);
    expect(matchPagePattern(pattern, parsePatternKey("/sites/abc"))).toBe(false);
    expect(matchPagePattern(pattern, parsePatternKey("/websites/abc/edit"))).toBe(false);
    expect(matchPagePattern(parsePatternKey("/websites/new"), parsePatternKey("/websites/{website}"))).toBe(false);
  });

  it.each([
    ["categories", "category"],
    ["boxes", "box"],
    ["matches", "match"],
    ["addresses", "address"],
    ["actions", "action"],
    ["class", "class"],
    ["status", "status"],
    ["analysis", "analysis"],
    ["us", "us"],
    ["blog", "blog"],
  ])("makes %s singular as %s", (word, singularWord) => {
    expect(singularizeWord(word)).toBe(singularWord);
  });
});
