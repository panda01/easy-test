import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useCrawlRuns } from "../../src/hooks/useCrawlRuns";
import { buildCrawlRunRecord, stubFetchRoutes } from "./support/frontendTestHelpers";

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
    expect(result.current).toEqual({ data: [newer, older], isLoading: false, errorMessage: null });
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
});
