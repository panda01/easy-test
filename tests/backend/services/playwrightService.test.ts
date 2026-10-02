import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * No test here launches a real browser. `playwright` is replaced by a fake
 * `chromium` whose `launch` resolves a fake browser, whose `newPage` resolves
 * a fake page; `node:fs/promises` is replaced so no directory is created.
 * The real browser round trip is proven by the manual verification run.
 */
const { mockChromium, mockBrowser, mockPage, mockMkdir, MockTimeoutError } = vi.hoisted(() => ({
  mockChromium: { launch: vi.fn() },
  mockBrowser: { newPage: vi.fn(), close: vi.fn() },
  mockPage: {
    goto: vi.fn(),
    waitForLoadState: vi.fn(),
    evaluate: vi.fn(),
    waitForTimeout: vi.fn(),
    screenshot: vi.fn(),
  },
  mockMkdir: vi.fn(),
  /** Stands in for Playwright's `errors.TimeoutError`, which the service checks with instanceof. */
  MockTimeoutError: class MockTimeoutError extends Error {},
}));

vi.mock("playwright", () => ({
  chromium: mockChromium,
  errors: { TimeoutError: MockTimeoutError },
}));
vi.mock("node:fs/promises", () => ({ mkdir: mockMkdir }));

import { captureWebsiteScreenshot } from "../../../server/services/playwrightService.js";

const VISITED_URL = "https://example.com/";
const SCREENSHOT_FILE_PATH = "/tmp/screenshots/website-1/run.png";
const SCREENSHOT_DIRECTORY = "/tmp/screenshots/website-1";
/** The website's screenshot timing settings: the defaults unless a test says otherwise. */
const TIMING_SETTINGS = { networkIdleTimeoutMs: 5000, screenshotMinimumWaitMs: 300 };
/** The fixed safety limit on the paint wait. */
const EXPECTED_PAINT_WAIT_LIMIT_MS = 2000;

/**
 * A fake `performance.now()` clock. The waits below advance it, so the
 * minimum-wait arithmetic is deterministic.
 */
let fakeNowMs = 0;

/** The in-page function `waitForPaint` sends to `page.evaluate`. */
type PaintWaitScript = (paintWaitLimitMs: number) => Promise<void>;

/**
 * Reads the function the service passed to `page.evaluate`, so a test can run
 * the in-page paint wait against stubbed browser globals.
 * @returns The evaluated function
 */
function readPaintWaitScript(): PaintWaitScript {
  const [paintWaitScript] = mockPage.evaluate.mock.calls[0] as [PaintWaitScript, number];
  return paintWaitScript;
}

/**
 * Builds what `page.goto` resolves with: an object whose `status()` reports
 * the given HTTP status, like Playwright's Response.
 * @param httpStatus - The status the main response reports
 * @returns A Response-shaped stand-in
 */
function buildMainResponse(httpStatus: number): { status: () => number } {
  return { status: () => httpStatus };
}

describe("captureWebsiteScreenshot", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockMkdir.mockResolvedValue(undefined);
    mockChromium.launch.mockResolvedValue(mockBrowser);
    mockBrowser.newPage.mockResolvedValue(mockPage);
    mockBrowser.close.mockResolvedValue(undefined);
    mockPage.goto.mockResolvedValue(buildMainResponse(200));
    mockPage.screenshot.mockResolvedValue(Buffer.from("png"));
    mockPage.waitForTimeout.mockResolvedValue(undefined);
    // By default the network goes idle 100 ms after load and painting takes 20 ms.
    fakeNowMs = 0;
    vi.spyOn(performance, "now").mockImplementation(() => fakeNowMs);
    mockPage.waitForLoadState.mockImplementation(() => {
      fakeNowMs += 100;
      return Promise.resolve();
    });
    mockPage.evaluate.mockImplementation(() => {
      fakeNowMs += 20;
      return Promise.resolve();
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("visits the url in a headless 1280x720 browser, saves a viewport screenshot, and succeeds on HTTP 200", async () => {
    const result = await captureWebsiteScreenshot(VISITED_URL, SCREENSHOT_FILE_PATH, TIMING_SETTINGS);

    expect(result).toEqual({
      succeeded: true,
      httpStatus: 200,
      errorMessage: null,
      screenshotWasCaptured: true,
      durationMs: expect.any(Number),
    });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(result.durationMs)).toBe(true);
    expect(mockMkdir).toHaveBeenCalledWith(SCREENSHOT_DIRECTORY, { recursive: true });
    expect(mockChromium.launch).toHaveBeenCalledWith({ headless: true });
    expect(mockBrowser.newPage).toHaveBeenCalledWith({ viewport: { width: 1280, height: 720 } });
    expect(mockPage.goto).toHaveBeenCalledWith(VISITED_URL, { waitUntil: "load", timeout: 30_000 });
    // No `fullPage` option: only the viewport is captured.
    expect(mockPage.screenshot).toHaveBeenCalledWith({ path: SCREENSHOT_FILE_PATH });
    expect(mockBrowser.close).toHaveBeenCalledTimes(1);
  });

  it("waits for network idle, then paint, then the rest of the minimum wait, then screenshots", async () => {
    await captureWebsiteScreenshot(VISITED_URL, SCREENSHOT_FILE_PATH, TIMING_SETTINGS);

    expect(mockPage.waitForLoadState).toHaveBeenCalledWith("networkidle", { timeout: 5000 });
    expect(mockPage.evaluate).toHaveBeenCalledWith(expect.any(Function), EXPECTED_PAINT_WAIT_LIMIT_MS);
    // Idle took 100 ms and paint 20 ms, so 180 ms of the 300 ms minimum remain.
    expect(mockPage.waitForTimeout).toHaveBeenCalledWith(180);
    const callOrder = [
      mockPage.goto.mock.invocationCallOrder[0],
      mockPage.waitForLoadState.mock.invocationCallOrder[0],
      mockPage.evaluate.mock.invocationCallOrder[0],
      mockPage.waitForTimeout.mock.invocationCallOrder[0],
      mockPage.screenshot.mock.invocationCallOrder[0],
    ];
    expect(callOrder).toEqual([...callOrder].sort((first, second) => first - second));
  });

  it("takes the screenshot straight away when idle and paint already took the minimum wait", async () => {
    mockPage.waitForLoadState.mockImplementation(() => {
      fakeNowMs += 400;
      return Promise.resolve();
    });

    const result = await captureWebsiteScreenshot(VISITED_URL, SCREENSHOT_FILE_PATH, TIMING_SETTINGS);

    expect(result.succeeded).toBe(true);
    expect(mockPage.evaluate).toHaveBeenCalledTimes(1);
    expect(mockPage.waitForTimeout).not.toHaveBeenCalled();
    expect(mockPage.screenshot).toHaveBeenCalledTimes(1);
  });

  it("takes no extra wait when idle and paint end exactly at the minimum wait", async () => {
    mockPage.waitForLoadState.mockImplementation(() => {
      fakeNowMs += 280;
      return Promise.resolve();
    });

    await captureWebsiteScreenshot(VISITED_URL, SCREENSHOT_FILE_PATH, TIMING_SETTINGS);

    expect(mockPage.waitForTimeout).not.toHaveBeenCalled();
  });

  it("skips the paint wait and screenshots at once when the network idle cap runs out", async () => {
    mockPage.waitForLoadState.mockRejectedValue(
      new MockTimeoutError("page.waitForLoadState: Timeout 5000ms exceeded."),
    );

    const result = await captureWebsiteScreenshot(VISITED_URL, SCREENSHOT_FILE_PATH, TIMING_SETTINGS);

    expect(result).toEqual({
      succeeded: true,
      httpStatus: 200,
      errorMessage: null,
      screenshotWasCaptured: true,
      durationMs: expect.any(Number),
    });
    expect(mockPage.evaluate).not.toHaveBeenCalled();
    expect(mockPage.waitForTimeout).not.toHaveBeenCalled();
    expect(mockPage.screenshot).toHaveBeenCalledTimes(1);
  });

  it("does not wait for network idle at all when the cap is 0", async () => {
    await captureWebsiteScreenshot(VISITED_URL, SCREENSHOT_FILE_PATH, {
      networkIdleTimeoutMs: 0,
      screenshotMinimumWaitMs: 0,
    });

    expect(mockPage.waitForLoadState).not.toHaveBeenCalled();
    expect(mockPage.evaluate).not.toHaveBeenCalled();
    expect(mockPage.waitForTimeout).not.toHaveBeenCalled();
    expect(mockPage.screenshot).toHaveBeenCalledTimes(1);
  });

  it("uses the website's own network idle cap", async () => {
    await captureWebsiteScreenshot(VISITED_URL, SCREENSHOT_FILE_PATH, {
      networkIdleTimeoutMs: 12000,
      screenshotMinimumWaitMs: 0,
    });

    expect(mockPage.waitForLoadState).toHaveBeenCalledWith("networkidle", { timeout: 12000 });
    expect(mockPage.waitForTimeout).not.toHaveBeenCalled();
  });

  it.each([
    {
      step: "the network idle wait fails for another reason",
      breakStep: () => {
        mockPage.waitForLoadState.mockRejectedValue(new Error("Target page has been closed\nCall log"));
      },
      reason: "Target page has been closed",
    },
    {
      step: "the paint wait fails",
      breakStep: () => {
        mockPage.evaluate.mockRejectedValue(new Error("Execution context was destroyed"));
      },
      reason: "Execution context was destroyed",
    },
    {
      step: "the minimum wait fails",
      breakStep: () => {
        mockPage.waitForTimeout.mockRejectedValue(new Error("Target page has been closed"));
      },
      reason: "Target page has been closed",
    },
  ])("reports a screenshot that could not be saved when $step", async ({ breakStep, reason }) => {
    breakStep();

    const result = await captureWebsiteScreenshot(VISITED_URL, SCREENSHOT_FILE_PATH, TIMING_SETTINGS);

    expect(result).toEqual({
      succeeded: false,
      httpStatus: 200,
      errorMessage: `The screenshot could not be saved: ${reason}`,
      screenshotWasCaptured: false,
      durationMs: expect.any(Number),
    });
    expect(mockPage.screenshot).not.toHaveBeenCalled();
  });

  describe("the in-page paint wait", () => {
    it("resolves once the fonts are ready and two animation frames have been painted", async () => {
      const paintedFrameCallbacks: (() => void)[] = [];
      vi.stubGlobal("document", { fonts: { ready: Promise.resolve() } });
      vi.stubGlobal("requestAnimationFrame", (frameCallback: () => void) => {
        paintedFrameCallbacks.push(frameCallback);
        setTimeout(frameCallback, 0);
        return paintedFrameCallbacks.length;
      });
      await captureWebsiteScreenshot(VISITED_URL, SCREENSHOT_FILE_PATH, TIMING_SETTINGS);

      await readPaintWaitScript()(EXPECTED_PAINT_WAIT_LIMIT_MS);

      expect(paintedFrameCallbacks).toHaveLength(2);
    });

    it("gives up at the limit when the page never paints a frame", async () => {
      vi.stubGlobal("document", { fonts: { ready: Promise.resolve() } });
      vi.stubGlobal("requestAnimationFrame", () => 1);
      await captureWebsiteScreenshot(VISITED_URL, SCREENSHOT_FILE_PATH, TIMING_SETTINGS);
      vi.useFakeTimers();

      const paintWait = readPaintWaitScript()(EXPECTED_PAINT_WAIT_LIMIT_MS);
      await vi.advanceTimersByTimeAsync(EXPECTED_PAINT_WAIT_LIMIT_MS);

      await expect(paintWait).resolves.toBeUndefined();
    });

    it("gives up at the limit when the fonts never finish loading", async () => {
      vi.stubGlobal("document", { fonts: { ready: new Promise<never>(() => undefined) } });
      vi.stubGlobal("requestAnimationFrame", () => 1);
      await captureWebsiteScreenshot(VISITED_URL, SCREENSHOT_FILE_PATH, TIMING_SETTINGS);
      vi.useFakeTimers();

      const paintWait = readPaintWaitScript()(EXPECTED_PAINT_WAIT_LIMIT_MS);
      await vi.advanceTimersByTimeAsync(EXPECTED_PAINT_WAIT_LIMIT_MS);

      await expect(paintWait).resolves.toBeUndefined();
    });
  });

  it("creates the screenshot directory before launching the browser", async () => {
    await captureWebsiteScreenshot(VISITED_URL, SCREENSHOT_FILE_PATH, TIMING_SETTINGS);

    const mkdirCallOrder = mockMkdir.mock.invocationCallOrder[0];
    const launchCallOrder = mockChromium.launch.mock.invocationCallOrder[0];
    expect(mkdirCallOrder).toBeLessThan(launchCallOrder);
  });

  it("counts HTTP 399 as a success", async () => {
    mockPage.goto.mockResolvedValue(buildMainResponse(399));

    const result = await captureWebsiteScreenshot(VISITED_URL, SCREENSHOT_FILE_PATH, TIMING_SETTINGS);

    expect(result.succeeded).toBe(true);
    expect(result.httpStatus).toBe(399);
    expect(result.errorMessage).toBeNull();
  });

  it.each([400, 404, 500])(
    "counts HTTP %i as a failure but still screenshots the error page",
    async (httpStatus) => {
      mockPage.goto.mockResolvedValue(buildMainResponse(httpStatus));

      const result = await captureWebsiteScreenshot(VISITED_URL, SCREENSHOT_FILE_PATH, TIMING_SETTINGS);

      expect(result).toEqual({
        succeeded: false,
        httpStatus,
        errorMessage: `The page responded with HTTP ${String(httpStatus)}`,
        screenshotWasCaptured: true,
        durationMs: expect.any(Number),
      });
      expect(mockPage.screenshot).toHaveBeenCalledTimes(1);
    },
  );

  it("fails, but still screenshots, when navigation completes without a response", async () => {
    mockPage.goto.mockResolvedValue(null);

    const result = await captureWebsiteScreenshot(VISITED_URL, SCREENSHOT_FILE_PATH, TIMING_SETTINGS);

    expect(result).toEqual({
      succeeded: false,
      httpStatus: null,
      errorMessage: "The page did not return a response",
      screenshotWasCaptured: true,
      durationMs: expect.any(Number),
    });
  });

  it("fails without a screenshot when navigation throws, keeping only the first line of the error", async () => {
    mockPage.goto.mockRejectedValue(
      new Error(
        "page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:59997/\nCall log:\n  - navigating to \"http://localhost:59997/\"",
      ),
    );

    const result = await captureWebsiteScreenshot(VISITED_URL, SCREENSHOT_FILE_PATH, TIMING_SETTINGS);

    expect(result).toEqual({
      succeeded: false,
      httpStatus: null,
      errorMessage: "page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:59997/",
      screenshotWasCaptured: false,
      durationMs: expect.any(Number),
    });
    expect(mockPage.waitForLoadState).not.toHaveBeenCalled();
    expect(mockPage.evaluate).not.toHaveBeenCalled();
    expect(mockPage.waitForTimeout).not.toHaveBeenCalled();
    expect(mockPage.screenshot).not.toHaveBeenCalled();
    expect(mockBrowser.close).toHaveBeenCalledTimes(1);
  });

  it("stringifies a navigation rejection that is not an Error", async () => {
    mockPage.goto.mockRejectedValue({ reason: "timeout" });

    const result = await captureWebsiteScreenshot(VISITED_URL, SCREENSHOT_FILE_PATH, TIMING_SETTINGS);

    expect(result.succeeded).toBe(false);
    expect(result.errorMessage).toBe("[object Object]");
    expect(result.screenshotWasCaptured).toBe(false);
  });

  it("fails, keeping the HTTP status, when the screenshot cannot be written", async () => {
    mockPage.screenshot.mockRejectedValue(new Error("EACCES: permission denied\nmore detail"));

    const result = await captureWebsiteScreenshot(VISITED_URL, SCREENSHOT_FILE_PATH, TIMING_SETTINGS);

    expect(result).toEqual({
      succeeded: false,
      httpStatus: 200,
      errorMessage: "The screenshot could not be saved: EACCES: permission denied",
      screenshotWasCaptured: false,
      durationMs: expect.any(Number),
    });
    expect(mockBrowser.close).toHaveBeenCalledTimes(1);
  });

  it("rejects without launching a browser when the directory cannot be created", async () => {
    const mkdirError = new Error("EACCES: permission denied, mkdir '/tmp/screenshots'");
    mockMkdir.mockRejectedValue(mkdirError);

    await expect(captureWebsiteScreenshot(VISITED_URL, SCREENSHOT_FILE_PATH, TIMING_SETTINGS)).rejects.toBe(
      mkdirError,
    );
    expect(mockChromium.launch).not.toHaveBeenCalled();
  });

  it("rejects when the browser cannot be launched", async () => {
    const launchError = new Error("Executable doesn't exist at /ms-playwright/chromium");
    mockChromium.launch.mockRejectedValue(launchError);

    await expect(captureWebsiteScreenshot(VISITED_URL, SCREENSHOT_FILE_PATH, TIMING_SETTINGS)).rejects.toBe(
      launchError,
    );
    expect(mockBrowser.close).not.toHaveBeenCalled();
  });

  it("rejects, but still closes the browser, when a page cannot be opened", async () => {
    const newPageError = new Error("Target closed");
    mockBrowser.newPage.mockRejectedValue(newPageError);

    await expect(captureWebsiteScreenshot(VISITED_URL, SCREENSHOT_FILE_PATH, TIMING_SETTINGS)).rejects.toBe(
      newPageError,
    );
    expect(mockBrowser.close).toHaveBeenCalledTimes(1);
  });

  it("still returns the visit's result, and logs, when closing the browser fails", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockBrowser.close.mockRejectedValue(new Error("browser has disconnected"));

    const result = await captureWebsiteScreenshot(VISITED_URL, SCREENSHOT_FILE_PATH, TIMING_SETTINGS);

    expect(result.succeeded).toBe(true);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[playwright] could not close the browser: browser has disconnected",
    );
  });
});
