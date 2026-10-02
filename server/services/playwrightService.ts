import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, errors, type Browser, type Page } from "playwright";
import { describeError } from "../utils/describeError.js";

/** How long `page.goto` may take before the visit counts as a timeout. */
const NAVIGATION_TIMEOUT_MS = 30_000;

/** The browser viewport, which is also exactly what the screenshot captures. */
const SCREENSHOT_VIEWPORT = { width: 1280, height: 720 };

/** The lowest HTTP status that makes a visit count as failed. */
const FIRST_FAILING_HTTP_STATUS = 400;

/**
 * Safety limit on waiting for the page to paint. `page.evaluate` has no
 * timeout of its own, so without this a page that never paints would hang the
 * request. When it is reached, the screenshot goes ahead anyway.
 */
const PAINT_WAIT_LIMIT_MS = 2_000;

/**
 * A website's settings for WHEN its screenshot is taken, counted from the
 * page's `load` event (see `captureWhenReady`).
 */
export interface ScreenshotTimingSettings {
  /** How long to wait for network requests to finish; 0 means don't wait. */
  networkIdleTimeoutMs: number;
  /** The screenshot is never taken sooner than this after `load`. */
  screenshotMinimumWaitMs: number;
}

/** What one visit to a website produced. */
export interface ScreenshotCaptureResult {
  /** True only when navigation completed, the page answered below HTTP 400, and the screenshot was saved. */
  succeeded: boolean;
  /** The main response's HTTP status, or null when navigation failed or the page gave no response. */
  httpStatus: number | null;
  /** Why the visit failed, or null when it succeeded. */
  errorMessage: string | null;
  /** True when a PNG was written to the requested file path. */
  screenshotWasCaptured: boolean;
  /** How long the navigation took, in whole milliseconds (browser launch and the screenshot are not included). */
  durationMs: number;
}

/** How `navigateToUrl` ended: either the page loaded (possibly with an error status) or navigation threw. */
type NavigationOutcome =
  | { navigationCompleted: true; httpStatus: number | null; durationMs: number }
  | { navigationCompleted: false; errorMessage: string; durationMs: number };

/**
 * Measures the whole milliseconds elapsed since a `performance.now()` reading.
 * Rounded because the run's `durationMs` column is an integer.
 * @param startedAt - The `performance.now()` reading taken when the work began
 * @returns Elapsed time in whole milliseconds
 */
function measureElapsedMs(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}

/**
 * Shortens an error to its first line. Playwright errors append a multi-line
 * "Call log" after the useful part, e.g.
 * `page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:1/\nCall log: ...`.
 * @param error - Whatever a Playwright call rejected with
 * @returns The first line of the error's message, trimmed
 */
function summarizeError(error: unknown): string {
  const fullMessage = describeError(error);
  const firstLine = fullMessage.split("\n")[0];
  return firstLine.trim();
}

/**
 * Explains why a page that DID load still counts as a failed visit.
 * @param httpStatus - The main response's HTTP status, or null when there was no response
 * @returns A sentence naming the status, or saying there was no response
 */
function describeUnsuccessfulResponse(httpStatus: number | null): string {
  const pageGaveNoResponse = httpStatus === null;
  if (pageGaveNoResponse) {
    return "The page did not return a response";
  }
  return `The page responded with HTTP ${httpStatus}`;
}

/**
 * Sends the page to the URL and waits for its `load` event.
 *
 * Redirects are followed: `page.goto` resolves with the LAST response of the
 * redirect chain, so a 301 that ends on a 200 page reports 200. A DNS error,
 * refused connection, TLS certificate error, or timeout makes `page.goto`
 * throw, which is returned as a failed navigation rather than re-thrown.
 * @param page - The open browser page
 * @param url - Where to navigate
 * @returns Whether navigation completed, with the HTTP status or the reason it failed, and how long it took
 */
async function navigateToUrl(page: Page, url: string): Promise<NavigationOutcome> {
  const navigationStartedAt = performance.now();
  try {
    const mainResponse = await page.goto(url, {
      waitUntil: "load",
      timeout: NAVIGATION_TIMEOUT_MS,
    });
    const durationMs = measureElapsedMs(navigationStartedAt);
    const pageReturnedAResponse = mainResponse !== null;
    const httpStatus = pageReturnedAResponse ? mainResponse.status() : null;
    return { navigationCompleted: true, httpStatus, durationMs };
  } catch (error: unknown) {
    const durationMs = measureElapsedMs(navigationStartedAt);
    return { navigationCompleted: false, errorMessage: summarizeError(error), durationMs };
  }
}

/**
 * Waits until the page has had no network requests in flight for 500 ms
 * (Playwright's "networkidle"), for at most `networkIdleTimeoutMs`.
 *
 * A cap of 0 skips the wait entirely: Playwright reads `timeout: 0` as "no
 * timeout", which would wait forever on a page that keeps polling.
 * @param page - The page that has finished loading
 * @param networkIdleTimeoutMs - The website's cap on waiting for idle
 * @returns True when the network went idle; false when the cap ran out (or is 0)
 * @throws Any failure other than the cap running out, e.g. the page closing
 */
async function waitForNetworkIdle(page: Page, networkIdleTimeoutMs: number): Promise<boolean> {
  const idleWaitIsDisabled = networkIdleTimeoutMs === 0;
  if (idleWaitIsDisabled) {
    return false;
  }
  try {
    await page.waitForLoadState("networkidle", { timeout: networkIdleTimeoutMs });
    return true;
  } catch (error: unknown) {
    const capRanOut = error instanceof errors.TimeoutError;
    if (capRanOut) {
      return false;
    }
    throw error;
  }
}

/**
 * Waits for the page to finish painting: its web fonts are ready and two
 * animation frames have been rendered, so the latest DOM changes are on
 * screen. Gives up after `PAINT_WAIT_LIMIT_MS` and lets the screenshot go
 * ahead anyway.
 * @param page - The page whose network has gone idle
 * @returns Resolves once the page has painted or the limit was reached
 */
async function waitForPaint(page: Page): Promise<void> {
  // This function runs INSIDE the browser: Playwright sends its source text
  // over. Keep every function in it anonymous - `tsx` (esbuild) wraps NAMED
  // functions in a `__name(...)` helper that only exists on the server, which
  // fails in the page with "ReferenceError: __name is not defined".
  await page.evaluate(async (paintWaitLimitMs: number) => {
    const paintWaitLimitReached = new Promise<void>((resolve) => {
      setTimeout(resolve, paintWaitLimitMs);
    });
    await Promise.race([document.fonts.ready, paintWaitLimitReached]);
    const firstFramePainted = new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        resolve();
      });
    });
    await Promise.race([firstFramePainted, paintWaitLimitReached]);
    const secondFramePainted = new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        resolve();
      });
    });
    await Promise.race([secondFramePainted, paintWaitLimitReached]);
  }, PAINT_WAIT_LIMIT_MS);
}

/**
 * Waits until the page is ready, then writes a PNG of its current viewport
 * (not the full scrollable page). Starts right after the `load` event:
 *
 * 1. Wait for network idle, for at most the website's cap.
 * 2. If the network went idle: wait for the page to paint, then wait out
 *    whatever is left of the website's minimum wait. The minimum is a FLOOR
 *    on the time since `load` - if idle + paint already took that long, there
 *    is no extra wait.
 * 3. If the cap ran out instead, take the screenshot at once (no paint wait).
 *    Validation keeps the cap at or above the minimum, so the minimum has
 *    already passed by then.
 *
 * A failure of any step is reported the same way, as a screenshot that could
 * not be saved.
 * @param page - The page that has finished navigating
 * @param screenshotFilePath - Absolute path of the PNG to write
 * @param timingSettings - The website's network idle cap and minimum wait
 * @returns Null when the file was written; otherwise why it could not be
 */
async function captureWhenReady(
  page: Page,
  screenshotFilePath: string,
  timingSettings: ScreenshotTimingSettings,
): Promise<string | null> {
  const readinessStartedAt = performance.now();
  try {
    const networkWentIdle = await waitForNetworkIdle(page, timingSettings.networkIdleTimeoutMs);
    if (networkWentIdle) {
      await waitForPaint(page);
      const remainingMinimumWaitMs =
        timingSettings.screenshotMinimumWaitMs - measureElapsedMs(readinessStartedAt);
      const minimumWaitIsNotYetReached = remainingMinimumWaitMs > 0;
      if (minimumWaitIsNotYetReached) {
        await page.waitForTimeout(remainingMinimumWaitMs);
      }
    }
    await page.screenshot({ path: screenshotFilePath });
    return null;
  } catch (error: unknown) {
    return `The screenshot could not be saved: ${summarizeError(error)}`;
  }
}

/**
 * Visits the URL and, when the page answered at all, screenshots it.
 *
 * A page that loaded with HTTP 400 or above is still screenshotted (so the
 * user can see the error page), but the visit counts as failed. A navigation
 * that threw produces no screenshot.
 * @param page - A fresh browser page
 * @param url - Where to navigate
 * @param screenshotFilePath - Absolute path of the PNG to write
 * @param timingSettings - The website's network idle cap and minimum wait
 * @returns The visit's outcome
 */
async function visitPageAndCapture(
  page: Page,
  url: string,
  screenshotFilePath: string,
  timingSettings: ScreenshotTimingSettings,
): Promise<ScreenshotCaptureResult> {
  const navigation = await navigateToUrl(page, url);
  if (!navigation.navigationCompleted) {
    return {
      succeeded: false,
      httpStatus: null,
      errorMessage: navigation.errorMessage,
      screenshotWasCaptured: false,
      durationMs: navigation.durationMs,
    };
  }

  const { httpStatus, durationMs } = navigation;
  const screenshotErrorMessage = await captureWhenReady(page, screenshotFilePath, timingSettings);
  const screenshotFailed = screenshotErrorMessage !== null;
  if (screenshotFailed) {
    return {
      succeeded: false,
      httpStatus,
      errorMessage: screenshotErrorMessage,
      screenshotWasCaptured: false,
      durationMs,
    };
  }

  const responseIsSuccessful = httpStatus !== null && httpStatus < FIRST_FAILING_HTTP_STATUS;
  return {
    succeeded: responseIsSuccessful,
    httpStatus,
    errorMessage: responseIsSuccessful ? null : describeUnsuccessfulResponse(httpStatus),
    screenshotWasCaptured: true,
    durationMs,
  };
}

/**
 * Closes the browser without letting a close failure replace the visit's
 * result: the run has already happened, so a close error is only logged.
 * @param browser - The browser to close
 * @returns Resolves once the browser is closed or the failure is logged
 */
async function closeBrowserQuietly(browser: Browser): Promise<void> {
  try {
    await browser.close();
  } catch (error: unknown) {
    console.error(`[playwright] could not close the browser: ${describeError(error)}`);
  }
}

/**
 * Launches a headless Chromium on this machine, visits `url` in a 1280x720
 * viewport, waits until the page is ready (network idle, painted, and the
 * minimum wait passed - see `captureWhenReady`), and writes a viewport
 * screenshot to `screenshotFilePath`.
 *
 * Every call launches and closes its own browser, so nothing is left running
 * between requests and no shutdown hook is needed.
 *
 * A failed VISIT (HTTP 400+, DNS error, refused connection, timeout, a
 * screenshot that could not be written) is a normal result with
 * `succeeded: false`. Only infrastructure failures reject: the screenshot's
 * directory cannot be created, or the browser cannot be launched or open a
 * page (e.g. Chromium is not installed - `npx playwright install chromium`).
 * The directory is created BEFORE the browser launches, so a bad
 * `SCREENSHOT_DIR` fails without spawning a browser.
 * @param url - The http(s) URL to visit
 * @param screenshotFilePath - Absolute path of the PNG to write; its directory is created when missing
 * @param timingSettings - The website's network idle cap and minimum wait
 * @returns The visit's outcome
 * @throws When the directory cannot be created or the browser cannot be launched or open a page
 */
export async function captureWebsiteScreenshot(
  url: string,
  screenshotFilePath: string,
  timingSettings: ScreenshotTimingSettings,
): Promise<ScreenshotCaptureResult> {
  await mkdir(path.dirname(screenshotFilePath), { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: SCREENSHOT_VIEWPORT });
    return await visitPageAndCapture(page, url, screenshotFilePath, timingSettings);
  } finally {
    await closeBrowserQuietly(browser);
  }
}
