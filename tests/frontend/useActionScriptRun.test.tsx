import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useActionScriptRun } from "../../src/hooks/useActionScriptRun";
import {
  buildActionScriptRunDetailRecord,
  buildActionScriptRunScreenshotRecord,
  stubFetchRoutes,
} from "./support/frontendTestHelpers";

const RUN_API_URL = "/api/websites/website-1/actions/item-1/scripts/script-1/runs/script-run-1";

describe("useActionScriptRun", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("GETs the run with its step screenshots", async () => {
    const runDetail = buildActionScriptRunDetailRecord({ screenshots: [buildActionScriptRunScreenshotRecord()] });
    const fetchStub = stubFetchRoutes({ [`GET ${RUN_API_URL}`]: { status: 200, body: runDetail } });

    const { result } = renderHook(() => useActionScriptRun("website-1", "item-1", "script-1", "script-run-1"));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.data).toEqual(runDetail);
    expect(fetchStub).toHaveBeenCalledWith(RUN_API_URL);
  });

  it("reports the server's reason when the run is not found", async () => {
    stubFetchRoutes({ [`GET ${RUN_API_URL}`]: { status: 404, body: { error: "Script run not found" } } });

    const { result } = renderHook(() => useActionScriptRun("website-1", "item-1", "script-1", "script-run-1"));

    await waitFor(() => {
      expect(result.current.errorMessage).toBe("Script run not found");
    });
    expect(result.current.data).toBeNull();
  });
});
