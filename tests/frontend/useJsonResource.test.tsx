import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useJsonResource } from "../../src/hooks/useJsonResource";
import {
  buildJsonResponse,
  buildUnparseableResponse,
  createDeferred,
  createRejectedFetch,
  stubFetchRoutes,
} from "./support/frontendTestHelpers";

describe("useJsonResource", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("reports loading, then the parsed body, for a successful GET", async () => {
    const fetchStub = stubFetchRoutes({
      "GET /api/websites": { status: 200, body: [{ id: "website-1" }] },
    });

    const { result } = renderHook(() => useJsonResource("/api/websites"));
    expect(result.current).toEqual({ data: null, isLoading: true, errorMessage: null });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current).toEqual({
      data: [{ id: "website-1" }],
      isLoading: false,
      errorMessage: null,
    });
    expect(fetchStub).toHaveBeenCalledWith("/api/websites");
  });

  it("reports the server's { error } text for a non-2xx response", async () => {
    stubFetchRoutes({
      "GET /api/websites/missing": { status: 404, body: { error: "Website not found" } },
    });

    const { result } = renderHook(() => useJsonResource("/api/websites/missing"));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current).toEqual({
      data: null,
      isLoading: false,
      errorMessage: "Website not found",
    });
  });

  it("falls back to the status for a non-2xx response without a JSON { error } body", async () => {
    stubFetchRoutes({
      "GET /api/websites": () => Promise.resolve(buildUnparseableResponse(502)),
    });

    const { result } = renderHook(() => useJsonResource("/api/websites"));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.errorMessage).toBe("Server responded with 502");
    expect(result.current.data).toBeNull();
  });

  it("reports a rejected fetch's Error message", async () => {
    stubFetchRoutes({
      "GET /api/websites": () => createRejectedFetch(new Error("Failed to fetch")),
    });

    const { result } = renderHook(() => useJsonResource("/api/websites"));

    await waitFor(() => {
      expect(result.current.errorMessage).toBe("Failed to fetch");
    });
    expect(result.current.isLoading).toBe(false);
  });

  it("stringifies a non-Error rejection", async () => {
    stubFetchRoutes({
      "GET /api/websites": () => createRejectedFetch("socket hang up"),
    });

    const { result } = renderHook(() => useJsonResource("/api/websites"));

    await waitFor(() => {
      expect(result.current.errorMessage).toBe("socket hang up");
    });
  });

  it("reports loading again the moment the url changes, then the new url's data", async () => {
    const secondResponse = createDeferred<Response>();
    stubFetchRoutes({
      "GET /api/websites/website-1": { status: 200, body: { id: "website-1" } },
      "GET /api/websites/website-2": () => secondResponse.promise,
    });

    const { result, rerender } = renderHook(
      ({ resourceUrl }: { resourceUrl: string }) => useJsonResource(resourceUrl),
      { initialProps: { resourceUrl: "/api/websites/website-1" } },
    );
    await waitFor(() => {
      expect(result.current.data).toEqual({ id: "website-1" });
    });

    rerender({ resourceUrl: "/api/websites/website-2" });
    expect(result.current).toEqual({ data: null, isLoading: true, errorMessage: null });

    await act(async () => {
      secondResponse.resolve(buildJsonResponse(200, { id: "website-2" }));
      await secondResponse.promise;
    });
    expect(result.current).toEqual({
      data: { id: "website-2" },
      isLoading: false,
      errorMessage: null,
    });
  });

  it("ignores a response for the previous url that lands after the url changed", async () => {
    const staleResponse = createDeferred<Response>();
    stubFetchRoutes({
      "GET /api/websites/website-1": () => staleResponse.promise,
      "GET /api/websites/website-2": { status: 200, body: { id: "website-2" } },
    });

    const { result, rerender } = renderHook(
      ({ resourceUrl }: { resourceUrl: string }) => useJsonResource(resourceUrl),
      { initialProps: { resourceUrl: "/api/websites/website-1" } },
    );
    rerender({ resourceUrl: "/api/websites/website-2" });
    await waitFor(() => {
      expect(result.current.data).toEqual({ id: "website-2" });
    });

    await act(async () => {
      staleResponse.resolve(buildJsonResponse(200, { id: "website-1" }));
      await staleResponse.promise;
    });

    // Had the stale result been stored, the hook would report loading (its url
    // no longer matches) instead of keeping website-2's data.
    expect(result.current).toEqual({
      data: { id: "website-2" },
      isLoading: false,
      errorMessage: null,
    });
  });

  it("ignores a response that lands after unmount", async () => {
    const lateResponse = createDeferred<Response>();
    stubFetchRoutes({ "GET /api/websites": () => lateResponse.promise });
    const consoleErrorSpy = vi.spyOn(console, "error");

    const { result, unmount } = renderHook(() => useJsonResource("/api/websites"));
    unmount();
    await act(async () => {
      lateResponse.resolve(buildJsonResponse(200, [{ id: "website-1" }]));
      await lateResponse.promise;
    });

    expect(result.current).toEqual({ data: null, isLoading: true, errorMessage: null });
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("ignores a rejection that lands after unmount", async () => {
    const lateResponse = createDeferred<Response>();
    stubFetchRoutes({ "GET /api/websites": () => lateResponse.promise });
    const consoleErrorSpy = vi.spyOn(console, "error");

    const { result, unmount } = renderHook(() => useJsonResource("/api/websites"));
    unmount();
    await act(async () => {
      lateResponse.reject(new Error("late failure"));
      await lateResponse.promise.catch(() => undefined);
    });

    expect(result.current).toEqual({ data: null, isLoading: true, errorMessage: null });
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("stays idle for a null url: no request, not loading, no data, no error", () => {
    const fetchStub = stubFetchRoutes({});

    const { result } = renderHook(() => useJsonResource(null));

    expect(result.current).toEqual({ data: null, isLoading: false, errorMessage: null });
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("starts fetching when a null url becomes a real one, and goes idle again when it returns to null", async () => {
    const fetchStub = stubFetchRoutes({
      "GET /api/websites": { status: 200, body: [{ id: "website-1" }] },
    });
    const { result, rerender } = renderHook(
      ({ resourceUrl }: { resourceUrl: string | null }) => useJsonResource(resourceUrl),
      { initialProps: { resourceUrl: null as string | null } },
    );

    rerender({ resourceUrl: "/api/websites" });
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => {
      expect(result.current.data).toEqual([{ id: "website-1" }]);
    });

    rerender({ resourceUrl: null });
    expect(result.current).toEqual({ data: null, isLoading: false, errorMessage: null });
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });
});
