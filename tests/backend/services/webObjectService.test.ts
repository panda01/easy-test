import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/** The database is replaced: this spec is about grouping, joining, and saving. */
const mockDbService = vi.hoisted(() => ({
  listCrawledPageSummariesForRun: vi.fn(),
  replaceWebsiteWebObjects: vi.fn(),
}));

vi.mock("../../../server/services/dbService.js", () => mockDbService);

import {
  buildCrawlPageGrouping,
  buildWebObjectInputs,
  readSkippedLinkCounts,
  saveCrawlWebObjects,
} from "../../../server/services/webObjectService.js";
import { detectPagePatterns, type PatternPage } from "../../../server/utils/detectPagePatterns.js";

const ORIGIN = "http://localhost:5180";

/** A start page and two website pages, one of which has an edit page. */
const crawledPages: PatternPage[] = [
  { id: "home", url: `${ORIGIN}/`, title: "Home", structureSkeleton: "main" },
  { id: "website-a", url: `${ORIGIN}/websites/41`, title: null, structureSkeleton: "main" },
  { id: "website-b", url: `${ORIGIN}/websites/42`, title: null, structureSkeleton: "main" },
  { id: "website-a-edit", url: `${ORIGIN}/websites/41/edit`, title: null, structureSkeleton: "main" },
];

describe("readSkippedLinkCounts", () => {
  it("keeps the whole-number entries of a JSON object", () => {
    expect(readSkippedLinkCounts({ "/a/{item}": 3, "/b/{item}": 1.5, "/c/{item}": "4", "/d/{item}": 0 })).toEqual({
      "/a/{item}": 3,
      "/d/{item}": 0,
    });
  });

  it.each([null, undefined, [], "counts", 7])("reads %j as no counts", (storedCounts) => {
    expect(readSkippedLinkCounts(storedCounts)).toEqual({});
  });
});

describe("buildCrawlPageGrouping", () => {
  it("groups the run's own pages and joins in the run's saved object's id and the user's name", () => {
    const grouping = buildCrawlPageGrouping(crawledPages, { "/websites/{website}": 2 }, [
      { id: "web-object-1", instancePatternKey: "/websites/{website}", detectedName: "Website", name: "Site" },
    ]);

    expect(grouping).toEqual({
      webObjects: [
        {
          webObjectId: "web-object-1",
          instancePatternKey: "/websites/{website}",
          displayName: "Site",
          detectedName: "Website",
          parentInstancePatternKey: null,
          instanceValues: ["41", "42"],
          skippedLinkCount: 2,
          patterns: [
            {
              key: "/websites/{website}",
              role: "instance",
              viewName: null,
              detectedBy: "idShape",
              pageIds: ["website-a", "website-b"],
            },
            {
              key: "/websites/{website}/edit",
              role: "view",
              viewName: "edit",
              detectedBy: "idShape",
              pageIds: ["website-a-edit"],
            },
          ],
        },
      ],
      standalonePageIds: ["home"],
    });
  });

  it("shows the detected name and no id for an object this run has not saved", () => {
    const grouping = buildCrawlPageGrouping(crawledPages, null, []);

    expect(grouping.webObjects[0]).toMatchObject({
      webObjectId: null,
      displayName: "Website",
      skippedLinkCount: 0,
    });
  });

  it("shows the detected name for a saved object with no rename", () => {
    const grouping = buildCrawlPageGrouping(crawledPages, {}, [
      { id: "web-object-1", instancePatternKey: "/websites/{website}", detectedName: "Website", name: null },
    ]);

    expect(grouping.webObjects[0]).toMatchObject({ webObjectId: "web-object-1", displayName: "Website" });
  });
});

describe("buildWebObjectInputs", () => {
  it("turns each detected object into the row a crawl's end saves, with its patterns' page counts", () => {
    const inputs = buildWebObjectInputs(detectPagePatterns(crawledPages, { "/websites/{website}": 2 }));

    expect(inputs).toEqual([
      {
        instancePatternKey: "/websites/{website}",
        detectedName: "Website",
        parentInstancePatternKey: null,
        instanceCount: 2,
        skippedLinkCount: 2,
        pagePatterns: [
          {
            key: "/websites/{website}",
            segments: [
              { kind: "static", value: "websites" },
              { kind: "variable", placeholder: "website", valueShape: "number" },
            ],
            role: "instance",
            viewName: null,
            detectedBy: "idShape",
            pageCount: 2,
          },
          {
            key: "/websites/{website}/edit",
            segments: [
              { kind: "static", value: "websites" },
              { kind: "variable", placeholder: "website", valueShape: "number" },
              { kind: "static", value: "edit" },
            ],
            role: "view",
            viewName: "edit",
            detectedBy: "idShape",
            pageCount: 1,
          },
        ],
      },
    ]);
  });
});

describe("saveCrawlWebObjects", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("groups the run's pages and replaces the website's web objects with them", async () => {
    mockDbService.listCrawledPageSummariesForRun.mockResolvedValue(crawledPages);
    mockDbService.replaceWebsiteWebObjects.mockResolvedValue(true);

    await saveCrawlWebObjects("website-1", "crawl-run-1", { "/websites/{website}": 2 });

    expect(mockDbService.listCrawledPageSummariesForRun).toHaveBeenCalledWith("website-1", "crawl-run-1");
    expect(mockDbService.replaceWebsiteWebObjects).toHaveBeenCalledWith(
      "website-1",
      "crawl-run-1",
      buildWebObjectInputs(detectPagePatterns(crawledPages, { "/websites/{website}": 2 })),
    );
  });

  it("logs instead of rejecting when the objects cannot be saved", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockDbService.listCrawledPageSummariesForRun.mockResolvedValue(crawledPages);
    mockDbService.replaceWebsiteWebObjects.mockRejectedValue(new Error("database is down"));

    await expect(saveCrawlWebObjects("website-1", "crawl-run-1", {})).resolves.toBeUndefined();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[crawl] crawl run crawl-run-1 of website website-1 could not save its web objects: database is down",
    );
  });
});
