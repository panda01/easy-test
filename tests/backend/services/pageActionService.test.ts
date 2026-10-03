import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Page } from "playwright";
import {
  ACTION_REQUESTS_POLL_INTERVAL_MS,
  ACTION_REQUESTS_QUIET_WINDOW_MS,
  trackPageRequests,
  waitForTrackedRequestsToFinish,
  waitOutMinimumWaitSince,
} from "../../../server/services/pageActionService.js";

/**
 * No test here launches a browser. The page is a FAKE PAGE (see
 * `buildFakePage`) carrying only what the helpers call: `on` and `off` for
 * the request events (fired by `emitPageEvent`, like Playwright does), and a
 * `waitForTimeout` that resolves at once, records how long it was asked to
 * wait, and lets a test act on the page at each check (see `onEachWait`).
 */

/** The fake page's request event listeners, by event name. */
let pageListeners = new Map<string, Set<() => void>>();

/** Every `waitForTimeout` the helpers asked for, in milliseconds, in order. */
let waitedTimeouts: number[] = [];

/** When set, `waitForTimeout` rejects with this (the page closed). */
let waitForTimeoutError: Error | null = null;

/**
 * Runs during each `waitForTimeout`, with the check's number counting from 1
 * - a test uses it to start or finish requests while the helper waits.
 */
let onEachWait: (checkNumber: number) => void = () => undefined;

/**
 * Fires one of the fake page's events at every listener, like Playwright
 * does when a request starts, finishes, or fails.
 * @param eventName - "request", "requestfinished", or "requestfailed"
 * @param times - How many times to fire it
 */
function emitPageEvent(eventName: string, times = 1): void {
  for (let eventIndex = 0; eventIndex < times; eventIndex += 1) {
    for (const listener of pageListeners.get(eventName) ?? []) {
      listener();
    }
  }
}

/**
 * Counts every listener still attached to the fake page.
 * @returns How many listeners are attached
 */
function countPageListeners(): number {
  return [...pageListeners.values()].reduce((total, listeners) => total + listeners.size, 0);
}

/**
 * Counts the 100 ms checks the request wait made.
 * @returns How many `waitForTimeout` calls asked for the poll interval
 */
function countPollChecks(): number {
  return waitedTimeouts.filter((timeoutMs) => timeoutMs === ACTION_REQUESTS_POLL_INTERVAL_MS).length;
}

/**
 * Builds the fake page the helpers run on.
 * @returns A Page-shaped stand-in
 */
function buildFakePage(): Page {
  const fakePage = {
    on: (eventName: string, listener: () => void) => {
      const listeners = pageListeners.get(eventName) ?? new Set<() => void>();
      listeners.add(listener);
      pageListeners.set(eventName, listeners);
    },
    off: (eventName: string, listener: () => void) => {
      pageListeners.get(eventName)?.delete(listener);
    },
    waitForTimeout: (timeoutMs: number) => {
      if (waitForTimeoutError !== null) {
        return Promise.reject(waitForTimeoutError);
      }
      waitedTimeouts.push(timeoutMs);
      onEachWait(waitedTimeouts.length);
      return Promise.resolve();
    },
  };
  // Only the members above are ever called; the rest of Page is not needed.
  return fakePage as unknown as Page;
}

beforeEach(() => {
  pageListeners = new Map();
  waitedTimeouts = [];
  waitForTimeoutError = null;
  onEachWait = () => undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("trackPageRequests", () => {
  it("counts the requests in flight as they start, finish, or fail, never below zero, and notes any activity", () => {
    const tracker = trackPageRequests(buildFakePage());
    expect(tracker).toMatchObject({ inFlightCount: 0, sawActivity: false });

    emitPageEvent("request", 3);
    expect(tracker).toMatchObject({ inFlightCount: 3, sawActivity: true });

    tracker.sawActivity = false;
    emitPageEvent("requestfinished");
    expect(tracker).toMatchObject({ inFlightCount: 2, sawActivity: true });

    emitPageEvent("requestfailed", 2);
    emitPageEvent("requestfinished");
    expect(tracker.inFlightCount).toBe(0);
  });

  it("listens to the three request events until stop() detaches them, after which nothing is counted", () => {
    const tracker = trackPageRequests(buildFakePage());
    expect([...pageListeners.keys()]).toEqual(["request", "requestfinished", "requestfailed"]);
    expect(countPageListeners()).toBe(3);

    tracker.stop();
    emitPageEvent("request", 2);

    expect(countPageListeners()).toBe(0);
    expect(tracker).toMatchObject({ inFlightCount: 0, sawActivity: false });
  });
});

describe("waitForTrackedRequestsToFinish", () => {
  /** How many quiet checks make up one quiet window. */
  const QUIET_CHECKS = ACTION_REQUESTS_QUIET_WINDOW_MS / ACTION_REQUESTS_POLL_INTERVAL_MS;

  it("waits one quiet window, checking every poll interval, when the action started no request", async () => {
    const page = buildFakePage();
    const tracker = trackPageRequests(page);

    await waitForTrackedRequestsToFinish(page, tracker, 5000);

    expect(waitedTimeouts).toEqual(Array<number>(QUIET_CHECKS).fill(ACTION_REQUESTS_POLL_INTERVAL_MS));
  });

  it("waits until the requests in flight have finished, then a whole quiet window", async () => {
    const page = buildFakePage();
    const tracker = trackPageRequests(page);
    emitPageEvent("request", 2);
    onEachWait = (checkNumber) => {
      const requestsFinishNow = checkNumber === 7;
      if (requestsFinishNow) {
        emitPageEvent("requestfinished", 2);
      }
    };

    await waitForTrackedRequestsToFinish(page, tracker, 5000);

    // 7 checks while the requests ran (the 7th saw them finish), then 5 quiet ones.
    expect(countPollChecks()).toBe(7 + QUIET_CHECKS);
  });

  it("starts the quiet window over whenever a request starts and ends between two checks", async () => {
    const page = buildFakePage();
    const tracker = trackPageRequests(page);
    onEachWait = (checkNumber) => {
      const aQuickRequestRunsNow = checkNumber <= 3;
      if (aQuickRequestRunsNow) {
        emitPageEvent("request");
        emitPageEvent("requestfinished");
      }
    };

    await waitForTrackedRequestsToFinish(page, tracker, 5000);

    expect(countPollChecks()).toBe(3 + QUIET_CHECKS);
  });

  it("gives up at the cap when the requests never finish", async () => {
    const page = buildFakePage();
    const tracker = trackPageRequests(page);
    emitPageEvent("request");

    await waitForTrackedRequestsToFinish(page, tracker, 1000);

    expect(countPollChecks()).toBe(1000 / ACTION_REQUESTS_POLL_INTERVAL_MS);
  });

  it("does not wait at all when the cap is 0", async () => {
    const page = buildFakePage();
    const tracker = trackPageRequests(page);
    emitPageEvent("request");

    await waitForTrackedRequestsToFinish(page, tracker, 0);

    expect(waitedTimeouts).toEqual([]);
  });

  it("rejects when the page closes while waiting", async () => {
    const page = buildFakePage();
    const tracker = trackPageRequests(page);
    const pageClosedError = new Error("page.waitForTimeout: Target page has been closed");
    waitForTimeoutError = pageClosedError;

    await expect(waitForTrackedRequestsToFinish(page, tracker, 5000)).rejects.toBe(pageClosedError);
  });
});

describe("waitOutMinimumWaitSince", () => {
  it("waits only for what is left of the minimum wait since the action", async () => {
    vi.spyOn(performance, "now").mockReturnValue(1400);

    await waitOutMinimumWaitSince(buildFakePage(), 1000, 1000);

    expect(waitedTimeouts).toEqual([600]);
  });

  it("does not wait when the minimum wait has already passed", async () => {
    vi.spyOn(performance, "now").mockReturnValue(5000);

    await waitOutMinimumWaitSince(buildFakePage(), 1000, 1000);

    expect(waitedTimeouts).toEqual([]);
  });

  it("does not wait when the website has no minimum wait", async () => {
    await waitOutMinimumWaitSince(buildFakePage(), performance.now(), 0);

    expect(waitedTimeouts).toEqual([]);
  });

  it("rejects when the page closes while waiting", async () => {
    vi.spyOn(performance, "now").mockReturnValue(1000);
    const pageClosedError = new Error("page.waitForTimeout: Target page has been closed");
    waitForTimeoutError = pageClosedError;

    await expect(waitOutMinimumWaitSince(buildFakePage(), 1000, 3000)).rejects.toBe(pageClosedError);
  });
});
