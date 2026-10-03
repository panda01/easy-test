import type { Page } from "playwright";
import { measureElapsedMs } from "./playwrightService.js";

/**
 * How long no request may be in flight for an action's requests to count as
 * finished - the same 500 ms Playwright's "networkidle" uses.
 */
export const ACTION_REQUESTS_QUIET_WINDOW_MS = 500;

/** How often the crawler looks at whether an action's requests have finished. */
export const ACTION_REQUESTS_POLL_INTERVAL_MS = 100;

/**
 * Counts the network requests a page makes from the moment it is created, so
 * the crawler can wait for exactly the requests one action started - a login
 * form's submit, or a button click. Playwright's own "networkidle" state
 * cannot be used for that, because a page that was already idle before the
 * action (a single-page app that answers with `fetch`) counts as idle at once.
 */
export interface PageRequestTracker {
  /** Requests started since tracking began that have not finished or failed yet. */
  inFlightCount: number;
  /** True when a request started, finished, or failed since this was last reset. */
  sawActivity: boolean;
  /** Stops listening to the page's request events. */
  stop: () => void;
}

/**
 * Starts counting the page's requests. Call it right BEFORE the action (the
 * submit, the click), so every request the action starts is seen, and
 * `stop()` it once the action's result is known.
 * @param page - The crawl's browser page
 * @returns The tracker, already listening
 */
export function trackPageRequests(page: Page): PageRequestTracker {
  const requestCounts = { inFlightCount: 0, sawActivity: false };

  /** Counts a request that just started. */
  const handleRequestStarted = (): void => {
    requestCounts.inFlightCount += 1;
    requestCounts.sawActivity = true;
  };

  /** Counts a request that just finished or failed (never below zero). */
  const handleRequestEnded = (): void => {
    requestCounts.inFlightCount = Math.max(0, requestCounts.inFlightCount - 1);
    requestCounts.sawActivity = true;
  };

  /** Detaches the three listeners from the page. */
  const stop = (): void => {
    page.off("request", handleRequestStarted);
    page.off("requestfinished", handleRequestEnded);
    page.off("requestfailed", handleRequestEnded);
  };

  page.on("request", handleRequestStarted);
  page.on("requestfinished", handleRequestEnded);
  page.on("requestfailed", handleRequestEnded);
  // The same object the handlers update, so the waits read live counts.
  return Object.assign(requestCounts, { stop });
}

/**
 * Waits until the requests an action started have finished: no request in
 * flight, and nothing started or ended, for `ACTION_REQUESTS_QUIET_WINDOW_MS`.
 * Gives up after `capMs` (the website's network idle cap, like every other
 * network wait) - so a site that keeps polling cannot hold the crawl forever.
 * A cap of 0 skips the wait, as it does for pages.
 * @param page - The crawl's browser page (its `waitForTimeout` paces the checks)
 * @param tracker - The tracker started right before the action
 * @param capMs - The most this may wait, in milliseconds
 * @returns Resolves once the requests have finished or the cap ran out
 * @throws When the page closes while waiting
 */
export async function waitForTrackedRequestsToFinish(
  page: Page,
  tracker: PageRequestTracker,
  capMs: number,
): Promise<void> {
  let quietForMs = 0;
  let waitedMs = 0;
  const requestsHaveFinished = (): boolean => quietForMs >= ACTION_REQUESTS_QUIET_WINDOW_MS;
  const capHasRunOut = (): boolean => waitedMs >= capMs;
  while (!requestsHaveFinished() && !capHasRunOut()) {
    tracker.sawActivity = false;
    await page.waitForTimeout(ACTION_REQUESTS_POLL_INTERVAL_MS);
    waitedMs += ACTION_REQUESTS_POLL_INTERVAL_MS;
    const networkWasQuiet = tracker.inFlightCount === 0 && !tracker.sawActivity;
    quietForMs = networkWasQuiet ? quietForMs + ACTION_REQUESTS_POLL_INTERVAL_MS : 0;
  }
}

/**
 * Waits out whatever is left of the website's minimum wait, counted from the
 * moment an action happened (the login form was submitted, a button was
 * clicked) - the same floor every crawled page and screenshot gets after it
 * loads.
 * @param page - The crawl's browser page
 * @param startedAt - The `performance.now()` reading taken when the action happened
 * @param minimumWaitMs - The website's minimum wait
 * @returns Resolves once the minimum wait has passed
 * @throws When the page closes while waiting
 */
export async function waitOutMinimumWaitSince(
  page: Page,
  startedAt: number,
  minimumWaitMs: number,
): Promise<void> {
  const remainingMinimumWaitMs = minimumWaitMs - measureElapsedMs(startedAt);
  const minimumWaitIsNotYetReached = remainingMinimumWaitMs > 0;
  if (minimumWaitIsNotYetReached) {
    await page.waitForTimeout(remainingMinimumWaitMs);
  }
}
