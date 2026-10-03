import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useActionScripts } from "../../src/hooks/useActionScripts";
import {
  buildActionScriptRecord,
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
