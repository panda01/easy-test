import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  CRAWL_RUN_POLL_INTERVAL_MS,
  useCrawlRunProgress,
} from "../../src/hooks/useCrawlRunProgress";
import {
  buildCrawledPageSummaryRecord,
  buildCrawlRunWithPagesRecord,
  buildJsonResponse,
  countRequests,
  stubFetchRoutes,
} from "./support/frontendTestHelpers";

const CRAWL_RUN_API_URL = "/api/websites/website-1/crawl-runs/crawl-run-1";

/**
 * Moves the fake clock forward and lets whatever it triggered settle.
 * @param milliseconds - How far to move the clock
 * @returns Resolves once the triggered work has settled
 */
async function advanceClock(milliseconds: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

describe("useCrawlRunProgress", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("re-fetches the run every 2 seconds while it is running, and stops once it has ended", async () => {
    const runningRun = buildCrawlRunWithPagesRecord({
      status: "running",
      visitedPageCount: 1,
      pages: [buildCrawledPageSummaryRecord()],
    });
    const finishedRun = buildCrawlRunWithPagesRecord({
      status: "finished",
      visitedPageCount: 2,
      pages: [
        buildCrawledPageSummaryRecord(),
        buildCrawledPageSummaryRecord({ id: "crawled-page-2", parentPageId: "crawled-page-1" }),
      ],
    });
    let requestCount = 0;
    const fetchStub = stubFetchRoutes({
      [`GET ${CRAWL_RUN_API_URL}`]: () => {
        requestCount += 1;
        const body = requestCount === 1 ? runningRun : finishedRun;
        return Promise.resolve(buildJsonResponse(200, body));
      },
    });

    const { result } = renderHook(() => useCrawlRunProgress("website-1", "crawl-run-1"));
    await advanceClock(0);
    expect(result.current.data).toEqual(runningRun);

    await advanceClock(CRAWL_RUN_POLL_INTERVAL_MS);
    expect(result.current.data).toEqual(finishedRun);

    await advanceClock(CRAWL_RUN_POLL_INTERVAL_MS * 5);
    expect(countRequests(fetchStub, "GET", CRAWL_RUN_API_URL)).toBe(2);
    expect(CRAWL_RUN_POLL_INTERVAL_MS).toBe(2000);
  });
});
