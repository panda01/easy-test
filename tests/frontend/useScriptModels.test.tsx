import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useScriptModels } from "../../src/hooks/useScriptModels";
import { buildScriptModelCatalog, stubFetchRoutes } from "./support/frontendTestHelpers";

describe("useScriptModels", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("GETs the model catalog", async () => {
    const catalog = buildScriptModelCatalog();
    const fetchStub = stubFetchRoutes({ "GET /api/script-models": { status: 200, body: catalog } });

    const { result } = renderHook(() => useScriptModels());

    await waitFor(() => {
      expect(result.current.data).toEqual(catalog);
    });
    expect(fetchStub).toHaveBeenCalledWith("/api/script-models");
  });

  it("passes the server's reason through when the catalog cannot be read", async () => {
    stubFetchRoutes({
      "GET /api/script-models": { status: 503, body: { error: "ANTHROPIC_API_KEY is not set" } },
    });

    const { result } = renderHook(() => useScriptModels());

    await waitFor(() => {
      expect(result.current.errorMessage).toBe("ANTHROPIC_API_KEY is not set");
    });
    expect(result.current.data).toBeNull();
  });
});
