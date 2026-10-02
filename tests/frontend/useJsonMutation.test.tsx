import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { type MutationResult, useJsonMutation } from "../../src/hooks/useJsonMutation";
import {
  buildJsonResponse,
  buildUnparseableResponse,
  createDeferred,
  createRejectedFetch,
  stubFetchRoutes,
} from "./support/frontendTestHelpers";

describe("useJsonMutation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("starts idle, with no error", () => {
    stubFetchRoutes({});
    const { result } = renderHook(() => useJsonMutation());
    expect(result.current.isSubmitting).toBe(false);
    expect(result.current.errorMessage).toBeNull();
  });

  it("POSTs a JSON body with a Content-Type header and returns the parsed response", async () => {
    const fetchStub = stubFetchRoutes({
      "POST /api/websites": { status: 201, body: { id: "website-1", name: "Example" } },
    });
    const { result } = renderHook(() => useJsonMutation());

    let mutationResult: MutationResult | undefined;
    await act(async () => {
      mutationResult = await result.current.sendJsonRequest("POST", "/api/websites", {
        url: "https://example.com",
        name: "Example",
        description: "",
      });
    });

    expect(fetchStub).toHaveBeenCalledWith("/api/websites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com", name: "Example", description: "" }),
    });
    expect(mutationResult).toEqual({
      succeeded: true,
      data: { id: "website-1", name: "Example" },
    });
    expect(result.current.errorMessage).toBeNull();
  });

  it("PUTs a JSON body to the given url", async () => {
    const fetchStub = stubFetchRoutes({
      "PUT /api/websites/website-1": { status: 200, body: { id: "website-1" } },
    });
    const { result } = renderHook(() => useJsonMutation());

    await act(async () => {
      await result.current.sendJsonRequest("PUT", "/api/websites/website-1", { name: "Renamed" });
    });

    expect(fetchStub).toHaveBeenCalledWith("/api/websites/website-1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Renamed" }),
    });
  });

  it("sends a DELETE with no body or headers, and reports a 204 as data null without parsing it", async () => {
    const readJsonBody = vi.fn<() => Promise<unknown>>();
    const noContentResponse = { ok: true, status: 204, json: readJsonBody } as unknown as Response;
    const fetchStub = stubFetchRoutes({
      "DELETE /api/websites/website-1": () => Promise.resolve(noContentResponse),
    });
    const { result } = renderHook(() => useJsonMutation());

    let mutationResult: MutationResult | undefined;
    await act(async () => {
      mutationResult = await result.current.sendJsonRequest("DELETE", "/api/websites/website-1");
    });

    expect(fetchStub).toHaveBeenCalledWith("/api/websites/website-1", { method: "DELETE" });
    expect(mutationResult).toEqual({ succeeded: true, data: null });
    expect(readJsonBody).not.toHaveBeenCalled();
  });

  it("reports the server's { error } text for a non-2xx response", async () => {
    stubFetchRoutes({
      "POST /api/websites": { status: 409, body: { error: "A website with that URL already exists" } },
    });
    const { result } = renderHook(() => useJsonMutation());

    let mutationResult: MutationResult | undefined;
    await act(async () => {
      mutationResult = await result.current.sendJsonRequest("POST", "/api/websites", {});
    });

    expect(mutationResult).toEqual({ succeeded: false, data: null });
    expect(result.current.errorMessage).toBe("A website with that URL already exists");
    expect(result.current.isSubmitting).toBe(false);
  });

  it("falls back to the status for a non-2xx response that is not JSON", async () => {
    stubFetchRoutes({
      "DELETE /api/websites/website-1": () => Promise.resolve(buildUnparseableResponse(500)),
    });
    const { result } = renderHook(() => useJsonMutation());

    await act(async () => {
      await result.current.sendJsonRequest("DELETE", "/api/websites/website-1");
    });

    expect(result.current.errorMessage).toBe("Server responded with 500");
  });

  it("reports a network rejection's Error message", async () => {
    stubFetchRoutes({
      "POST /api/websites": () => createRejectedFetch(new Error("Failed to fetch")),
    });
    const { result } = renderHook(() => useJsonMutation());

    let mutationResult: MutationResult | undefined;
    await act(async () => {
      mutationResult = await result.current.sendJsonRequest("POST", "/api/websites", {});
    });

    expect(mutationResult).toEqual({ succeeded: false, data: null });
    expect(result.current.errorMessage).toBe("Failed to fetch");
    expect(result.current.isSubmitting).toBe(false);
  });

  it("stringifies a non-Error rejection", async () => {
    stubFetchRoutes({
      "POST /api/websites": () => createRejectedFetch("socket hang up"),
    });
    const { result } = renderHook(() => useJsonMutation());

    await act(async () => {
      await result.current.sendJsonRequest("POST", "/api/websites", {});
    });

    expect(result.current.errorMessage).toBe("socket hang up");
  });

  it("reports isSubmitting while the request is in flight, and clears the previous error", async () => {
    const pendingResponse = createDeferred<Response>();
    const routeTable: Record<string, () => Promise<Response>> = {
      "POST /api/websites": () => createRejectedFetch(new Error("first attempt failed")),
    };
    stubFetchRoutes(routeTable);
    const { result } = renderHook(() => useJsonMutation());

    await act(async () => {
      await result.current.sendJsonRequest("POST", "/api/websites", {});
    });
    expect(result.current.errorMessage).toBe("first attempt failed");

    routeTable["POST /api/websites"] = () => pendingResponse.promise;
    let inFlightRequest: Promise<MutationResult> = Promise.resolve({ succeeded: false, data: null });
    act(() => {
      inFlightRequest = result.current.sendJsonRequest("POST", "/api/websites", {});
    });
    expect(result.current.isSubmitting).toBe(true);
    expect(result.current.errorMessage).toBeNull();

    await act(async () => {
      pendingResponse.resolve(buildJsonResponse(201, { id: "website-1" }));
      await inFlightRequest;
    });
    expect(result.current.isSubmitting).toBe(false);
    expect(result.current.errorMessage).toBeNull();
  });
});
