import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useWebsite, useWebsites } from "../../src/hooks/useWebsites";
import { buildWebsiteRecord, stubFetchRoutes } from "./support/frontendTestHelpers";

describe("useWebsites", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("GETs /api/websites and returns the website list", async () => {
    const websites = [buildWebsiteRecord(), buildWebsiteRecord({ id: "website-2", name: "Other" })];
    const fetchStub = stubFetchRoutes({ "GET /api/websites": { status: 200, body: websites } });

    const { result } = renderHook(() => useWebsites());

    await waitFor(() => {
      expect(result.current.data).toEqual(websites);
    });
    expect(fetchStub).toHaveBeenCalledWith("/api/websites");
  });
});

describe("useWebsite", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("GETs one website by its encoded id", async () => {
    const website = buildWebsiteRecord({ id: "a/b" });
    const fetchStub = stubFetchRoutes({ "GET /api/websites/a%2Fb": { status: 200, body: website } });

    const { result } = renderHook(() => useWebsite("a/b"));

    await waitFor(() => {
      expect(result.current.data).toEqual(website);
    });
    expect(fetchStub).toHaveBeenCalledWith("/api/websites/a%2Fb");
  });

  it("reports the server's not-found text for an unknown website", async () => {
    stubFetchRoutes({
      "GET /api/websites/missing": { status: 404, body: { error: "Website not found" } },
    });

    const { result } = renderHook(() => useWebsite("missing"));

    await waitFor(() => {
      expect(result.current.errorMessage).toBe("Website not found");
    });
    expect(result.current.data).toBeNull();
  });
});
