import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useCrawledPage } from "../../src/hooks/useCrawledPage";
import { buildCrawledPageRecord, stubFetchRoutes } from "./support/frontendTestHelpers";

const CRAWLED_PAGE_API_URL = "/api/websites/website-1/crawl-runs/crawl-run-1/pages/crawled-page-1";

describe("useCrawledPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("GETs the page in full, snapshot and links included", async () => {
    const crawledPage = buildCrawledPageRecord({ linkedUrls: ["https://example.com/about"] });
    const fetchStub = stubFetchRoutes({
      [`GET ${CRAWLED_PAGE_API_URL}`]: { status: 200, body: crawledPage },
    });

    const { result } = renderHook(() =>
      useCrawledPage("website-1", "crawl-run-1", "crawled-page-1"),
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.data).toEqual(crawledPage);
    expect(fetchStub).toHaveBeenCalledWith(CRAWLED_PAGE_API_URL);
  });

  it("requests nothing while there is no page to show", () => {
    const fetchStub = stubFetchRoutes({});

    const { result } = renderHook(() => useCrawledPage("website-1", "crawl-run-1", null));

    expect(result.current).toEqual({ data: null, isLoading: false, errorMessage: null });
    expect(fetchStub).not.toHaveBeenCalled();
  });
});
