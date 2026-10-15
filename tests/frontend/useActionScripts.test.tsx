import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useActionScripts } from "../../src/hooks/useActionScripts";
import {
  buildActionScriptRecord,
  buildActionScriptRunRecord,
  countRequests,
  stubFetchRoutes,
} from "./support/frontendTestHelpers";

const SCRIPTS_API_URL = "/api/websites/website-1/actions/item-1/scripts";

describe("useActionScripts", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("GETs the action's scripts and returns them in the server's order", async () => {
    const newer = buildActionScriptRecord({ id: "script-2" });
    const older = buildActionScriptRecord({ id: "script-1" });
    const fetchStub = stubFetchRoutes({
      [`GET ${SCRIPTS_API_URL}`]: { status: 200, body: [newer, older] },
    });

    const { result } = renderHook(() => useActionScripts("website-1", "item-1"));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.scripts).toEqual([newer, older]);
    expect(result.current.errorMessage).toBeNull();
    expect(fetchStub).toHaveBeenCalledWith(SCRIPTS_API_URL);
  });

  it("adds a created script first without refetching, but only for this action", async () => {
    const fetchStub = stubFetchRoutes({
      [`GET ${SCRIPTS_API_URL}`]: { status: 200, body: [buildActionScriptRecord({ id: "script-1" })] },
    });
    const { result } = renderHook(() => useActionScripts("website-1", "item-1"));
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    act(() => {
      result.current.addCreatedScript(buildActionScriptRecord({ id: "script-2" }));
      result.current.addCreatedScript(
        buildActionScriptRecord({ id: "other-action-script", actionId: "item-2" }),
      );
    });

    expect(result.current.scripts.map((script) => script.id)).toEqual(["script-2", "script-1"]);
    expect(countRequests(fetchStub, "GET", SCRIPTS_API_URL)).toBe(1);
  });

  it("makes a run recorded on this visit its version's latestRun, without refetching, leaving other versions alone", async () => {
    const serverLatestRun = {
      id: "run-1",
      succeeded: true,
      failedStepNumber: null,
      timedOut: false,
      createdAt: "2026-04-03T00:00:00.000Z",
    };
    const fetchStub = stubFetchRoutes({
      [`GET ${SCRIPTS_API_URL}`]: {
        status: 200,
        body: [
          buildActionScriptRecord({ id: "script-2", latestRun: null }),
          buildActionScriptRecord({ id: "script-1", latestRun: serverLatestRun }),
        ],
      },
    });
    const { result } = renderHook(() => useActionScripts("website-1", "item-1"));
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    act(() => {
      result.current.recordFinishedRun(
        buildActionScriptRunRecord({
          id: "run-2",
          actionScriptId: "script-2",
          succeeded: false,
          failedStepNumber: 3,
          createdAt: "2026-04-04T00:00:00.000Z",
        }),
      );
    });

    expect(result.current.scripts.map((script) => script.latestRun)).toEqual([
      {
        id: "run-2",
        succeeded: false,
        failedStepNumber: 3,
        timedOut: false,
        createdAt: "2026-04-04T00:00:00.000Z",
      },
      serverLatestRun,
    ]);

    act(() => {
      result.current.recordFinishedRun(
        buildActionScriptRunRecord({
          id: "run-3",
          actionScriptId: "script-2",
          succeeded: false,
          timedOut: true,
          failedStepNumber: 4,
          createdAt: "2026-04-05T00:00:00.000Z",
        }),
      );
    });

    expect(result.current.scripts[0].latestRun).toEqual({
      id: "run-3",
      succeeded: false,
      failedStepNumber: 4,
      timedOut: true,
      createdAt: "2026-04-05T00:00:00.000Z",
    });
    expect(countRequests(fetchStub, "GET", SCRIPTS_API_URL)).toBe(1);
  });

  it("passes the server's error through with an empty list", async () => {
    stubFetchRoutes({
      [`GET ${SCRIPTS_API_URL}`]: { status: 404, body: { error: "Action not found" } },
    });

    const { result } = renderHook(() => useActionScripts("website-1", "item-1"));

    await waitFor(() => {
      expect(result.current.errorMessage).toBe("Action not found");
    });
    expect(result.current.scripts).toEqual([]);
  });
});
