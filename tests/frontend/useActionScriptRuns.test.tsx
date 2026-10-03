import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useActionScriptRuns } from "../../src/hooks/useActionScriptRuns";
import {
  buildActionScriptRunRecord,
  countRequests,
  stubFetchRoutes,
} from "./support/frontendTestHelpers";

const RUNS_API_URL = "/api/websites/website-1/actions/item-1/scripts/script-1/runs";

describe("useActionScriptRuns", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("GETs the script's runs and returns them in the server's order", async () => {
    const newer = buildActionScriptRunRecord({ id: "run-2" });
    const older = buildActionScriptRunRecord({ id: "run-1" });
    const fetchStub = stubFetchRoutes({
      [`GET ${RUNS_API_URL}`]: { status: 200, body: [newer, older] },
    });

    const { result } = renderHook(() => useActionScriptRuns("website-1", "item-1", "script-1"));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.runs).toEqual([newer, older]);
    expect(fetchStub).toHaveBeenCalledWith(RUNS_API_URL);
  });

  it("requests nothing and stays empty while there is no script", () => {
    const fetchStub = stubFetchRoutes({});

    const { result } = renderHook(() => useActionScriptRuns("website-1", "item-1", null));

    expect(result.current).toMatchObject({ runs: [], isLoading: false, errorMessage: null });
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("adds a finished run first without refetching, but only for this script", async () => {
    const fetchStub = stubFetchRoutes({ [`GET ${RUNS_API_URL}`]: { status: 200, body: [] } });
    const { result } = renderHook(() => useActionScriptRuns("website-1", "item-1", "script-1"));
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    act(() => {
      result.current.addFinishedRun(buildActionScriptRunRecord({ id: "run-3" }));
      result.current.addFinishedRun(
        buildActionScriptRunRecord({ id: "run-of-other-script", actionScriptId: "script-2" }),
      );
    });

    expect(result.current.runs.map((run) => run.id)).toEqual(["run-3"]);
    expect(countRequests(fetchStub, "GET", RUNS_API_URL)).toBe(1);
  });
});
