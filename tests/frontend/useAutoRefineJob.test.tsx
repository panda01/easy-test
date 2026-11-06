import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  AUTO_REFINE_POLL_INTERVAL_MS,
  useAutoRefineJob,
} from "../../src/hooks/useAutoRefineJob";
import {
  buildAutoRefineJobRecord,
  buildJsonResponse,
  countRequests,
  createRejectedFetch,
  stubFetchRoutes,
  type StubbedRouteReply,
} from "./support/frontendTestHelpers";

const JOB_LIST_URL = "/api/websites/website-1/actions/item-1/auto-refine-jobs";
const JOB_URL = `${JOB_LIST_URL}/auto-refine-job-1`;
const OTHER_JOB_URL = `${JOB_LIST_URL}/auto-refine-job-2`;

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
function okReply(body: unknown): () => Promise<Response> {
  return () => Promise.resolve(buildJsonResponse(200, body));
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

describe("useAutoRefineJob", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("finds the running job in the action's list, polls it every 2 seconds, and stops once it has ended", async () => {
    const endedJob = buildAutoRefineJobRecord({ id: "auto-refine-job-0", status: "passed", phase: null, finishedAt: "2026-04-05T03:05:05.000Z" });
    const runningJob = buildAutoRefineJobRecord({ refinementsDone: 1, createdActionScriptIds: ["script-2"] });
    const refiningJob = buildAutoRefineJobRecord({ ...runningJob, phase: "refining", actionScriptRunIds: ["run-2"] });
    const passedJob = buildAutoRefineJobRecord({
      ...refiningJob,
      status: "passed",
      phase: null,
      finishedAt: "2026-04-05T03:09:05.000Z",
    });
    const fetchStub = stubFetchRoutes({
      [`GET ${JOB_LIST_URL}`]: { status: 200, body: [runningJob, endedJob] },
      [`GET ${JOB_URL}`]: replyInTurn([okReply(runningJob), okReply(refiningJob), okReply(passedJob)]),
    });

    const { result } = renderHook(() => useAutoRefineJob("website-1", "item-1"));
    expect(result.current.job).toBeNull();
    await advanceClock(0);
    expect(result.current.job).toEqual(runningJob);
    expect(countRequests(fetchStub, "GET", JOB_LIST_URL)).toBe(1);
    expect(countRequests(fetchStub, "GET", JOB_URL)).toBe(1);

    await advanceClock(AUTO_REFINE_POLL_INTERVAL_MS);
    expect(result.current.job).toEqual(refiningJob);
    await advanceClock(AUTO_REFINE_POLL_INTERVAL_MS);
    expect(result.current.job).toEqual(passedJob);

    await advanceClock(AUTO_REFINE_POLL_INTERVAL_MS * 5);
    expect(countRequests(fetchStub, "GET", JOB_URL)).toBe(3);
    expect(countRequests(fetchStub, "GET", JOB_LIST_URL)).toBe(1);
    expect(result.current.pollErrorMessage).toBeNull();
    expect(AUTO_REFINE_POLL_INTERVAL_MS).toBe(2000);
  });

  it("watches nothing when no listed job is running", async () => {
    const endedJob = buildAutoRefineJobRecord({ status: "stopped", phase: null });
    const fetchStub = stubFetchRoutes({
      [`GET ${JOB_LIST_URL}`]: { status: 200, body: [endedJob] },
    });

    const { result } = renderHook(() => useAutoRefineJob("website-1", "item-1"));
    await advanceClock(AUTO_REFINE_POLL_INTERVAL_MS * 3);

    expect(result.current.job).toBeNull();
    expect(result.current.pollErrorMessage).toBeNull();
    expect(countRequests(fetchStub, "GET", JOB_URL)).toBe(0);
  });

  it("watchJob shows the handed-in record at once, then polls that job instead", async () => {
    const startedJob = buildAutoRefineJobRecord({ id: "auto-refine-job-2", startActionScriptId: "script-3", currentActionScriptId: "script-3" });
    const startedJobLater = buildAutoRefineJobRecord({ ...startedJob, phase: "refining", actionScriptRunIds: ["run-9"] });
    const fetchStub = stubFetchRoutes({
      [`GET ${JOB_LIST_URL}`]: { status: 200, body: [] },
      [`GET ${OTHER_JOB_URL}`]: replyInTurn([okReply(startedJob), okReply(startedJobLater)]),
    });

    const { result } = renderHook(() => useAutoRefineJob("website-1", "item-1"));
    await advanceClock(0);
    expect(result.current.job).toBeNull();

    act(() => {
      result.current.watchJob(startedJob);
    });
    // Shown before any poll has answered.
    expect(result.current.job).toEqual(startedJob);
    expect(result.current.pollErrorMessage).toBeNull();

    await advanceClock(0);
    expect(countRequests(fetchStub, "GET", OTHER_JOB_URL)).toBe(1);
    await advanceClock(AUTO_REFINE_POLL_INTERVAL_MS);
    expect(result.current.job).toEqual(startedJobLater);
    expect(countRequests(fetchStub, "GET", OTHER_JOB_URL)).toBe(2);
    expect(countRequests(fetchStub, "GET", JOB_URL)).toBe(0);
  });

  it("watchJob shows a newer record of the job already watched (the stop reply) until the next poll", async () => {
    const runningJob = buildAutoRefineJobRecord({ updatedAt: "2026-04-05T03:04:05.000Z" });
    const stopRequestedJob = buildAutoRefineJobRecord({
      ...runningJob,
      stopRequestedAt: "2026-04-05T03:04:30.000Z",
      updatedAt: "2026-04-05T03:04:30.000Z",
    });
    const stoppedJob = buildAutoRefineJobRecord({
      ...stopRequestedJob,
      status: "stopped",
      phase: null,
      updatedAt: "2026-04-05T03:04:40.000Z",
      finishedAt: "2026-04-05T03:04:40.000Z",
    });
    stubFetchRoutes({
      [`GET ${JOB_LIST_URL}`]: { status: 200, body: [runningJob] },
      [`GET ${JOB_URL}`]: replyInTurn([okReply(runningJob), okReply(stoppedJob)]),
    });

    const { result } = renderHook(() => useAutoRefineJob("website-1", "item-1"));
    await advanceClock(0);
    expect(result.current.job).toEqual(runningJob);

    act(() => {
      result.current.watchJob(stopRequestedJob);
    });
    expect(result.current.job).toEqual(stopRequestedJob);

    await advanceClock(AUTO_REFINE_POLL_INTERVAL_MS);
    expect(result.current.job).toEqual(stoppedJob);
  });

  it("watchJob switches from the listed job to the new one", async () => {
    const listedJob = buildAutoRefineJobRecord({ status: "stopped", phase: null });
    const newJob = buildAutoRefineJobRecord({ id: "auto-refine-job-2" });
    const fetchStub = stubFetchRoutes({
      [`GET ${JOB_LIST_URL}`]: { status: 200, body: [buildAutoRefineJobRecord()] },
      [`GET ${JOB_URL}`]: { status: 200, body: listedJob },
      [`GET ${OTHER_JOB_URL}`]: { status: 200, body: newJob },
    });

    const { result } = renderHook(() => useAutoRefineJob("website-1", "item-1"));
    await advanceClock(0);
    expect(result.current.job).toEqual(listedJob);

    act(() => {
      result.current.watchJob(newJob);
    });
    expect(result.current.job).toEqual(newJob);
    await advanceClock(0);
    await advanceClock(AUTO_REFINE_POLL_INTERVAL_MS);
    await advanceClock(AUTO_REFINE_POLL_INTERVAL_MS);

    expect(countRequests(fetchStub, "GET", OTHER_JOB_URL)).toBe(3);
    expect(countRequests(fetchStub, "GET", JOB_URL)).toBe(1);
  });

  it("keeps the last record through a failed poll, says why, and keeps polling", async () => {
    const runningJob = buildAutoRefineJobRecord();
    const stoppedJob = buildAutoRefineJobRecord({ status: "stopped", phase: null });
    stubFetchRoutes({
      [`GET ${JOB_LIST_URL}`]: { status: 200, body: [runningJob] },
      [`GET ${JOB_URL}`]: replyInTurn([
        okReply(runningJob),
        () => Promise.resolve(buildJsonResponse(502, { error: "Bad gateway" })),
        () => createRejectedFetch(new Error("Failed to fetch")),
        okReply(stoppedJob),
      ]),
    });

    const { result } = renderHook(() => useAutoRefineJob("website-1", "item-1"));
    await advanceClock(0);

    await advanceClock(AUTO_REFINE_POLL_INTERVAL_MS);
    expect(result.current.job).toEqual(runningJob);
    expect(result.current.pollErrorMessage).toBe("Bad gateway");

    await advanceClock(AUTO_REFINE_POLL_INTERVAL_MS);
    expect(result.current.pollErrorMessage).toBe("Failed to fetch");

    await advanceClock(AUTO_REFINE_POLL_INTERVAL_MS);
    expect(result.current.job).toEqual(stoppedJob);
    expect(result.current.pollErrorMessage).toBeNull();
  });

  it("reports a failed first fetch of a watched job while still showing the handed-in record", async () => {
    const startedJob = buildAutoRefineJobRecord({ id: "auto-refine-job-2" });
    stubFetchRoutes({
      [`GET ${JOB_LIST_URL}`]: { status: 200, body: [] },
      [`GET ${OTHER_JOB_URL}`]: { status: 404, body: { error: "Auto-refine job not found" } },
    });

    const { result } = renderHook(() => useAutoRefineJob("website-1", "item-1"));
    await advanceClock(0);
    act(() => {
      result.current.watchJob(startedJob);
    });
    await advanceClock(0);

    expect(result.current.job).toEqual(startedJob);
    expect(result.current.pollErrorMessage).toBe("Auto-refine job not found");
  });

  it("ignores a job watched for another action", async () => {
    const otherActionJob = buildAutoRefineJobRecord({ id: "auto-refine-job-2", actionId: "item-2" });
    const fetchStub = stubFetchRoutes({
      [`GET ${JOB_LIST_URL}`]: { status: 200, body: [] },
    });

    const { result } = renderHook(() => useAutoRefineJob("website-1", "item-1"));
    await advanceClock(0);
    act(() => {
      result.current.watchJob(otherActionJob);
    });
    await advanceClock(AUTO_REFINE_POLL_INTERVAL_MS);

    expect(result.current.job).toBeNull();
    expect(countRequests(fetchStub, "GET", OTHER_JOB_URL)).toBe(0);
  });
});
