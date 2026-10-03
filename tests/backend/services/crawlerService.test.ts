import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { CrawledPageInput, CrawlProgress } from "../../../server/services/dbService.js";

/**
 * No test here launches a real browser. `playwright` is replaced by a fake
 * `chromium` whose browser opens one fake page, and that page serves a FAKE
 * SITE (see `installFakeSite`): `goto` looks the URL up in a table, and the
 * page's url, title, aria snapshot, and links come from the entry it loaded.
 * The real browser round trip is proven by the manual verification run.
 */
const { mockChromium, mockBrowser, mockPage, mockBodyLocator, mockLinkLocator, MockTimeoutError } =
  vi.hoisted(() => ({
    mockChromium: { launch: vi.fn() },
    mockBrowser: { newPage: vi.fn(), close: vi.fn(), isConnected: vi.fn() },
    mockPage: {
      goto: vi.fn(),
      waitForLoadState: vi.fn(),
      evaluate: vi.fn(),
      waitForTimeout: vi.fn(),
      url: vi.fn(),
      title: vi.fn(),
      locator: vi.fn(),
      isClosed: vi.fn(),
    },
    mockBodyLocator: { ariaSnapshot: vi.fn() },
    mockLinkLocator: { evaluateAll: vi.fn() },
    /** Stands in for Playwright's `errors.TimeoutError`, which the readiness wait checks with instanceof. */
    MockTimeoutError: class MockTimeoutError extends Error {},
  }));

vi.mock("playwright", () => ({
  chromium: mockChromium,
  errors: { TimeoutError: MockTimeoutError },
}));

import {
  ARIA_SNAPSHOT_TIMEOUT_MS,
  CRAWL_PAGE_LIMIT,
  CRAWL_TIME_LIMIT_MS,
  crawlWebsite,
  readRawPageLinks,
  type RecordVisitedPage,
} from "../../../server/services/crawlerService.js";

const START_URL = "https://example.com/";
/** The website's timing settings: no minimum wait, so no `waitForTimeout` call. */
const TIMING_SETTINGS = { networkIdleTimeoutMs: 5000, screenshotMinimumWaitMs: 0 };
const LINK_SELECTOR = "a[href]:not([download])";

/** One page of the fake site, keyed by the URL `goto` is called with. */
interface FakeSitePage {
  /** The HTTP status `goto` reports; 200 by default. */
  httpStatus?: number;
  /** Where the page ends up; the loaded URL by default. */
  finalUrl?: string;
  /** The page's title; empty by default. */
  title?: string;
  /** The page's aria snapshot; a line naming the URL by default. */
  ariaSnapshot?: string;
  /** The raw `href` attributes on the page; none by default. */
  hrefs?: string[];
  /** When set, `goto` rejects with this. */
  gotoError?: Error;
}

/** The URL most recently passed to `goto`, used to find the fake page shown. */
let loadedUrl = "about:blank";
/** What `page.url()` reports. */
let currentUrl = "about:blank";
/** The fake site the page serves. */
let fakeSite: Record<string, FakeSitePage> = {};

/**
 * Builds what `page.goto` resolves with: an object whose `status()` reports
 * the given HTTP status, like Playwright's Response.
 * @param httpStatus - The status the main response reports
 * @returns A Response-shaped stand-in
 */
function buildMainResponse(httpStatus: number): { status: () => number } {
  return { status: () => httpStatus };
}

/**
 * Reads the fake page the browser is currently showing.
 * @returns The fake site entry for the last loaded URL
 */
function readShownPage(): FakeSitePage {
  return fakeSite[loadedUrl] ?? {};
}

/**
 * Points the fake browser page at a fake site. A URL missing from the table
 * fails like an unresolvable host.
 * @param site - The fake site's pages, keyed by the exact URL `goto` receives
 */
function installFakeSite(site: Record<string, FakeSitePage>): void {
  fakeSite = site;
  mockPage.goto.mockImplementation((url: string) => {
    const sitePage = fakeSite[url];
    if (sitePage === undefined) {
      return Promise.reject(
        new Error(`page.goto: net::ERR_NAME_NOT_RESOLVED at ${url}\nCall log:\n  - navigating`),
      );
    }
    if (sitePage.gotoError !== undefined) {
      return Promise.reject(sitePage.gotoError);
    }
    loadedUrl = url;
    currentUrl = sitePage.finalUrl ?? url;
    return Promise.resolve(buildMainResponse(sitePage.httpStatus ?? 200));
  });
}

/** The pages the recorder received, in order. */
let recordedPages: CrawledPageInput[] = [];
/** The progress the recorder received with each page. */
let recordedProgress: CrawlProgress[] = [];

/**
 * The recorder handed to the crawler. `beforeEach` makes it keep every page
 * and answer with a predictable id, `page-<visitOrder>`, so parents can be
 * asserted; a test may replace that behaviour.
 */
const recordVisitedPage = vi.fn<RecordVisitedPage>();

/**
 * Reads the visited URLs (identities) in visiting order.
 * @returns Each recorded page's `url`
 */
function readVisitedUrls(): string[] {
  return recordedPages.map((recordedPage) => recordedPage.url);
}

/**
 * Finds the recorded page with the given identity.
 * @param url - The page's identity URL
 * @returns The recorded page
 */
function findRecordedPage(url: string): CrawledPageInput {
  const recordedPage = recordedPages.find((candidate) => candidate.url === url);
  if (recordedPage === undefined) {
    throw new Error(`No page was recorded for ${url}`);
  }
  return recordedPage;
}

describe("crawlWebsite", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    loadedUrl = "about:blank";
    currentUrl = "about:blank";
    recordedPages = [];
    recordedProgress = [];
    mockChromium.launch.mockResolvedValue(mockBrowser);
    mockBrowser.newPage.mockResolvedValue(mockPage);
    mockBrowser.close.mockResolvedValue(undefined);
    mockBrowser.isConnected.mockReturnValue(true);
    mockPage.isClosed.mockReturnValue(false);
    mockPage.waitForLoadState.mockResolvedValue(undefined);
    mockPage.evaluate.mockResolvedValue(undefined);
    mockPage.waitForTimeout.mockResolvedValue(undefined);
    mockPage.url.mockImplementation(() => currentUrl);
    mockPage.title.mockImplementation(() => Promise.resolve(readShownPage().title ?? ""));
    mockPage.locator.mockImplementation((selector: string) =>
      selector === "body" ? mockBodyLocator : mockLinkLocator,
    );
    mockBodyLocator.ariaSnapshot.mockImplementation(() =>
      Promise.resolve(readShownPage().ariaSnapshot ?? `- text: ${currentUrl}`),
    );
    mockLinkLocator.evaluateAll.mockImplementation(() =>
      Promise.resolve({ baseUrl: currentUrl, hrefs: readShownPage().hrefs ?? [] }),
    );
    recordVisitedPage.mockImplementation((visitedPage, progress) => {
      recordedPages.push(visitedPage);
      recordedProgress.push(progress);
      return Promise.resolve(`page-${String(visitedPage.visitOrder)}`);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("crawls breadth first, records each page once with its parent and depth, and follows only same-origin http links", async () => {
    installFakeSite({
      "https://example.com/": {
        title: "Home",
        ariaSnapshot: '- heading "Home" [level=1]',
        hrefs: [
          "/about",
          "/blog",
          "/about#team",
          "/about?tab=people",
          "mailto:hello@example.com",
          "https://other.example/",
          "",
        ],
      },
      "https://example.com/about": { hrefs: ["/", "/blog/post"] },
      "https://example.com/blog": { hrefs: ["/blog/post"] },
      "https://example.com/blog/post": {},
    });

    const outcome = await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage);

    expect(outcome).toEqual({ stopReason: "finished", visitedPageCount: 4, waitingUrlCount: 0 });
    expect(readVisitedUrls()).toEqual([
      "https://example.com/",
      "https://example.com/about",
      "https://example.com/blog",
      "https://example.com/blog/post",
    ]);
    expect(recordedPages.map((recordedPage) => recordedPage.parentPageId)).toEqual([
      null,
      "page-0",
      "page-0",
      "page-1",
    ]);
    expect(recordedPages.map((recordedPage) => recordedPage.depth)).toEqual([0, 1, 1, 2]);
    expect(recordedPages.map((recordedPage) => recordedPage.visitOrder)).toEqual([0, 1, 2, 3]);
    expect(findRecordedPage("https://example.com/")).toEqual({
      parentPageId: null,
      url: "https://example.com/",
      requestedUrl: "https://example.com/",
      finalUrl: "https://example.com/",
      visitOrder: 0,
      depth: 0,
      succeeded: true,
      httpStatus: 200,
      errorMessage: null,
      title: "Home",
      ariaSnapshot: '- heading "Home" [level=1]',
      linkedUrls: ["https://example.com/about", "https://example.com/blog"],
      durationMs: expect.any(Number),
    });
    expect(findRecordedPage("https://example.com/about").linkedUrls).toEqual([
      "https://example.com/",
      "https://example.com/blog/post",
    ]);
    expect(recordedProgress).toEqual([
      { visitedPageCount: 1, waitingUrlCount: 2 },
      { visitedPageCount: 2, waitingUrlCount: 2 },
      { visitedPageCount: 3, waitingUrlCount: 1 },
      { visitedPageCount: 4, waitingUrlCount: 0 },
    ]);
    expect(mockPage.goto).toHaveBeenCalledTimes(4);
  });

  it("launches one headless browser with one page that refuses downloads, and closes it", async () => {
    installFakeSite({ "https://example.com/": {} });

    await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage);

    expect(mockChromium.launch).toHaveBeenCalledWith({ headless: true });
    expect(mockBrowser.newPage).toHaveBeenCalledTimes(1);
    expect(mockBrowser.newPage).toHaveBeenCalledWith({
      viewport: { width: 1280, height: 720 },
      acceptDownloads: false,
    });
    expect(mockBrowser.close).toHaveBeenCalledTimes(1);
  });

  it("waits for each page with the website's timing settings, then snapshots <body> with a timeout and reads only non-download links", async () => {
    installFakeSite({ "https://example.com/": {} });

    await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage);

    expect(mockPage.goto).toHaveBeenCalledWith(START_URL, { waitUntil: "load", timeout: 30_000 });
    expect(mockPage.waitForLoadState).toHaveBeenCalledWith("networkidle", { timeout: 5000 });
    expect(mockPage.locator).toHaveBeenCalledWith("body");
    expect(mockBodyLocator.ariaSnapshot).toHaveBeenCalledWith({
      timeout: ARIA_SNAPSHOT_TIMEOUT_MS,
    });
    expect(mockPage.locator).toHaveBeenCalledWith(LINK_SELECTOR);
    expect(mockLinkLocator.evaluateAll).toHaveBeenCalledWith(readRawPageLinks);
    const readinessOrder = mockPage.waitForLoadState.mock.invocationCallOrder[0];
    const snapshotOrder = mockBodyLocator.ariaSnapshot.mock.invocationCallOrder[0];
    expect(readinessOrder).toBeLessThan(snapshotOrder);
  });

  it("loads the start URL exactly as given, query string included, but identifies it without the query", async () => {
    const startUrlWithQuery = "https://example.com/?utm_source=easy-test";
    installFakeSite({ [startUrlWithQuery]: {} });

    await crawlWebsite(startUrlWithQuery, TIMING_SETTINGS, recordVisitedPage);

    expect(mockPage.goto).toHaveBeenCalledWith(startUrlWithQuery, expect.any(Object));
    expect(recordedPages[0]).toMatchObject({
      url: "https://example.com/",
      requestedUrl: startUrlWithQuery,
    });
  });

  it("loads a page once, with the query string of the first link that reached it", async () => {
    installFakeSite({
      "https://example.com/": { hrefs: ["/search?q=shoes#results", "/search?q=hats"] },
      "https://example.com/search?q=shoes": {},
    });

    await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage);

    expect(mockPage.goto).toHaveBeenCalledWith(
      "https://example.com/search?q=shoes",
      expect.any(Object),
    );
    expect(mockPage.goto).toHaveBeenCalledTimes(2);
    expect(findRecordedPage("https://example.com/search")).toMatchObject({
      requestedUrl: "https://example.com/search?q=shoes",
    });
  });

  it("takes the crawl's origin from where the start page ended up, so an http to https www redirect keeps crawling", async () => {
    installFakeSite({
      "http://example.com/": {
        finalUrl: "https://www.example.com/",
        hrefs: ["/about", "http://example.com/old-host"],
      },
      "https://www.example.com/about": {},
    });

    const outcome = await crawlWebsite("http://example.com/", TIMING_SETTINGS, recordVisitedPage);

    expect(outcome.visitedPageCount).toBe(2);
    expect(recordedPages[0]).toMatchObject({
      url: "http://example.com/",
      finalUrl: "https://www.example.com/",
      linkedUrls: ["https://www.example.com/about"],
    });
    expect(readVisitedUrls()).toEqual(["http://example.com/", "https://www.example.com/about"]);
  });

  it("records a page that redirected off-site, but neither reads nor follows its links", async () => {
    installFakeSite({
      "https://example.com/": { hrefs: ["/out"] },
      "https://example.com/out": {
        finalUrl: "https://other.example/landing",
        hrefs: ["/elsewhere"],
      },
    });

    await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage);

    expect(findRecordedPage("https://example.com/out")).toMatchObject({
      finalUrl: "https://other.example/landing",
      succeeded: true,
      linkedUrls: [],
    });
    expect(mockLinkLocator.evaluateAll).toHaveBeenCalledTimes(1);
    expect(readVisitedUrls()).toHaveLength(2);
  });

  it("never loads a page a link already redirected to", async () => {
    installFakeSite({
      "https://example.com/": { hrefs: ["/old"] },
      "https://example.com/old": {
        finalUrl: "https://example.com/new",
        hrefs: ["/new", "/next"],
      },
      "https://example.com/next": {},
    });

    await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage);

    expect(readVisitedUrls()).toEqual([
      "https://example.com/",
      "https://example.com/old",
      "https://example.com/next",
    ]);
    expect(findRecordedPage("https://example.com/old").linkedUrls).toEqual([
      "https://example.com/new",
      "https://example.com/next",
    ]);
  });

  it("records a page whose navigation threw as failed, with the error's first line, and keeps crawling", async () => {
    installFakeSite({
      "https://example.com/": { hrefs: ["/report.pdf", "/ok"] },
      "https://example.com/report.pdf": {
        gotoError: new Error("page.goto: Download is starting\nCall log:\n  - navigating"),
      },
      "https://example.com/ok": {},
    });

    const outcome = await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage);

    expect(outcome.stopReason).toBe("finished");
    expect(findRecordedPage("https://example.com/report.pdf")).toEqual({
      parentPageId: "page-0",
      url: "https://example.com/report.pdf",
      requestedUrl: "https://example.com/report.pdf",
      finalUrl: "https://example.com/report.pdf",
      visitOrder: 1,
      depth: 1,
      succeeded: false,
      httpStatus: null,
      errorMessage: "page.goto: Download is starting",
      title: null,
      ariaSnapshot: null,
      linkedUrls: [],
      durationMs: expect.any(Number),
    });
    expect(findRecordedPage("https://example.com/ok").succeeded).toBe(true);
  });

  it("records an HTTP 404 page as failed, but still keeps its snapshot and follows its links", async () => {
    installFakeSite({
      "https://example.com/": { httpStatus: 404, ariaSnapshot: "- text: Not found", hrefs: ["/home"] },
      "https://example.com/home": {},
    });

    await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage);

    expect(recordedPages[0]).toMatchObject({
      succeeded: false,
      httpStatus: 404,
      errorMessage: "The page responded with HTTP 404",
      ariaSnapshot: "- text: Not found",
      linkedUrls: ["https://example.com/home"],
    });
    expect(readVisitedUrls()).toContain("https://example.com/home");
  });

  it("records a page that never became ready as failed, without a snapshot, title, or links", async () => {
    installFakeSite({
      "https://example.com/": { hrefs: ["/closing"] },
      "https://example.com/closing": { hrefs: ["/never-followed"] },
    });
    mockPage.waitForLoadState.mockImplementation(() =>
      loadedUrl === "https://example.com/closing"
        ? Promise.reject(new Error("page.waitForLoadState: Target page has been closed\nCall log:"))
        : Promise.resolve(),
    );

    await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage);

    expect(findRecordedPage("https://example.com/closing")).toMatchObject({
      succeeded: false,
      httpStatus: 200,
      finalUrl: "https://example.com/closing",
      errorMessage: "The page did not become ready: page.waitForLoadState: Target page has been closed",
      title: null,
      ariaSnapshot: null,
      linkedUrls: [],
    });
    expect(readVisitedUrls()).toHaveLength(2);
  });

  it("records a snapshot that could not be taken, and still reads the page's links", async () => {
    installFakeSite({
      "https://example.com/": { hrefs: ["/next"] },
      "https://example.com/next": {},
    });
    mockBodyLocator.ariaSnapshot.mockRejectedValueOnce(
      new Error("locator.ariaSnapshot: Timeout 10000ms exceeded.\nCall log:"),
    );

    await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage);

    expect(recordedPages[0]).toMatchObject({
      succeeded: false,
      errorMessage: "The aria snapshot could not be taken: locator.ariaSnapshot: Timeout 10000ms exceeded.",
      ariaSnapshot: null,
      linkedUrls: ["https://example.com/next"],
    });
    expect(readVisitedUrls()).toHaveLength(2);
  });

  it("joins every problem a loaded page had into one error message", async () => {
    installFakeSite({ "https://example.com/": { httpStatus: 500 } });
    mockBodyLocator.ariaSnapshot.mockRejectedValueOnce(new Error("snapshot broke"));
    mockLinkLocator.evaluateAll.mockRejectedValueOnce(
      new Error("locator.evaluateAll: Execution context was destroyed"),
    );

    await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage);

    expect(recordedPages[0]).toMatchObject({
      succeeded: false,
      errorMessage:
        "The page responded with HTTP 500; The aria snapshot could not be taken: snapshot broke; The page's links could not be read: locator.evaluateAll: Execution context was destroyed",
      linkedUrls: [],
    });
  });

  it("records an empty or unreadable title as no title", async () => {
    installFakeSite({
      "https://example.com/": { title: "   ", hrefs: ["/next"] },
      "https://example.com/next": { title: "Next" },
    });
    mockPage.title.mockResolvedValueOnce("   ");
    mockPage.title.mockRejectedValueOnce(new Error("Execution context was destroyed"));

    await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage);

    expect(recordedPages.map((recordedPage) => recordedPage.title)).toEqual([null, null]);
    expect(recordedPages[1].succeeded).toBe(true);
  });

  it("follows no links when the start page's final URL cannot be parsed", async () => {
    installFakeSite({ "https://example.com/": { finalUrl: "", hrefs: ["/next"] } });

    const outcome = await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage);

    expect(outcome).toEqual({ stopReason: "finished", visitedPageCount: 1, waitingUrlCount: 0 });
    expect(recordedPages[0]).toMatchObject({ finalUrl: "", linkedUrls: [] });
    expect(mockLinkLocator.evaluateAll).not.toHaveBeenCalled();
  });

  it("identifies a start URL it cannot normalize by the URL itself", async () => {
    installFakeSite({});

    await crawlWebsite("not a url", TIMING_SETTINGS, recordVisitedPage);

    expect(recordedPages[0]).toMatchObject({
      url: "not a url",
      requestedUrl: "not a url",
      succeeded: false,
    });
  });

  it(`stops at the ${String(CRAWL_PAGE_LIMIT)}-page limit with the remaining links still waiting`, async () => {
    const linkedPageCount = CRAWL_PAGE_LIMIT + 10;
    const linkedHrefs = Array.from({ length: linkedPageCount }, (_, index) => `/page-${String(index)}`);
    const site: Record<string, FakeSitePage> = { "https://example.com/": { hrefs: linkedHrefs } };
    for (const linkedHref of linkedHrefs) {
      site[`https://example.com${linkedHref}`] = {};
    }
    installFakeSite(site);

    const outcome = await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage);

    expect(outcome).toEqual({
      stopReason: "stoppedAtPageLimit",
      visitedPageCount: CRAWL_PAGE_LIMIT,
      waitingUrlCount: linkedPageCount + 1 - CRAWL_PAGE_LIMIT,
    });
    expect(recordVisitedPage).toHaveBeenCalledTimes(CRAWL_PAGE_LIMIT);
  });

  it("stops at the time limit, checked between pages", async () => {
    let fakeNowMs = 0;
    vi.spyOn(performance, "now").mockImplementation(() => fakeNowMs);
    installFakeSite({
      "https://example.com/": { hrefs: ["/a", "/b", "/c"] },
      "https://example.com/a": {},
      "https://example.com/b": {},
    });
    recordVisitedPage.mockImplementation((visitedPage, progress) => {
      recordedPages.push(visitedPage);
      recordedProgress.push(progress);
      fakeNowMs += CRAWL_TIME_LIMIT_MS / 2;
      return Promise.resolve(`page-${String(visitedPage.visitOrder)}`);
    });

    const outcome = await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage);

    expect(outcome).toEqual({
      stopReason: "stoppedAtTimeLimit",
      visitedPageCount: 2,
      waitingUrlCount: 2,
    });
  });

  it("stops without queueing anything more when the recorder reports the run is gone", async () => {
    installFakeSite({
      "https://example.com/": { hrefs: ["/a", "/b"] },
      "https://example.com/a": { hrefs: ["/c"] },
    });
    recordVisitedPage.mockImplementation((visitedPage, progress) => {
      recordedPages.push(visitedPage);
      recordedProgress.push(progress);
      const runIsGone = visitedPage.visitOrder === 1;
      return Promise.resolve(runIsGone ? null : `page-${String(visitedPage.visitOrder)}`);
    });

    const outcome = await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage);

    expect(outcome).toEqual({
      stopReason: "stoppedBecauseRunWasDeleted",
      visitedPageCount: 2,
      waitingUrlCount: 1,
    });
    expect(mockPage.goto).toHaveBeenCalledTimes(2);
    expect(mockBrowser.close).toHaveBeenCalledTimes(1);
  });

  it("stops at once, records nothing for the page being visited, and keeps it waiting, when the browser closes mid-crawl", async () => {
    installFakeSite({
      "https://example.com/": { hrefs: ["/a", "/b", "/c"] },
      "https://example.com/a": {},
      "https://example.com/b": {},
    });
    mockPage.goto.mockImplementation((url: string) => {
      const browserIsClosing = url === "https://example.com/a";
      if (browserIsClosing) {
        mockBrowser.isConnected.mockReturnValue(false);
        return Promise.reject(new Error("page.goto: Target page, context or browser has been closed"));
      }
      loadedUrl = url;
      currentUrl = url;
      return Promise.resolve(buildMainResponse(200));
    });

    const outcome = await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage);

    expect(outcome).toEqual({
      stopReason: "stoppedBecauseBrowserClosed",
      visitedPageCount: 1,
      waitingUrlCount: 3,
    });
    expect(readVisitedUrls()).toEqual(["https://example.com/"]);
    expect(mockPage.goto).toHaveBeenCalledTimes(2);
  });

  it("also stops when the page closed but the browser does not report itself disconnected yet", async () => {
    installFakeSite({
      "https://example.com/": { hrefs: ["/a", "/b"] },
      "https://example.com/a": {},
      "https://example.com/b": {},
    });
    mockPage.waitForLoadState.mockImplementation(() => {
      const browserIsClosing = loadedUrl === "https://example.com/a";
      if (browserIsClosing) {
        mockPage.isClosed.mockReturnValue(true);
        return Promise.reject(
          new Error("page.waitForLoadState: Target page, context or browser has been closed"),
        );
      }
      return Promise.resolve();
    });

    const outcome = await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage);

    expect(outcome).toEqual({
      stopReason: "stoppedBecauseBrowserClosed",
      visitedPageCount: 1,
      waitingUrlCount: 2,
    });
    expect(readVisitedUrls()).toEqual(["https://example.com/"]);
  });

  it("rejects with the recorder's error, and still closes the browser", async () => {
    installFakeSite({ "https://example.com/": {} });
    const databaseError = new Error("connection terminated");
    recordVisitedPage.mockRejectedValue(databaseError);

    await expect(crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage)).rejects.toBe(
      databaseError,
    );
    expect(mockBrowser.close).toHaveBeenCalledTimes(1);
  });

  it("rejects without recording anything when the browser cannot launch", async () => {
    const launchError = new Error("Executable doesn't exist at /ms-playwright/chromium");
    mockChromium.launch.mockRejectedValue(launchError);

    await expect(crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage)).rejects.toBe(
      launchError,
    );
    expect(recordVisitedPage).not.toHaveBeenCalled();
  });

  it("logs, but does not fail the crawl, when the browser cannot be closed", async () => {
    installFakeSite({ "https://example.com/": {} });
    mockBrowser.close.mockRejectedValue(new Error("browser already gone"));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const outcome = await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage);

    expect(outcome.stopReason).toBe("finished");
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[playwright] could not close the browser: browser already gone",
    );
  });
});

describe("readRawPageLinks (runs inside the browser)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the page's base URL and every anchor's raw href attribute, blank when missing", () => {
    vi.stubGlobal("document", { baseURI: "https://example.com/docs/" });
    const anchors = [
      { getAttribute: (attributeName: string) => (attributeName === "href" ? "guide" : null) },
      { getAttribute: () => null },
    ] as unknown as Element[];

    expect(readRawPageLinks(anchors)).toEqual({
      baseUrl: "https://example.com/docs/",
      hrefs: ["guide", ""],
    });
  });
});
