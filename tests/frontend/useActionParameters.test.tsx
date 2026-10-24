import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useActionParameters } from "../../src/hooks/useActionParameters";
import { useCreatedObjects } from "../../src/hooks/useCreatedObjects";
import {
  buildCreatedObjectRecord,
  buildVersionParameterRecord,
  buildVersionParametersRecord,
  countRequests,
  createDeferred,
  stubFetchRoutes,
} from "./support/frontendTestHelpers";

const PARAMETERS_API_URL = "/api/websites/website-1/actions/item-1/scripts/script-1/parameters";
const OTHER_PARAMETERS_API_URL = "/api/websites/website-1/actions/item-1/scripts/script-2/parameters";
const CREATED_OBJECTS_API_URL = "/api/websites/website-1/created-objects";

describe("useActionParameters", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("GETs the version's parameters, and reloads them keeping the shown view meanwhile", async () => {
    const firstView = buildVersionParametersRecord();
    const reloadedView = buildVersionParametersRecord({ parameters: [buildVersionParameterRecord()] });
    const reload = createDeferred<Response>();
    let requestCount = 0;
    const fetchStub = stubFetchRoutes({
      [`GET ${PARAMETERS_API_URL}`]: () => {
        requestCount += 1;
        return requestCount === 1
          ? Promise.resolve(new Response(JSON.stringify(firstView), { status: 200 }))
          : reload.promise;
      },
    });

    const { result } = renderHook(() => useActionParameters("website-1", "item-1", "script-1"));
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => {
      expect(result.current.view).toEqual(firstView);
    });

    act(() => {
      result.current.reloadParameters();
    });
    expect(result.current.view).toEqual(firstView);
    expect(result.current.isLoading).toBe(false);
    await act(async () => {
      reload.resolve(new Response(JSON.stringify(reloadedView), { status: 200 }));
      await reload.promise;
    });
    await waitFor(() => {
      expect(result.current.view).toEqual(reloadedView);
    });
    expect(countRequests(fetchStub, "GET", PARAMETERS_API_URL)).toBe(2);
  });

  it("shows a view a request answered with, and reports a failed fetch", async () => {
    stubFetchRoutes({ [`GET ${PARAMETERS_API_URL}`]: { status: 404, body: { error: "Script not found" } } });
    const { result } = renderHook(() => useActionParameters("website-1", "item-1", "script-1"));

    await waitFor(() => {
      expect(result.current.errorMessage).toBe("Script not found");
    });
    expect(result.current.view).toBeNull();

    const shownView = buildVersionParametersRecord({ warnings: ["Check this"] });
    act(() => {
      result.current.showParameters(shownView);
    });
    expect(result.current.view).toEqual(shownView);
    expect(result.current.errorMessage).toBeNull();
  });

  it("fetches nothing without a version, and ignores a stale answer after switching versions", async () => {
    const slowAnswer = createDeferred<Response>();
    const fetchStub = stubFetchRoutes({
      [`GET ${PARAMETERS_API_URL}`]: () => slowAnswer.promise,
      [`GET ${OTHER_PARAMETERS_API_URL}`]: { status: 200, body: buildVersionParametersRecord() },
    });
    const { result, rerender } = renderHook(
      ({ actionScriptId }: { actionScriptId: string | null }) =>
        useActionParameters("website-1", "item-1", actionScriptId),
      { initialProps: { actionScriptId: null as string | null } },
    );
    expect(result.current).toMatchObject({ view: null, isLoading: false, errorMessage: null });
    act(() => {
      result.current.showParameters(buildVersionParametersRecord());
    });
    expect(result.current.view).toBeNull();
    expect(fetchStub).not.toHaveBeenCalled();

    rerender({ actionScriptId: "script-1" });
    rerender({ actionScriptId: "script-2" });
    await waitFor(() => {
      expect(result.current.view).not.toBeNull();
    });
    await act(async () => {
      slowAnswer.resolve(new Response(JSON.stringify({ stale: true }), { status: 200 }));
      await slowAnswer.promise;
    });
    expect(result.current.view).toEqual(buildVersionParametersRecord());
  });

  it("ignores a failure that arrives after switching versions", async () => {
    const slowFailure = createDeferred<Response>();
    stubFetchRoutes({
      [`GET ${PARAMETERS_API_URL}`]: () => slowFailure.promise,
      [`GET ${OTHER_PARAMETERS_API_URL}`]: { status: 200, body: buildVersionParametersRecord() },
    });
    const { result, rerender } = renderHook(
      ({ actionScriptId }: { actionScriptId: string }) => useActionParameters("website-1", "item-1", actionScriptId),
      { initialProps: { actionScriptId: "script-1" } },
    );
    rerender({ actionScriptId: "script-2" });
    await waitFor(() => {
      expect(result.current.view).not.toBeNull();
    });
    await act(async () => {
      slowFailure.reject(new Error("network down"));
      await slowFailure.promise.catch(() => undefined);
    });
    expect(result.current.errorMessage).toBeNull();
  });
});

describe("useCreatedObjects", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("GETs the record, removes one, and fetches the record again", async () => {
    const createdObject = buildCreatedObjectRecord();
    const fetchStub = stubFetchRoutes({
      [`GET ${CREATED_OBJECTS_API_URL}`]: { status: 200, body: [createdObject] },
      [`DELETE ${CREATED_OBJECTS_API_URL}/created-object-1`]: { status: 204 },
    });
    const { result } = renderHook(() => useCreatedObjects("website-1"));
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => {
      expect(result.current.createdObjects).toEqual([createdObject]);
    });

    let removed = false;
    await act(async () => {
      removed = await result.current.removeCreatedObject("created-object-1");
    });
    expect(removed).toBe(true);
    await waitFor(() => {
      expect(countRequests(fetchStub, "GET", CREATED_OBJECTS_API_URL)).toBe(2);
    });
  });

  it("reports a failed fetch and a failed remove", async () => {
    stubFetchRoutes({
      [`GET ${CREATED_OBJECTS_API_URL}`]: { status: 500, body: { error: "Database is down" } },
      [`DELETE ${CREATED_OBJECTS_API_URL}/created-object-1`]: { status: 404, body: { error: "Created object not found" } },
    });
    const { result } = renderHook(() => useCreatedObjects("website-1"));
    await waitFor(() => {
      expect(result.current.errorMessage).toBe("Database is down");
    });
    expect(result.current.isLoading).toBe(false);

    let removed = true;
    await act(async () => {
      removed = await result.current.removeCreatedObject("created-object-1");
    });
    expect(removed).toBe(false);
    expect(result.current.removeErrorMessage).toBe("Created object not found");
  });

  it("ignores answers that arrive after unmounting", async () => {
    const slowAnswer = createDeferred<Response>();
    const slowFailure = createDeferred<Response>();
    let requestCount = 0;
    stubFetchRoutes({
      [`GET ${CREATED_OBJECTS_API_URL}`]: () => {
        requestCount += 1;
        return requestCount === 1 ? slowAnswer.promise : slowFailure.promise;
      },
    });
    const first = renderHook(() => useCreatedObjects("website-1"));
    first.unmount();
    const second = renderHook(() => useCreatedObjects("website-1"));
    second.unmount();
    await act(async () => {
      slowAnswer.resolve(new Response(JSON.stringify([]), { status: 200 }));
      slowFailure.reject(new Error("network down"));
      await slowAnswer.promise;
      await slowFailure.promise.catch(() => undefined);
    });
    expect(first.result.current.createdObjects).toBeNull();
    expect(second.result.current.errorMessage).toBeNull();
  });
});
