import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useWebObjectRenaming, useWebObjects } from "../../src/hooks/useWebObjects";
import { buildWebObjectRecord, stubFetchRoutes } from "./support/frontendTestHelpers";

const WEB_OBJECTS_API_URL = "/api/websites/website-1/web-objects";
const WEB_OBJECT_API_URL = `${WEB_OBJECTS_API_URL}/web-object-1`;

describe("useWebObjects", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("GETs the website's web objects", async () => {
    const webObject = buildWebObjectRecord();
    const fetchStub = stubFetchRoutes({ [`GET ${WEB_OBJECTS_API_URL}`]: { status: 200, body: [webObject] } });

    const { result } = renderHook(() => useWebObjects("website-1"));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current).toEqual({ data: [webObject], isLoading: false, errorMessage: null });
    expect(fetchStub).toHaveBeenCalledWith(WEB_OBJECTS_API_URL);
  });
});

describe("useWebObjectRenaming", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("PUTs the new name and remembers the name the server saved", async () => {
    const fetchStub = stubFetchRoutes({
      [`PUT ${WEB_OBJECT_API_URL}`]: { status: 200, body: buildWebObjectRecord({ name: "Site" }) },
    });
    const { result } = renderHook(() => useWebObjectRenaming("website-1"));
    expect(result.current.renamedNamesById.size).toBe(0);

    let renameWasSaved = false;
    await act(async () => {
      renameWasSaved = await result.current.renameWebObject("web-object-1", "Site");
    });

    expect(renameWasSaved).toBe(true);
    expect(result.current.renamedNamesById.get("web-object-1")).toBe("Site");
    expect(fetchStub).toHaveBeenCalledWith(WEB_OBJECT_API_URL, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Site" }),
    });
  });

  it("remembers a reset to the detected name as null", async () => {
    stubFetchRoutes({ [`PUT ${WEB_OBJECT_API_URL}`]: { status: 200, body: buildWebObjectRecord({ name: null }) } });
    const { result } = renderHook(() => useWebObjectRenaming("website-1"));

    await act(async () => {
      await result.current.renameWebObject("web-object-1", null);
    });

    expect(result.current.renamedNamesById.has("web-object-1")).toBe(true);
    expect(result.current.renamedNamesById.get("web-object-1")).toBeNull();
  });

  it("reports the server's reason and remembers nothing when the rename fails", async () => {
    stubFetchRoutes({
      [`PUT ${WEB_OBJECT_API_URL}`]: { status: 404, body: { error: "Web object not found" } },
    });
    const { result } = renderHook(() => useWebObjectRenaming("website-1"));

    let renameWasSaved = true;
    await act(async () => {
      renameWasSaved = await result.current.renameWebObject("web-object-1", "Site");
    });

    expect(renameWasSaved).toBe(false);
    expect(result.current.renameErrorMessage).toBe("Web object not found");
    expect(result.current.renamedNamesById.size).toBe(0);
    expect(result.current.isRenaming).toBe(false);
  });
});
