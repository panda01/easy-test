import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { CrawledPageInput } from "../../../server/services/dbService.js";
import type { CrawlOutcome, RecordVisitedPage } from "../../../server/services/crawlerService.js";

/**
 * The database and the browser are both replaced: this spec is about how a
 * crawl is started, guarded, recorded, and finished. `crawlWebsite` is a mock
 * whose outcome each test controls; `measureElapsedMs` is pinned so recorded
 * durations are predictable.
 */
const { mockDbService, mockCrawlerService, mockPlaywrightService } = vi.hoisted(() => ({
  mockDbService: {
    createCrawlRunForWebsite: vi.fn(),
    recordCrawledPage: vi.fn(),
    finishCrawlRun: vi.fn(),
    markRunningCrawlRunsInterrupted: vi.fn(),
  },
  mockCrawlerService: { CRAWL_PAGE_LIMIT: 50, crawlWebsite: vi.fn() },
  mockPlaywrightService: { measureElapsedMs: vi.fn() },
}));

vi.mock("../../../server/services/dbService.js", () => mockDbService);
vi.mock("../../../server/services/crawlerService.js", () => mockCrawlerService);
vi.mock("../../../server/services/playwrightService.js", () => mockPlaywrightService);

import {
  startCrawlRun,
  markUnfinishedCrawlRunsInterrupted,
} from "../../../server/services/crawlRunService.js";

const website = {
  id: "website-1",
  url: "https://example.com/",
  name: "Example",
  description: null,
  networkIdleTimeoutMs: 4000,
  screenshotMinimumWaitMs: 250,
  createdAt: new Date("2026-03-01T00:00:00.000Z"),
  updatedAt: new Date("2026-03-01T00:00:00.000Z"),
  deletedAt: null,
};

const createdCrawlRun = {
  id: "crawl-run-1",
  websiteId: "website-1",
  startUrl: "https://example.com/",
  status: "running",
  pageLimit: 50,
  visitedPageCount: 0,
  waitingUrlCount: 0,
  errorMessage: null,
  durationMs: null,
  finishedAt: null,
  createdAt: new Date("2026-03-02T00:00:00.000Z"),
  updatedAt: new Date("2026-03-02T00:00:00.000Z"),
  deletedAt: null,
};

const visitedPage: CrawledPageInput = {
  parentPageId: null,
  url: "https://example.com/",
  requestedUrl: "https://example.com/",
  finalUrl: "https://example.com/",
  visitOrder: 0,
  depth: 0,
  succeeded: true,
  httpStatus: 200,
  errorMessage: null,
  title: "Example",
  ariaSnapshot: '- heading "Example" [level=1]',
  linkedUrls: [],
  durationMs: 800,
};

/** The duration `measureElapsedMs` reports for every crawl. */
const PINNED_DURATION_MS = 4321;

/**
 * Reads the recorder `startCrawlRun` handed to `crawlWebsite`.
 * @returns The recorder function
 */
function readRecorderPassedToCrawler(): RecordVisitedPage {
  const crawlWebsiteArguments = mockCrawlerService.crawlWebsite.mock.calls[0] as [
    string,
    unknown,
    RecordVisitedPage,
  ];
  return crawlWebsiteArguments[2];
}

/**
 * Starts a crawl and narrows the result to the started case.
 * @returns The new run and the promise for the crawl's end
 */
async function startCrawlThatMustStart(): Promise<{
  crawlRun: unknown;
  crawlCompletion: Promise<void>;
}> {
  const crawlRunStart = await startCrawlRun(website);
  if (!crawlRunStart.crawlStarted) {
    throw new Error("Expected the crawl to start");
  }
  return crawlRunStart;
}

describe("startCrawlRun", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockCrawlerService.CRAWL_PAGE_LIMIT = 50;
    mockPlaywrightService.measureElapsedMs.mockReturnValue(PINNED_DURATION_MS);
    mockDbService.createCrawlRunForWebsite.mockResolvedValue(createdCrawlRun);
    mockDbService.finishCrawlRun.mockResolvedValue(true);
    const finishedOutcome: CrawlOutcome = {
      stopReason: "finished",
      visitedPageCount: 3,
      waitingUrlCount: 0,
    };
    mockCrawlerService.crawlWebsite.mockResolvedValue(finishedOutcome);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a running run for the website's URL and page limit, and returns it before the crawl ends", async () => {
    let finishCrawl: (outcome: CrawlOutcome) => void = () => undefined;
    mockCrawlerService.crawlWebsite.mockReturnValue(
      new Promise<CrawlOutcome>((resolve) => {
        finishCrawl = resolve;
      }),
    );

    const { crawlRun, crawlCompletion } = await startCrawlThatMustStart();

    expect(crawlRun).toBe(createdCrawlRun);
    expect(mockDbService.createCrawlRunForWebsite).toHaveBeenCalledWith("website-1", {
      startUrl: "https://example.com/",
      pageLimit: 50,
    });
    expect(mockCrawlerService.crawlWebsite).toHaveBeenCalledWith(
      "https://example.com/",
      { networkIdleTimeoutMs: 4000, screenshotMinimumWaitMs: 250 },
      expect.any(Function),
    );
    expect(mockDbService.finishCrawlRun).not.toHaveBeenCalled();

    finishCrawl({ stopReason: "finished", visitedPageCount: 1, waitingUrlCount: 0 });
    await crawlCompletion;
    expect(mockDbService.finishCrawlRun).toHaveBeenCalledTimes(1);
  });

  it("records each visited page on the run and hands back the saved page's id", async () => {
    mockDbService.recordCrawledPage.mockResolvedValue({ ...visitedPage, id: "crawled-page-1" });
    const { crawlCompletion } = await startCrawlThatMustStart();
    await crawlCompletion;
    const recordVisitedPage = readRecorderPassedToCrawler();

    const savedPageId = await recordVisitedPage(visitedPage, {
      visitedPageCount: 1,
      waitingUrlCount: 4,
    });

    expect(savedPageId).toBe("crawled-page-1");
    expect(mockDbService.recordCrawledPage).toHaveBeenCalledWith(
      "website-1",
      "crawl-run-1",
      { visitedPageCount: 1, waitingUrlCount: 4 },
      visitedPage,
    );
  });

  it("hands back null from the recorder when the run is no longer active", async () => {
    mockDbService.recordCrawledPage.mockResolvedValue(null);
    const { crawlCompletion } = await startCrawlThatMustStart();
    await crawlCompletion;
    const recordVisitedPage = readRecorderPassedToCrawler();

    const savedPageId = await recordVisitedPage(visitedPage, {
      visitedPageCount: 1,
      waitingUrlCount: 0,
    });

    expect(savedPageId).toBeNull();
  });

  it.each([
    { stopReason: "finished" as const, waitingUrlCount: 0 },
    { stopReason: "stoppedAtPageLimit" as const, waitingUrlCount: 17 },
    { stopReason: "stoppedAtTimeLimit" as const, waitingUrlCount: 5 },
  ])(
    "finishes the run as $stopReason with the waiting links and the crawl's duration",
    async ({ stopReason, waitingUrlCount }) => {
      mockCrawlerService.crawlWebsite.mockResolvedValue({
        stopReason,
        visitedPageCount: 50,
        waitingUrlCount,
      });

      const { crawlCompletion } = await startCrawlThatMustStart();
      await crawlCompletion;

      expect(mockDbService.finishCrawlRun).toHaveBeenCalledWith("website-1", "crawl-run-1", {
        status: stopReason,
        waitingUrlCount,
        errorMessage: null,
        durationMs: PINNED_DURATION_MS,
      });
    },
  );

  it("writes nothing more when the run was deleted with its website mid-crawl", async () => {
    mockCrawlerService.crawlWebsite.mockResolvedValue({
      stopReason: "stoppedBecauseRunWasDeleted",
      visitedPageCount: 2,
      waitingUrlCount: 3,
    });

    const { crawlCompletion } = await startCrawlThatMustStart();
    await crawlCompletion;

    expect(mockDbService.finishCrawlRun).not.toHaveBeenCalled();
  });

  it("finishes the run as interrupted, with the reason, when the browser closed mid-crawl", async () => {
    mockCrawlerService.crawlWebsite.mockResolvedValue({
      stopReason: "stoppedBecauseBrowserClosed",
      visitedPageCount: 4,
      waitingUrlCount: 9,
    });

    const { crawlCompletion } = await startCrawlThatMustStart();
    await crawlCompletion;

    expect(mockDbService.finishCrawlRun).toHaveBeenCalledWith("website-1", "crawl-run-1", {
      status: "interrupted",
      waitingUrlCount: 9,
      errorMessage: "The browser closed mid-crawl - most likely the server restarted.",
      durationMs: PINNED_DURATION_MS,
    });
  });

  it("finishes the run as failed with the reason when the crawl itself breaks", async () => {
    mockCrawlerService.crawlWebsite.mockRejectedValue(
      new Error("browserType.launch: Executable doesn't exist"),
    );

    const { crawlCompletion } = await startCrawlThatMustStart();
    await expect(crawlCompletion).resolves.toBeUndefined();

    expect(mockDbService.finishCrawlRun).toHaveBeenCalledWith("website-1", "crawl-run-1", {
      status: "failed",
      waitingUrlCount: 0,
      errorMessage: "browserType.launch: Executable doesn't exist",
      durationMs: PINNED_DURATION_MS,
    });
  });

  it("logs instead of rejecting when even marking the run failed fails", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockCrawlerService.crawlWebsite.mockRejectedValue(new Error("crawl broke"));
    mockDbService.finishCrawlRun.mockRejectedValue(new Error("database is down"));

    const { crawlCompletion } = await startCrawlThatMustStart();
    await expect(crawlCompletion).resolves.toBeUndefined();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[crawl] crawl run crawl-run-1 failed (crawl broke) and could not be marked failed: database is down",
    );
  });

  it("refuses a second crawl of the same website while one is running, then allows one after it ends", async () => {
    let finishCrawl: (outcome: CrawlOutcome) => void = () => undefined;
    mockCrawlerService.crawlWebsite.mockReturnValueOnce(
      new Promise<CrawlOutcome>((resolve) => {
        finishCrawl = resolve;
      }),
    );

    const { crawlCompletion } = await startCrawlThatMustStart();
    const secondStart = await startCrawlRun(website);

    expect(secondStart).toEqual({ crawlStarted: false });
    expect(mockDbService.createCrawlRunForWebsite).toHaveBeenCalledTimes(1);

    finishCrawl({ stopReason: "finished", visitedPageCount: 1, waitingUrlCount: 0 });
    await crawlCompletion;
    const thirdStart = await startCrawlThatMustStart();
    await thirdStart.crawlCompletion;
    expect(mockDbService.createCrawlRunForWebsite).toHaveBeenCalledTimes(2);
  });

  it("starts only one crawl when two requests for the same website arrive together", async () => {
    const [firstStart, secondStart] = await Promise.all([
      startCrawlRun(website),
      startCrawlRun(website),
    ]);

    const startedCount = [firstStart, secondStart].filter((start) => start.crawlStarted).length;
    expect(startedCount).toBe(1);
    expect(mockDbService.createCrawlRunForWebsite).toHaveBeenCalledTimes(1);
    for (const start of [firstStart, secondStart]) {
      if (start.crawlStarted) await start.crawlCompletion;
    }
  });

  it("crawls two different websites at the same time", async () => {
    const otherWebsite = { ...website, id: "website-2", url: "https://other.example/" };

    const [firstStart, secondStart] = await Promise.all([
      startCrawlRun(website),
      startCrawlRun(otherWebsite),
    ]);

    expect(firstStart.crawlStarted).toBe(true);
    expect(secondStart.crawlStarted).toBe(true);
    for (const start of [firstStart, secondStart]) {
      if (start.crawlStarted) await start.crawlCompletion;
    }
  });

  it("rejects, crawls nothing, and releases the website when the run cannot be created", async () => {
    const createError = new Error("connection refused");
    mockDbService.createCrawlRunForWebsite.mockRejectedValueOnce(createError);

    await expect(startCrawlRun(website)).rejects.toBe(createError);
    expect(mockCrawlerService.crawlWebsite).not.toHaveBeenCalled();

    const retry = await startCrawlThatMustStart();
    await retry.crawlCompletion;
    expect(mockCrawlerService.crawlWebsite).toHaveBeenCalledTimes(1);
  });
});

describe("markUnfinishedCrawlRunsInterrupted", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("marks the leftover running runs interrupted and logs how many", async () => {
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    mockDbService.markRunningCrawlRunsInterrupted.mockResolvedValue(2);

    await markUnfinishedCrawlRunsInterrupted();

    expect(mockDbService.markRunningCrawlRunsInterrupted).toHaveBeenCalledTimes(1);
    expect(consoleLogSpy).toHaveBeenCalledWith(
      "[crawl] marked 2 unfinished crawl run(s) interrupted",
    );
  });

  it("logs nothing when no run was left running", async () => {
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    mockDbService.markRunningCrawlRunsInterrupted.mockResolvedValue(0);

    await markUnfinishedCrawlRunsInterrupted();

    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it("logs the failure instead of rejecting, so the server still starts", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockDbService.markRunningCrawlRunsInterrupted.mockRejectedValue(new Error("database is down"));

    await expect(markUnfinishedCrawlRunsInterrupted()).resolves.toBeUndefined();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[crawl] could not mark unfinished crawl runs interrupted: database is down",
    );
  });
});
