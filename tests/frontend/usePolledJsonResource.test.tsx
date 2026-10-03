import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { usePolledJsonResource } from "../../src/hooks/usePolledJsonResource";
import {
  buildJsonResponse,
  countRequests,
  createDeferred,
  createRejectedFetch,
  stubFetchRoutes,
  type StubbedRouteReply,
} from "./support/frontendTestHelpers";

const RUN_URL = "/api/websites/website-1/crawl-runs/crawl-run-1";
const OTHER_RUN_URL = "/api/websites/website-1/crawl-runs/crawl-run-2";
const POLL_INTERVAL_MS = 2000;

/** A response body shaped like a crawl run: `status` decides whether to keep polling. */
interface PolledBody {
  status: string;
  visitedPageCount: number;
}

/**
 * Keeps polling while the body says "running" - the same rule the crawl run
 * page uses.
 * @param data - The latest response body
 * @returns True while the status is "running"
 */
function keepPollingWhileRunning(data: unknown): boolean {
  return (data as PolledBody).status === "running";
}

/**
 * Builds a route reply that answers each GET with the next reply in the
 * list, repeating the last one once the list runs out.
 * @param replies - One reply per poll, in order
 * @returns The stubbed route reply
 */
function replyInTurn(replies: (() => Promise<Response>)[]): StubbedRouteReply {
  let replyIndex = 0;
  return () => {
    const reply = replies[Math.min(replyIndex, replies.length - 1)];
    replyIndex += 1;
    return reply();
  };
}

/**
 * Builds one poll's successful reply.
 * @param body - The body the GET answers with
 * @returns A function resolving a 200 JSON response
 */
function okReply(body: PolledBody): () => Promise<Response> {
  return () => Promise.resolve(buildJsonResponse(200, body));
}

/**
 * Lets pending fetches and state updates settle without moving the clock.
 * @returns Resolves once they have settled
 */
async function settle(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

/**
 * Moves the fake clock forward and lets whatever it triggered settle.
 * @param milliseconds - How far to move the clock
 * @returns Resolves once the triggered work has settled
 */
async function advanceClock(milliseconds: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

describe("usePolledJsonResource", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stays idle for a null url: no request, not loading, no data", async () => {
    const fetchStub = stubFetchRoutes({});

    const { result } = renderHook(() =>
      usePolledJsonResource(null, keepPollingWhileRunning, POLL_INTERVAL_MS),
    );
    await advanceClock(POLL_INTERVAL_MS * 3);

    expect(result.current).toEqual({
      data: null,
      isLoading: false,
      errorMessage: null,
      pollErrorMessage: null,
    });
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("loads, re-polls every interval while asked to, replaces the data in place, and stops once told", async () => {
    const fetchStub = stubFetchRoutes({
      [`GET ${RUN_URL}`]: replyInTurn([
        okReply({ status: "running", visitedPageCount: 1 }),
        okReply({ status: "running", visitedPageCount: 2 }),
        okReply({ status: "finished", visitedPageCount: 3 }),
      ]),
    });

    const { result } = renderHook(() =>
      usePolledJsonResource(RUN_URL, keepPollingWhileRunning, POLL_INTERVAL_MS),
    );
    expect(result.current.isLoading).toBe(true);
    await settle();
    expect(result.current).toEqual({
      data: { status: "running", visitedPageCount: 1 },
      isLoading: false,
      errorMessage: null,
      pollErrorMessage: null,
    });

    await advanceClock(POLL_INTERVAL_MS - 1);
    expect(countRequests(fetchStub, "GET", RUN_URL)).toBe(1);
    await advanceClock(1);
    expect(countRequests(fetchStub, "GET", RUN_URL)).toBe(2);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toEqual({ status: "running", visitedPageCount: 2 });

    await advanceClock(POLL_INTERVAL_MS);
    expect(result.current.data).toEqual({ status: "finished", visitedPageCount: 3 });

    await advanceClock(POLL_INTERVAL_MS * 5);
    expect(countRequests(fetchStub, "GET", RUN_URL)).toBe(3);
  });

  it("does not poll again when the first response already says to stop", async () => {
    const fetchStub = stubFetchRoutes({
      [`GET ${RUN_URL}`]: { status: 200, body: { status: "finished", visitedPageCount: 9 } },
    });

    renderHook(() => usePolledJsonResource(RUN_URL, keepPollingWhileRunning, POLL_INTERVAL_MS));
    await settle();
    await advanceClock(POLL_INTERVAL_MS * 5);

    expect(countRequests(fetchStub, "GET", RUN_URL)).toBe(1);
  });

  it("keeps the last good data through a failed re-poll, says why, and keeps polling until one succeeds", async () => {
    stubFetchRoutes({
      [`GET ${RUN_URL}`]: replyInTurn([
        okReply({ status: "running", visitedPageCount: 1 }),
        () => Promise.resolve(buildJsonResponse(502, { error: "Bad gateway" })),
        () => createRejectedFetch(new Error("Failed to fetch")),
        okReply({ status: "interrupted", visitedPageCount: 1 }),
      ]),
    });

    const { result } = renderHook(() =>
      usePolledJsonResource(RUN_URL, keepPollingWhileRunning, POLL_INTERVAL_MS),
    );
    await settle();

    await advanceClock(POLL_INTERVAL_MS);
    expect(result.current).toEqual({
      data: { status: "running", visitedPageCount: 1 },
      isLoading: false,
      errorMessage: null,
      pollErrorMessage: "Bad gateway",
    });

    await advanceClock(POLL_INTERVAL_MS);
    expect(result.current.pollErrorMessage).toBe("Failed to fetch");
    expect(result.current.data).toEqual({ status: "running", visitedPageCount: 1 });

    await advanceClock(POLL_INTERVAL_MS);
    expect(result.current).toEqual({
      data: { status: "interrupted", visitedPageCount: 1 },
      isLoading: false,
      errorMessage: null,
      pollErrorMessage: null,
    });
  });

  it("reports a failed first load as errorMessage and does not poll", async () => {
    const fetchStub = stubFetchRoutes({
      [`GET ${RUN_URL}`]: { status: 404, body: { error: "Crawl run not found" } },
    });

    const { result } = renderHook(() =>
      usePolledJsonResource(RUN_URL, keepPollingWhileRunning, POLL_INTERVAL_MS),
    );
    await settle();
    await advanceClock(POLL_INTERVAL_MS * 3);

    expect(result.current).toEqual({
      data: null,
      isLoading: false,
      errorMessage: "Crawl run not found",
      pollErrorMessage: null,
    });
    expect(countRequests(fetchStub, "GET", RUN_URL)).toBe(1);
  });

  it("stops polling once unmounted", async () => {
    const fetchStub = stubFetchRoutes({
      [`GET ${RUN_URL}`]: { status: 200, body: { status: "running", visitedPageCount: 1 } },
    });

    const { unmount } = renderHook(() =>
      usePolledJsonResource(RUN_URL, keepPollingWhileRunning, POLL_INTERVAL_MS),
    );
    await settle();
    unmount();
    await advanceClock(POLL_INTERVAL_MS * 3);

    expect(countRequests(fetchStub, "GET", RUN_URL)).toBe(1);
  });

  it("reports loading for a new url, ignoring the old url's late answer, and polls only the new url", async () => {
    const pendingOldRun = createDeferred<Response>();
    const fetchStub = stubFetchRoutes({
      [`GET ${RUN_URL}`]: () => pendingOldRun.promise,
      [`GET ${OTHER_RUN_URL}`]: { status: 200, body: { status: "finished", visitedPageCount: 4 } },
    });

    const { result, rerender } = renderHook(
      ({ resourceUrl }: { resourceUrl: string }) =>
        usePolledJsonResource(resourceUrl, keepPollingWhileRunning, POLL_INTERVAL_MS),
      { initialProps: { resourceUrl: RUN_URL } },
    );
    rerender({ resourceUrl: OTHER_RUN_URL });
    await act(async () => {
      pendingOldRun.resolve(buildJsonResponse(200, { status: "running", visitedPageCount: 1 }));
      await pendingOldRun.promise;
    });
    await settle();

    expect(result.current.data).toEqual({ status: "finished", visitedPageCount: 4 });
    await advanceClock(POLL_INTERVAL_MS * 3);
    expect(countRequests(fetchStub, "GET", RUN_URL)).toBe(1);
    expect(countRequests(fetchStub, "GET", OTHER_RUN_URL)).toBe(1);
  });

  it("ignores a failure that lands after the url changed", async () => {
    const pendingOldRun = createDeferred<Response>();
    stubFetchRoutes({
      [`GET ${RUN_URL}`]: () => pendingOldRun.promise,
      [`GET ${OTHER_RUN_URL}`]: () => new Promise<Response>(() => undefined),
    });

    const { result, rerender } = renderHook(
      ({ resourceUrl }: { resourceUrl: string }) =>
        usePolledJsonResource(resourceUrl, keepPollingWhileRunning, POLL_INTERVAL_MS),
      { initialProps: { resourceUrl: RUN_URL } },
    );
    rerender({ resourceUrl: OTHER_RUN_URL });
    await act(async () => {
      pendingOldRun.reject(new Error("Failed to fetch"));
      await pendingOldRun.promise.catch(() => undefined);
    });

    expect(result.current).toEqual({
      data: null,
      isLoading: true,
      errorMessage: null,
      pollErrorMessage: null,
    });
  });
});
