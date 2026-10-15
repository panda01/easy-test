import { describe, it, expect } from "vitest";
import { type WebsiteWithSummaryRecord } from "../../src/hooks/useWebsites";
import { describeDashboardTotals, describeLatestCrawl } from "../../src/utils/describeWebsiteSummary";

const NOW = new Date("2026-10-13T14:30:00.000Z");

/** A crawl that finished two hours before `NOW` with 46 pages. */
const finishedCrawl = {
  id: "crawl-run-1",
  status: "finished",
  visitedPageCount: 46,
  pageLimit: 50,
  createdAt: "2026-10-13T12:20:00.000Z",
  finishedAt: "2026-10-13T12:25:00.000Z",
};

/**
 * Builds a website with a summary for the dashboard's totals.
 * @param id - The website's id
 * @param actionCount - How many actions it has
 * @param latestRunAt - When its scripts last ran, or null
 * @returns The website with its summary
 */
function buildWebsiteWithSummary(
  id: string,
  actionCount: number,
  latestRunAt: string | null,
): WebsiteWithSummaryRecord {
  return {
    id,
    url: `https://${id}.example.com/`,
    name: id,
    description: null,
    networkIdleTimeoutMs: 5000,
    screenshotMinimumWaitMs: 1,
    loginUrl: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    deletedAt: null,
    summary: {
      actionCount,
      passedActionCount: actionCount,
      failedActionCount: 0,
      notRunActionCount: 0,
      latestRunAt,
      latestCrawlRun: null,
    },
  };
}

describe("describeLatestCrawl", () => {
  it("says Never crawled without a crawl", () => {
    expect(describeLatestCrawl(null, NOW)).toBe("Never crawled");
  });

  it("counts a running crawl's pages against its limit", () => {
    expect(
      describeLatestCrawl({ ...finishedCrawl, status: "running", visitedPageCount: 12, finishedAt: null }, NOW),
    ).toBe("Crawl running · 12 of 50");
  });

  it("gives a finished crawl's pages and when it ended", () => {
    expect(describeLatestCrawl(finishedCrawl, NOW)).toBe("46 pages · 2 h ago");
  });

  it("falls back on when it started for a crawl with no end time", () => {
    expect(describeLatestCrawl({ ...finishedCrawl, status: "stoppedAtPageLimit", finishedAt: null }, NOW)).toBe(
      "46 pages · 2 h ago",
    );
  });

  it("says a failed or interrupted crawl failed or was interrupted", () => {
    expect(describeLatestCrawl({ ...finishedCrawl, status: "failed" }, NOW)).toBe("Crawl failed · 2 h ago");
    expect(describeLatestCrawl({ ...finishedCrawl, status: "interrupted" }, NOW)).toBe(
      "Crawl interrupted · 2 h ago",
    );
  });
});

describe("describeDashboardTotals", () => {
  const websites = [
    buildWebsiteWithSummary("one", 7, "2026-10-13T12:00:00.000Z"),
    buildWebsiteWithSummary("two", 9, "2026-10-13T14:18:00.000Z"),
    buildWebsiteWithSummary("three", 0, null),
  ];

  it("counts the sites and their actions, and adds when a script last ran", () => {
    expect(describeDashboardTotals(websites, NOW, true)).toBe("3 sites · 16 actions · last run 12 min ago");
  });

  it("leaves the last run out of the shorter phone line", () => {
    expect(describeDashboardTotals(websites, NOW, false)).toBe("3 sites · 16 actions");
  });

  it("leaves the last run out when no script has run", () => {
    expect(describeDashboardTotals([buildWebsiteWithSummary("one", 1, null)], NOW, true)).toBe(
      "1 site · 1 action",
    );
  });
});
