import { describe, it, expect } from "vitest";
import {
  crawlRunSeverity,
  describeCrawlRunProgress,
  describeCrawlRunStatus,
  formatCrawledPagePath,
} from "../../src/utils/describeCrawlRun";

describe("describeCrawlRunStatus", () => {
  it.each([
    { status: "running", visitedPageCount: 12, expected: "Running · 12 pages so far" },
    { status: "running", visitedPageCount: 1, expected: "Running · 1 page so far" },
    { status: "finished", visitedPageCount: 34, expected: "Finished · 34 pages" },
    {
      status: "stoppedAtPageLimit",
      visitedPageCount: 50,
      expected: "Stopped at the 50-page limit · 50 pages",
    },
    { status: "stoppedAtTimeLimit", visitedPageCount: 20, expected: "Stopped at the time limit · 20 pages" },
    { status: "failed", visitedPageCount: 0, expected: "Failed · 0 pages" },
    {
      status: "interrupted",
      visitedPageCount: 7,
      expected: "Interrupted (the server restarted or the browser closed) · 7 pages",
    },
    { status: "somethingNew", visitedPageCount: 2, expected: "somethingNew · 2 pages" },
  ])("words a $status crawl of $visitedPageCount page(s) as '$expected'", ({ status, visitedPageCount, expected }) => {
    expect(describeCrawlRunStatus({ status, visitedPageCount, pageLimit: 50 })).toBe(expected);
  });
});

describe("describeCrawlRunProgress", () => {
  it("names the visited pages, the limit, and the waiting links", () => {
    expect(
      describeCrawlRunProgress({
        status: "running",
        visitedPageCount: 12,
        pageLimit: 50,
        waitingUrlCount: 30,
      }),
    ).toBe("Visited 12 of up to 50 pages · 30 links waiting");
  });

  it("uses the singular for one waiting link", () => {
    expect(
      describeCrawlRunProgress({
        status: "running",
        visitedPageCount: 1,
        pageLimit: 50,
        waitingUrlCount: 1,
      }),
    ).toBe("Visited 1 of up to 50 pages · 1 link waiting");
  });
});

describe("crawlRunSeverity", () => {
  it.each([
    { status: "running", severity: "info" },
    { status: "finished", severity: "success" },
    { status: "stoppedAtPageLimit", severity: "warning" },
    { status: "stoppedAtTimeLimit", severity: "warning" },
    { status: "failed", severity: "error" },
    { status: "interrupted", severity: "error" },
  ])("colours a $status crawl as $severity", ({ status, severity }) => {
    expect(crawlRunSeverity(status)).toBe(severity);
  });
});

describe("formatCrawledPagePath", () => {
  it("shows a page's path", () => {
    expect(formatCrawledPagePath("https://example.com/websites/abc")).toBe("/websites/abc");
    expect(formatCrawledPagePath("https://example.com/")).toBe("/");
  });

  it("shows a URL that does not parse as it is", () => {
    expect(formatCrawledPagePath("not a url")).toBe("not a url");
  });
});
