import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useLoginRuns } from "../../src/hooks/useLoginRuns";
import { buildLoginRunRecord, stubFetchRoutes } from "./support/frontendTestHelpers";

const LOGIN_RUNS_API_URL = "/api/websites/website-1/actions/login-action-1/login-runs";

const newerLoginRun = buildLoginRunRecord({ id: "login-run-2", succeeded: false, errorMessage: "Wrong password" });
const olderLoginRun = buildLoginRunRecord({ id: "login-run-1" });

describe("useLoginRuns", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("GETs the Login action's login runs and returns them in the server's order", async () => {
    const fetchStub = stubFetchRoutes({
      [`GET ${LOGIN_RUNS_API_URL}`]: { status: 200, body: [newerLoginRun, olderLoginRun] },
    });

    const { result } = renderHook(() => useLoginRuns("website-1", "login-action-1", true));

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    const { reload, ...loadedState } = result.current;
    expect(loadedState).toEqual({ data: [newerLoginRun, olderLoginRun], isLoading: false, errorMessage: null });
    expect(reload).toBeInstanceOf(Function);
    expect(fetchStub).toHaveBeenCalledWith(LOGIN_RUNS_API_URL);
  });

  it("fetches nothing and stays idle for any other action, until it is needed", async () => {
    const fetchStub = stubFetchRoutes({
      [`GET ${LOGIN_RUNS_API_URL}`]: { status: 200, body: [olderLoginRun] },
    });

    const { result, rerender } = renderHook(
      ({ isNeeded }: { isNeeded: boolean }) => useLoginRuns("website-1", "login-action-1", isNeeded),
      { initialProps: { isNeeded: false } },
    );

    const { reload, ...idleState } = result.current;
    expect(idleState).toEqual({ data: null, isLoading: false, errorMessage: null });
    expect(reload).toBeInstanceOf(Function);
    expect(fetchStub).not.toHaveBeenCalled();

    rerender({ isNeeded: true });

    await waitFor(() => {
      expect(result.current.data).toEqual([olderLoginRun]);
    });
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it("reports the server's reason when the list cannot be fetched", async () => {
    stubFetchRoutes({
      [`GET ${LOGIN_RUNS_API_URL}`]: { status: 404, body: { error: "Action not found" } },
    });

    const { result } = renderHook(() => useLoginRuns("website-1", "login-action-1", true));

    await waitFor(() => {
      expect(result.current.errorMessage).toBe("Action not found");
    });
    expect(result.current.data).toBeNull();
  });
});
