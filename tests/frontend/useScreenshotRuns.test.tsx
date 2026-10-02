import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useScreenshotRuns } from "../../src/hooks/useScreenshotRuns";
import {
  buildJsonResponse,
  buildScreenshotRunRecord,
  countRequests,
  createDeferred,
  stubFetchRoutes,
} from "./support/frontendTestHelpers";

const RUNS_API_URL = "/api/websites/website-1/screenshot-runs";
const OTHER_RUNS_API_URL = "/api/websites/website-2/screenshot-runs";

const fetchedNewerRun = buildScreenshotRunRecord({ id: "run-2", createdAt: "2026-03-02T00:00:00.000Z" });
const fetchedOlderRun = buildScreenshotRunRecord({ id: "run-1", createdAt: "2026-03-01T00:00:00.000Z" });

describe("useScreenshotRuns", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("GETs the website's screenshot runs and returns them in the server's order", async () => {
    const fetchStub = stubFetchRoutes({
      [`GET ${RUNS_API_URL}`]: { status: 200, body: [fetchedNewerRun, fetchedOlderRun] },
    });

    const { result } = renderHook(() => useScreenshotRuns("website-1"));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.runs).toEqual([fetchedNewerRun, fetchedOlderRun]);
    expect(result.current.errorMessage).toBeNull();
    expect(fetchStub).toHaveBeenCalledWith(RUNS_API_URL);
  });

  it("reports loading with an empty (never null) run list while the request is in flight", () => {
    const pendingRuns = createDeferred<Response>();
    stubFetchRoutes({ [`GET ${RUNS_API_URL}`]: () => pendingRuns.promise });

    const { result } = renderHook(() => useScreenshotRuns("website-1"));

    expect(result.current.isLoading).toBe(true);
    expect(result.current.runs).toEqual([]);
  });

  it("passes the server's error through with an empty run list", async () => {
    stubFetchRoutes({
      [`GET ${RUNS_API_URL}`]: { status: 404, body: { error: "Website not found" } },
    });

    const { result } = renderHook(() => useScreenshotRuns("website-1"));

    await waitFor(() => {
      expect(result.current.errorMessage).toBe("Website not found");
    });
    expect(result.current.runs).toEqual([]);
  });

  it("puts a taken run ahead of the fetched runs without refetching", async () => {
    const fetchStub = stubFetchRoutes({
      [`GET ${RUNS_API_URL}`]: { status: 200, body: [fetchedNewerRun, fetchedOlderRun] },
    });
    const { result } = renderHook(() => useScreenshotRuns("website-1"));
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    const takenRun = buildScreenshotRunRecord({ id: "run-3" });

    act(() => {
      result.current.addTakenRun(takenRun);
    });

    expect(result.current.runs.map((run) => run.id)).toEqual(["run-3", "run-2", "run-1"]);
    expect(countRequests(fetchStub, "GET", RUNS_API_URL)).toBe(1);
  });

  it("puts the most recently taken run first when several are taken", async () => {
    stubFetchRoutes({ [`GET ${RUNS_API_URL}`]: { status: 200, body: [] } });
    const { result } = renderHook(() => useScreenshotRuns("website-1"));
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    act(() => {
      result.current.addTakenRun(buildScreenshotRunRecord({ id: "first-taken" }));
    });
    act(() => {
      result.current.addTakenRun(buildScreenshotRunRecord({ id: "second-taken" }));
    });

    expect(result.current.runs.map((run) => run.id)).toEqual(["second-taken", "first-taken"]);
  });

  it("lists a run only once when the fetched list already contains a taken run", async () => {
    const pendingRuns = createDeferred<Response>();
    stubFetchRoutes({ [`GET ${RUNS_API_URL}`]: () => pendingRuns.promise });
    const { result } = renderHook(() => useScreenshotRuns("website-1"));
    const takenRun = buildScreenshotRunRecord({ id: "run-2" });

    act(() => {
      result.current.addTakenRun(takenRun);
    });
    await act(async () => {
      pendingRuns.resolve(buildJsonResponse(200, [fetchedNewerRun, fetchedOlderRun]));
      await pendingRuns.promise;
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.runs.map((run) => run.id)).toEqual(["run-2", "run-1"]);
  });

  it("still shows taken runs when the run list failed to load", async () => {
    stubFetchRoutes({
      [`GET ${RUNS_API_URL}`]: { status: 500, body: { error: "Database unavailable" } },
    });
    const { result } = renderHook(() => useScreenshotRuns("website-1"));
    await waitFor(() => {
      expect(result.current.errorMessage).toBe("Database unavailable");
    });

    act(() => {
      result.current.addTakenRun(buildScreenshotRunRecord({ id: "run-3" }));
    });

    expect(result.current.runs.map((run) => run.id)).toEqual(["run-3"]);
    expect(result.current.errorMessage).toBe("Database unavailable");
  });

  it("hides one website's taken runs after the page switches to another website", async () => {
    const otherWebsitesRun = buildScreenshotRunRecord({ id: "other-run", websiteId: "website-2" });
    stubFetchRoutes({
      [`GET ${RUNS_API_URL}`]: { status: 200, body: [] },
      [`GET ${OTHER_RUNS_API_URL}`]: { status: 200, body: [otherWebsitesRun] },
    });
    const { result, rerender } = renderHook(
      ({ websiteId }: { websiteId: string }) => useScreenshotRuns(websiteId),
      { initialProps: { websiteId: "website-1" } },
    );
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    act(() => {
      result.current.addTakenRun(buildScreenshotRunRecord({ id: "website-1-run" }));
    });

    rerender({ websiteId: "website-2" });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.runs.map((run) => run.id)).toEqual(["other-run"]);
  });
});
