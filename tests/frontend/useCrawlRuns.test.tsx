import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { CRAWL_RUN_POLL_INTERVAL_MS } from "../../src/hooks/useCrawlRunProgress";
import { useCrawlRuns } from "../../src/hooks/useCrawlRuns";
import {
  buildCrawlRunRecord,
  buildJsonResponse,
  countRequests,
  stubFetchRoutes,
} from "./support/frontendTestHelpers";

const CRAWL_RUNS_API_URL = "/api/websites/website-1/crawl-runs";

describe("useCrawlRuns", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("GETs the website's crawl runs and returns them in the server's order", async () => {
    const newer = buildCrawlRunRecord({ id: "crawl-run-2", status: "running" });
    const older = buildCrawlRunRecord({ id: "crawl-run-1" });
    const fetchStub = stubFetchRoutes({
      [`GET ${CRAWL_RUNS_API_URL}`]: { status: 200, body: [newer, older] },
    });

    const { result } = renderHook(() => useCrawlRuns("website-1"));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current).toEqual({
      data: [newer, older],
      isLoading: false,
      errorMessage: null,
      pollErrorMessage: null,
    });
    expect(fetchStub).toHaveBeenCalledWith(CRAWL_RUNS_API_URL);
  });

  it("reports the server's reason when the list cannot be fetched", async () => {
    stubFetchRoutes({
      [`GET ${CRAWL_RUNS_API_URL}`]: { status: 404, body: { error: "Website not found" } },
    });

    const { result } = renderHook(() => useCrawlRuns("website-1"));

    await waitFor(() => {
      expect(result.current.errorMessage).toBe("Website not found");
    });
    expect(result.current.data).toBeNull();
  });

  describe("while a crawl runs", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    /**
     * Moves the fake clock forward and lets whatever it triggered settle.
     * @param milliseconds - How far to move the clock
     * @returns Resolves once the triggered work has settled
     */
    const advanceClock = async (milliseconds: number): Promise<void> => {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(milliseconds);
      });
    };

    it("re-fetches the list every 2 seconds while a listed crawl is running, and stops once none is", async () => {
      const runningRun = buildCrawlRunRecord({ id: "crawl-run-2", status: "running", visitedPageCount: 3 });
      const finishedRun = buildCrawlRunRecord({ id: "crawl-run-2", status: "finished", visitedPageCount: 9 });
      let requestCount = 0;
      const fetchStub = stubFetchRoutes({
        [`GET ${CRAWL_RUNS_API_URL}`]: () => {
          requestCount += 1;
          const body = requestCount === 1 ? [runningRun] : [finishedRun];
          return Promise.resolve(buildJsonResponse(200, body));
        },
      });

      const { result } = renderHook(() => useCrawlRuns("website-1"));
      await advanceClock(0);
      expect(result.current.data).toEqual([runningRun]);

      await advanceClock(CRAWL_RUN_POLL_INTERVAL_MS);
      expect(result.current.data).toEqual([finishedRun]);

      await advanceClock(CRAWL_RUN_POLL_INTERVAL_MS * 5);
      expect(countRequests(fetchStub, "GET", CRAWL_RUNS_API_URL)).toBe(2);
    });

    it("fetches once when no listed crawl is running", async () => {
      const fetchStub = stubFetchRoutes({
        [`GET ${CRAWL_RUNS_API_URL}`]: { status: 200, body: [buildCrawlRunRecord({ status: "finished" })] },
      });

      renderHook(() => useCrawlRuns("website-1"));
      await advanceClock(CRAWL_RUN_POLL_INTERVAL_MS * 3);

      expect(countRequests(fetchStub, "GET", CRAWL_RUNS_API_URL)).toBe(1);
    });
  });
});
