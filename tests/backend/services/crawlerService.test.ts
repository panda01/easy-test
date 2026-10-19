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
      on: vi.fn(),
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

/**
 * The login itself is replaced: its own spec drives a fake login form. Here
 * only its outcome matters - what the crawl does after a login worked or
 * failed.
 */
const mockCrawlerLoginService = vi.hoisted(() => ({
  logInWithCredential: vi.fn(),
  captureLoginFailureScreenshot: vi.fn(),
}));

vi.mock("../../../server/services/crawlerLoginService.js", () => mockCrawlerLoginService);

/**
 * Clicking buttons is replaced too: its own spec drives a fake page of
 * buttons. Here only what the clicks found matters - `beforeEach` makes it
 * report the shown fake page's `buttonLinks`.
 */
const mockCrawlerButtonService = vi.hoisted(() => ({
  followPageButtons: vi.fn(),
}));

vi.mock("../../../server/services/crawlerButtonService.js", () => mockCrawlerButtonService);

import type { ButtonLink } from "../../../server/services/crawlerButtonService.js";
import {
  ARIA_SNAPSHOT_TIMEOUT_MS,
  CRAWL_PAGE_LIMIT,
  CRAWL_TIME_LIMIT_MS,
  crawlWebsite,
  isLogoutLink,
  readRawPageLinks,
  type CrawlLogin,
  type RecordStructureSkeletons,
  type RecordVisitedPage,
} from "../../../server/services/crawlerService.js";
import type { NewStructureSkeleton } from "../../../server/utils/crawlPatternSampling.js";

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
  /** The pages this page's buttons lead to, as `followPageButtons` reports them; none by default. */
  buttonLinks?: ButtonLink[];
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

/** The structure skeletons the crawler handed over to be saved, in order. */
let savedStructureSkeletons: NewStructureSkeleton[] = [];

/**
 * The skeleton saver handed to the crawler. `beforeEach` makes it keep every
 * skeleton and say the run is still active; a test may replace that behaviour.
 */
const recordStructureSkeletons = vi.fn<RecordStructureSkeletons>();

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
    savedStructureSkeletons = [];
    recordStructureSkeletons.mockImplementation((structureSkeletons) => {
      savedStructureSkeletons.push(...structureSkeletons);
      return Promise.resolve(true);
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

    const outcome = await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage, recordStructureSkeletons);

    expect(outcome).toEqual({
      stopReason: "finished",
      visitedPageCount: 4,
      waitingUrlCount: 0,
      skippedSimilarUrlCount: 0,
      skippedSimilarUrlCountsByPattern: {},
      loginErrorMessage: null,
      loginFailureScreenshotWasCaptured: false,
    });
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
      wasRedirected: false,
      foundByButtonText: null,
      buttonUrls: [],
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

    await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage, recordStructureSkeletons);

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

    await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage, recordStructureSkeletons);

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

    await crawlWebsite(startUrlWithQuery, TIMING_SETTINGS, recordVisitedPage, recordStructureSkeletons);

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

    await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage, recordStructureSkeletons);

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

    const outcome = await crawlWebsite("http://example.com/", TIMING_SETTINGS, recordVisitedPage, recordStructureSkeletons);

    expect(outcome.visitedPageCount).toBe(2);
    expect(recordedPages[0]).toMatchObject({
      url: "https://www.example.com/",
      requestedUrl: "http://example.com/",
      finalUrl: "https://www.example.com/",
      wasRedirected: true,
      linkedUrls: ["https://www.example.com/about"],
    });
    expect(readVisitedUrls()).toEqual(["https://www.example.com/", "https://www.example.com/about"]);
  });

  it("records a page that redirected off-site, but neither reads nor follows its links", async () => {
    installFakeSite({
      "https://example.com/": { hrefs: ["/out"] },
      "https://example.com/out": {
        finalUrl: "https://other.example/landing",
        hrefs: ["/elsewhere"],
      },
    });

    await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage, recordStructureSkeletons);

    expect(findRecordedPage("https://other.example/landing")).toMatchObject({
      requestedUrl: "https://example.com/out",
      finalUrl: "https://other.example/landing",
      wasRedirected: true,
      succeeded: true,
      linkedUrls: [],
    });
    expect(mockLinkLocator.evaluateAll).toHaveBeenCalledTimes(1);
    expect(readVisitedUrls()).toHaveLength(2);
  });

  it("records a redirected page under where it landed, and never loads that page again", async () => {
    installFakeSite({
      "https://example.com/": { hrefs: ["/old"] },
      "https://example.com/old": {
        finalUrl: "https://example.com/new",
        hrefs: ["/new", "/next"],
      },
      "https://example.com/next": {},
    });

    await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage, recordStructureSkeletons);

    expect(readVisitedUrls()).toEqual([
      "https://example.com/",
      "https://example.com/new",
      "https://example.com/next",
    ]);
    expect(findRecordedPage("https://example.com/new")).toMatchObject({
      requestedUrl: "https://example.com/old",
      wasRedirected: true,
      linkedUrls: ["https://example.com/new", "https://example.com/next"],
    });
    expect(mockPage.goto).toHaveBeenCalledTimes(3);
  });

  it("records a page whose navigation threw as failed, with the error's first line, and keeps crawling", async () => {
    installFakeSite({
      "https://example.com/": { hrefs: ["/report.pdf", "/ok"] },
      "https://example.com/report.pdf": {
        gotoError: new Error("page.goto: Download is starting\nCall log:\n  - navigating"),
      },
      "https://example.com/ok": {},
    });

    const outcome = await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage, recordStructureSkeletons);

    expect(outcome.stopReason).toBe("finished");
    expect(findRecordedPage("https://example.com/report.pdf")).toEqual({
      parentPageId: "page-0",
      url: "https://example.com/report.pdf",
      requestedUrl: "https://example.com/report.pdf",
      finalUrl: "https://example.com/report.pdf",
      wasRedirected: false,
      foundByButtonText: null,
      buttonUrls: [],
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

    await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage, recordStructureSkeletons);

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

    await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage, recordStructureSkeletons);

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

    await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage, recordStructureSkeletons);

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

    await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage, recordStructureSkeletons);

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

    await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage, recordStructureSkeletons);

    expect(recordedPages.map((recordedPage) => recordedPage.title)).toEqual([null, null]);
    expect(recordedPages[1].succeeded).toBe(true);
  });

  it("follows no links when the start page's final URL cannot be parsed", async () => {
    installFakeSite({ "https://example.com/": { finalUrl: "", hrefs: ["/next"] } });

    const outcome = await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage, recordStructureSkeletons);

    expect(outcome).toEqual({
      stopReason: "finished",
      visitedPageCount: 1,
      waitingUrlCount: 0,
      skippedSimilarUrlCount: 0,
      skippedSimilarUrlCountsByPattern: {},
      loginErrorMessage: null,
      loginFailureScreenshotWasCaptured: false,
    });
    expect(recordedPages[0]).toMatchObject({ finalUrl: "", linkedUrls: [] });
    expect(mockLinkLocator.evaluateAll).not.toHaveBeenCalled();
  });

  it("identifies a start URL it cannot normalize by the URL itself", async () => {
    installFakeSite({});

    await crawlWebsite("not a url", TIMING_SETTINGS, recordVisitedPage, recordStructureSkeletons);

    expect(recordedPages[0]).toMatchObject({
      url: "not a url",
      requestedUrl: "not a url",
      succeeded: false,
    });
  });

  it("records the start page under where it was redirected to, like a home page that sends a logged-in user to the calendar", async () => {
    installFakeSite({
      "https://example.com/": {
        finalUrl: "https://example.com/calendar",
        title: "Calendar",
        hrefs: ["/", "/calendar", "/schools"],
      },
      "https://example.com/schools": {},
    });

    await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage, recordStructureSkeletons);

    expect(readVisitedUrls()).toEqual([
      "https://example.com/calendar",
      "https://example.com/schools",
    ]);
    expect(recordedPages[0]).toMatchObject({
      url: "https://example.com/calendar",
      requestedUrl: "https://example.com/",
      finalUrl: "https://example.com/calendar",
      wasRedirected: true,
      parentPageId: null,
      title: "Calendar",
    });
    expect(findRecordedPage("https://example.com/schools").wasRedirected).toBe(false);
  });

  it("takes a page a redirect landed on off the queue, so it is recorded once and never visited again", async () => {
    installFakeSite({
      "https://example.com/": { hrefs: ["/shortcut", "/settings", "/other"] },
      "https://example.com/shortcut": { finalUrl: "https://example.com/settings" },
      "https://example.com/settings": {},
      "https://example.com/other": {},
    });

    const outcome = await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage, recordStructureSkeletons);

    expect(readVisitedUrls()).toEqual([
      "https://example.com/",
      "https://example.com/settings",
      "https://example.com/other",
    ]);
    expect(findRecordedPage("https://example.com/settings")).toMatchObject({
      requestedUrl: "https://example.com/shortcut",
      wasRedirected: true,
    });
    expect(mockPage.goto).not.toHaveBeenCalledWith("https://example.com/settings", expect.anything());
    expect(recordedProgress[1]).toEqual({ visitedPageCount: 2, waitingUrlCount: 1 });
    expect(outcome.visitedPageCount).toBe(3);
  });

  it("records a page that redirected onto an already-recorded page under the URL it was requested at", async () => {
    installFakeSite({
      "https://example.com/": { hrefs: ["/account", "/old-account"] },
      "https://example.com/account": {},
      "https://example.com/old-account": { finalUrl: "https://example.com/account" },
    });

    await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage, recordStructureSkeletons);

    expect(readVisitedUrls()).toEqual([
      "https://example.com/",
      "https://example.com/account",
      "https://example.com/old-account",
    ]);
    expect(findRecordedPage("https://example.com/old-account")).toMatchObject({
      requestedUrl: "https://example.com/old-account",
      finalUrl: "https://example.com/account",
      wasRedirected: true,
    });
    expect(findRecordedPage("https://example.com/account").wasRedirected).toBe(false);
  });

  it("does not count a change of query string as a redirect", async () => {
    installFakeSite({
      "https://example.com/": { hrefs: ["/search?q=shoes"] },
      "https://example.com/search?q=shoes": { finalUrl: "https://example.com/search?q=shoes&page=1" },
    });

    await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage, recordStructureSkeletons);

    expect(findRecordedPage("https://example.com/search")).toMatchObject({
      finalUrl: "https://example.com/search?q=shoes&page=1",
      wasRedirected: false,
    });
  });

  it("records a redirected page that never became ready under where it landed too", async () => {
    installFakeSite({
      "https://example.com/": { hrefs: ["/slow"] },
      "https://example.com/slow": { finalUrl: "https://example.com/slow-landing" },
    });
    mockPage.waitForLoadState.mockImplementation(() =>
      loadedUrl === "https://example.com/slow"
        ? Promise.reject(new Error("page.waitForLoadState: Target closed"))
        : Promise.resolve(undefined),
    );

    await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage, recordStructureSkeletons);

    expect(findRecordedPage("https://example.com/slow-landing")).toMatchObject({
      requestedUrl: "https://example.com/slow",
      wasRedirected: true,
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

    const outcome = await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage, recordStructureSkeletons);

    expect(outcome).toEqual({
      stopReason: "stoppedAtPageLimit",
      visitedPageCount: CRAWL_PAGE_LIMIT,
      waitingUrlCount: linkedPageCount + 1 - CRAWL_PAGE_LIMIT,
      skippedSimilarUrlCount: 0,
      skippedSimilarUrlCountsByPattern: {},
      loginErrorMessage: null,
      loginFailureScreenshotWasCaptured: false,
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

    const outcome = await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage, recordStructureSkeletons);

    expect(outcome).toEqual({
      stopReason: "stoppedAtTimeLimit",
      visitedPageCount: 2,
      waitingUrlCount: 2,
      skippedSimilarUrlCount: 0,
      skippedSimilarUrlCountsByPattern: {},
      loginErrorMessage: null,
      loginFailureScreenshotWasCaptured: false,
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

    const outcome = await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage, recordStructureSkeletons);

    expect(outcome).toEqual({
      stopReason: "stoppedBecauseRunWasDeleted",
      visitedPageCount: 2,
      waitingUrlCount: 1,
      skippedSimilarUrlCount: 0,
      skippedSimilarUrlCountsByPattern: {},
      loginErrorMessage: null,
      loginFailureScreenshotWasCaptured: false,
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

    const outcome = await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage, recordStructureSkeletons);

    expect(outcome).toEqual({
      stopReason: "stoppedBecauseBrowserClosed",
      visitedPageCount: 1,
      waitingUrlCount: 3,
      skippedSimilarUrlCount: 0,
      skippedSimilarUrlCountsByPattern: {},
      loginErrorMessage: null,
      loginFailureScreenshotWasCaptured: false,
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

    const outcome = await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage, recordStructureSkeletons);

    expect(outcome).toEqual({
      stopReason: "stoppedBecauseBrowserClosed",
      visitedPageCount: 1,
      waitingUrlCount: 2,
      skippedSimilarUrlCount: 0,
      skippedSimilarUrlCountsByPattern: {},
      loginErrorMessage: null,
      loginFailureScreenshotWasCaptured: false,
    });
    expect(readVisitedUrls()).toEqual(["https://example.com/"]);
  });

  it("rejects with the recorder's error, and still closes the browser", async () => {
    installFakeSite({ "https://example.com/": {} });
    const databaseError = new Error("connection terminated");
    recordVisitedPage.mockRejectedValue(databaseError);

    await expect(crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage, recordStructureSkeletons)).rejects.toBe(
      databaseError,
    );
    expect(mockBrowser.close).toHaveBeenCalledTimes(1);
  });

  it("rejects without recording anything when the browser cannot launch", async () => {
    const launchError = new Error("Executable doesn't exist at /ms-playwright/chromium");
    mockChromium.launch.mockRejectedValue(launchError);

    await expect(crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage, recordStructureSkeletons)).rejects.toBe(
      launchError,
    );
    expect(recordVisitedPage).not.toHaveBeenCalled();
  });

  it("logs, but does not fail the crawl, when the browser cannot be closed", async () => {
    installFakeSite({ "https://example.com/": {} });
    mockBrowser.close.mockRejectedValue(new Error("browser already gone"));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const outcome = await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage, recordStructureSkeletons);

    expect(outcome.stopReason).toBe("finished");
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[playwright] could not close the browser: browser already gone",
    );
  });

  /** A start page linking to 5 product pages (an id pattern) and an About page that links one of them again. */
  const SITE_WITH_PRODUCTS: Record<string, FakeSitePage> = {
    "https://example.com/": {
      hrefs: ["/products/1", "/products/2", "/products/3", "/products/4", "/products/5", "/about"],
    },
    "https://example.com/products/1": {},
    "https://example.com/products/2": {},
    "https://example.com/products/3": {},
    "https://example.com/products/4": {},
    "https://example.com/products/5": {},
    "https://example.com/about": { hrefs: ["/products/4"] },
  };

  it("visits at most 3 pages of one URL pattern, counting the skipped links once each, and still lists them", async () => {
    installFakeSite(SITE_WITH_PRODUCTS);

    const outcome = await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage, recordStructureSkeletons);

    expect(outcome).toEqual({
      stopReason: "finished",
      visitedPageCount: 5,
      waitingUrlCount: 0,
      skippedSimilarUrlCount: 2,
      skippedSimilarUrlCountsByPattern: { "/products/{product}": 2 },
      loginErrorMessage: null,
      loginFailureScreenshotWasCaptured: false,
    });
    expect(readVisitedUrls()).toEqual([
      "https://example.com/",
      "https://example.com/products/1",
      "https://example.com/products/2",
      "https://example.com/products/3",
      "https://example.com/about",
    ]);
    expect(findRecordedPage("https://example.com/").linkedUrls).toHaveLength(6);
    expect(findRecordedPage("https://example.com/about").linkedUrls).toEqual(["https://example.com/products/4"]);
    expect(recordedProgress[0]).toEqual({ visitedPageCount: 1, waitingUrlCount: 4 });
  });

  it("drops the queued pages of a slug pattern once 3 visited sibling pages built alike confirm it", async () => {
    installFakeSite({
      "https://example.com/": {
        hrefs: ["/blog/a", "/blog/b", "/blog/c", "/blog/d", "/blog/e"],
        ariaSnapshot: '- heading "Home" [level=1]\n- list:\n  - listitem: x',
      },
      "https://example.com/blog/a": { ariaSnapshot: '- heading "A" [level=1]\n- paragraph: a' },
      "https://example.com/blog/b": { ariaSnapshot: '- heading "B" [level=1]\n- paragraph: b' },
      "https://example.com/blog/c": { ariaSnapshot: '- heading "C" [level=1]\n- paragraph: c' },
      "https://example.com/blog/d": {},
      "https://example.com/blog/e": {},
    });

    const outcome = await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage, recordStructureSkeletons);

    expect(readVisitedUrls()).toEqual([
      "https://example.com/",
      "https://example.com/blog/a",
      "https://example.com/blog/b",
      "https://example.com/blog/c",
    ]);
    expect(outcome).toMatchObject({
      stopReason: "finished",
      waitingUrlCount: 0,
      skippedSimilarUrlCount: 2,
      skippedSimilarUrlCountsByPattern: { "/blog/{blog}": 2 },
    });
    expect(recordedPages.some((recordedPage) => "structureSkeleton" in recordedPage)).toBe(false);
    expect(recordStructureSkeletons).toHaveBeenCalledTimes(1);
    expect(savedStructureSkeletons).toEqual(
      ["page-1", "page-2", "page-3"].map((crawledPageId) => ({
        crawledPageId,
        structureSkeleton: "heading[level=1]\nparagraph",
      })),
    );
  });

  it("builds no structure skeleton for pages whose URL has too few siblings to be a slug", async () => {
    installFakeSite({
      "https://example.com/": { hrefs: ["/about", "/pricing", "/contact", "/blog/a", "/blog/b"] },
      "https://example.com/about": {},
      "https://example.com/pricing": {},
      "https://example.com/contact": {},
      "https://example.com/blog/a": {},
      "https://example.com/blog/b": {},
    });

    const outcome = await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage, recordStructureSkeletons);

    expect(outcome.visitedPageCount).toBe(6);
    expect(recordStructureSkeletons).not.toHaveBeenCalled();
  });

  it("stops as soon as saving the structure skeletons finds the run deleted", async () => {
    installFakeSite({
      "https://example.com/": { hrefs: ["/blog/a", "/blog/b", "/blog/c", "/about"] },
      "https://example.com/blog/a": {},
      "https://example.com/blog/b": {},
      "https://example.com/blog/c": {},
      "https://example.com/about": {},
    });
    recordStructureSkeletons.mockResolvedValue(false);

    const outcome = await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage, recordStructureSkeletons);

    expect(outcome).toMatchObject({ stopReason: "stoppedBecauseRunWasDeleted", visitedPageCount: 4 });
    expect(readVisitedUrls()).not.toContain("https://example.com/about");
    expect(recordStructureSkeletons).toHaveBeenCalledTimes(1);
  });

  it("samples every crawl from scratch: a second crawl skips exactly what the first one did", async () => {
    installFakeSite(SITE_WITH_PRODUCTS);

    const firstOutcome = await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage, recordStructureSkeletons);
    const firstVisitedUrls = readVisitedUrls();
    recordedPages = [];
    const secondOutcome = await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage, recordStructureSkeletons);

    expect(secondOutcome).toEqual(firstOutcome);
    expect(readVisitedUrls()).toEqual(firstVisitedUrls);
  });

  it("never skips the start page, even when it is a page of a pattern", async () => {
    installFakeSite({
      "https://example.com/products/1": { hrefs: ["/products/2", "/products/3", "/products/4"] },
      "https://example.com/products/2": {},
      "https://example.com/products/3": {},
      "https://example.com/products/4": {},
    });

    const outcome = await crawlWebsite("https://example.com/products/1", TIMING_SETTINGS, recordVisitedPage, recordStructureSkeletons);

    expect(readVisitedUrls()).toEqual([
      "https://example.com/products/1",
      "https://example.com/products/2",
      "https://example.com/products/3",
    ]);
    expect(outcome.skippedSimilarUrlCount).toBe(1);
  });
});

describe("crawlWebsite with a login", () => {
  /** Where a failed login's screenshot is written. */
  const FAILURE_SCREENSHOT_PATH = "/screenshots/website-1/failed-login.png";
  /** Records the login's success; `beforeEach` makes it say the run is still active. */
  const recordLoginSucceeded = vi.fn<() => Promise<boolean>>();
  /** The login handed to the crawler. */
  const crawlLogin: CrawlLogin = {
    details: {
      loginUrl: "https://example.com/login",
      username: "admin@example.com",
      password: "correct horse",
      usernameSelector: null,
      passwordSelector: null,
      submitSelector: null,
    },
    failureScreenshotPath: FAILURE_SCREENSHOT_PATH,
    recordLoginSucceeded,
  };

  /** A site whose dashboard links to a logout page and a settings page. */
  const SITE_WITH_LOGOUT_LINKS: Record<string, FakeSitePage> = {
    "https://example.com/": { hrefs: ["/dashboard"] },
    "https://example.com/dashboard": {
      hrefs: ["/settings", "/logout", "/users/sign_out", "/auth/log-off.php"],
    },
    "https://example.com/settings": {},
    "https://example.com/logout": {},
    "https://example.com/users/sign_out": {},
    "https://example.com/auth/log-off.php": {},
  };

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
    mockPage.url.mockImplementation(() => currentUrl);
    mockPage.title.mockImplementation(() => Promise.resolve(readShownPage().title ?? ""));
    mockPage.locator.mockImplementation((selector: string) =>
      selector === "body" ? mockBodyLocator : mockLinkLocator,
    );
    mockBodyLocator.ariaSnapshot.mockImplementation(() =>
      Promise.resolve(`- text: ${currentUrl}`),
    );
    mockLinkLocator.evaluateAll.mockImplementation(() =>
      Promise.resolve({ baseUrl: currentUrl, hrefs: readShownPage().hrefs ?? [] }),
    );
    recordVisitedPage.mockImplementation((visitedPage, progress) => {
      recordedPages.push(visitedPage);
      recordedProgress.push(progress);
      return Promise.resolve(`page-${String(visitedPage.visitOrder)}`);
    });
    savedStructureSkeletons = [];
    recordStructureSkeletons.mockImplementation((structureSkeletons) => {
      savedStructureSkeletons.push(...structureSkeletons);
      return Promise.resolve(true);
    });
    recordLoginSucceeded.mockResolvedValue(true);
    mockCrawlerLoginService.logInWithCredential.mockResolvedValue({ loggedIn: true });
    mockCrawlerLoginService.captureLoginFailureScreenshot.mockResolvedValue(true);
    installFakeSite(SITE_WITH_LOGOUT_LINKS);
  });

  it("logs in on the crawl's own page first, records the success, and only then visits and records pages", async () => {
    const outcome = await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage, recordStructureSkeletons, crawlLogin);

    expect(mockCrawlerLoginService.logInWithCredential).toHaveBeenCalledWith(
      mockPage,
      crawlLogin.details,
      TIMING_SETTINGS,
    );
    const loginOrder = mockCrawlerLoginService.logInWithCredential.mock.invocationCallOrder[0];
    const loginRecordOrder = recordLoginSucceeded.mock.invocationCallOrder[0];
    const firstVisitOrder = mockPage.goto.mock.invocationCallOrder[0];
    const firstPageRecordOrder = recordVisitedPage.mock.invocationCallOrder[0];
    expect(loginOrder).toBeLessThan(loginRecordOrder);
    expect(loginRecordOrder).toBeLessThan(firstVisitOrder);
    expect(loginRecordOrder).toBeLessThan(firstPageRecordOrder);
    expect(outcome).toEqual({
      stopReason: "finished",
      visitedPageCount: 3,
      waitingUrlCount: 0,
      skippedSimilarUrlCount: 0,
      skippedSimilarUrlCountsByPattern: {},
      loginErrorMessage: null,
      loginFailureScreenshotWasCaptured: false,
    });
    expect(mockCrawlerLoginService.captureLoginFailureScreenshot).not.toHaveBeenCalled();
  });

  it("never follows logout links while logged in, but still lists them on the page", async () => {
    await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage, recordStructureSkeletons, crawlLogin);

    expect(readVisitedUrls()).toEqual([
      "https://example.com/",
      "https://example.com/dashboard",
      "https://example.com/settings",
    ]);
    expect(findRecordedPage("https://example.com/dashboard").linkedUrls).toEqual([
      "https://example.com/settings",
      "https://example.com/logout",
      "https://example.com/users/sign_out",
      "https://example.com/auth/log-off.php",
    ]);
  });

  it("follows logout links like any other when crawling logged out, and never tries to log in", async () => {
    const outcome = await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage, recordStructureSkeletons, null);

    expect(mockCrawlerLoginService.logInWithCredential).not.toHaveBeenCalled();
    expect(readVisitedUrls()).toContain("https://example.com/logout");
    expect(readVisitedUrls()).toContain("https://example.com/users/sign_out");
    expect(outcome.visitedPageCount).toBe(6);
  });

  it("screenshots a failed login, then stops without visiting or recording any page", async () => {
    mockCrawlerLoginService.logInWithCredential.mockResolvedValue({
      loggedIn: false,
      errorMessage: "Still on the login form after submitting - check the username and password",
    });

    const outcome = await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage, recordStructureSkeletons, crawlLogin);

    expect(mockCrawlerLoginService.captureLoginFailureScreenshot).toHaveBeenCalledWith(
      mockPage,
      FAILURE_SCREENSHOT_PATH,
    );
    expect(outcome).toEqual({
      stopReason: "loginFailed",
      visitedPageCount: 0,
      waitingUrlCount: 0,
      skippedSimilarUrlCount: 0,
      skippedSimilarUrlCountsByPattern: {},
      loginErrorMessage: "Still on the login form after submitting - check the username and password",
      loginFailureScreenshotWasCaptured: true,
    });
    expect(mockPage.goto).not.toHaveBeenCalled();
    expect(recordVisitedPage).not.toHaveBeenCalled();
    expect(recordLoginSucceeded).not.toHaveBeenCalled();
    expect(mockBrowser.close).toHaveBeenCalledTimes(1);
  });

  it("reports a failed login whose screenshot could not be taken", async () => {
    mockCrawlerLoginService.logInWithCredential.mockResolvedValue({
      loggedIn: false,
      errorMessage: "No visible password field was found on the login page (found automatically)",
    });
    mockCrawlerLoginService.captureLoginFailureScreenshot.mockResolvedValue(false);

    const outcome = await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage, recordStructureSkeletons, crawlLogin);

    expect(outcome.stopReason).toBe("loginFailed");
    expect(outcome.loginFailureScreenshotWasCaptured).toBe(false);
  });

  it("stops as interrupted, with no screenshot and nothing recorded, when the browser closes while logging in", async () => {
    mockCrawlerLoginService.logInWithCredential.mockImplementation(() => {
      mockBrowser.isConnected.mockReturnValue(false);
      return Promise.resolve({ loggedIn: false, errorMessage: "Target page has been closed" });
    });

    const outcome = await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage, recordStructureSkeletons, crawlLogin);

    expect(outcome.stopReason).toBe("stoppedBecauseBrowserClosed");
    expect(outcome.loginErrorMessage).toBeNull();
    expect(mockCrawlerLoginService.captureLoginFailureScreenshot).not.toHaveBeenCalled();
    expect(recordVisitedPage).not.toHaveBeenCalled();
  });

  it("stops without visiting anything when the run is gone by the time the login worked", async () => {
    recordLoginSucceeded.mockResolvedValue(false);

    const outcome = await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage, recordStructureSkeletons, crawlLogin);

    expect(outcome.stopReason).toBe("stoppedBecauseRunWasDeleted");
    expect(outcome.visitedPageCount).toBe(0);
    expect(mockPage.goto).not.toHaveBeenCalled();
    expect(recordVisitedPage).not.toHaveBeenCalled();
  });
});

/**
 * Builds a button link the way `followPageButtons` reports one.
 * @param buttonText - The clicked button's label
 * @param loadUrl - Where the click landed (hash already dropped)
 * @returns The button link, its identity being the URL without its query string
 */
function buildButtonLink(buttonText: string, loadUrl: string): ButtonLink {
  const identityUrl = loadUrl.split("?")[0];
  return { buttonText, link: { identityUrl, loadUrl } };
}

describe("crawlWebsite with buttons", () => {
  /** A site whose start page links to /about and has buttons leading to two sessions. */
  const SITE_WITH_BUTTONS: Record<string, FakeSitePage> = {
    "https://example.com/": {
      hrefs: ["/about"],
      buttonLinks: [
        buildButtonLink("Open Yoga", "https://example.com/sessions/yoga"),
        buildButtonLink("Open Pilates", "https://example.com/sessions/pilates?day=mon"),
        buildButtonLink("View yoga", "https://example.com/sessions/yoga"),
      ],
    },
    "https://example.com/about": {},
    "https://example.com/sessions/yoga": {},
    "https://example.com/sessions/pilates?day=mon": {},
  };

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
    mockPage.url.mockImplementation(() => currentUrl);
    mockPage.title.mockImplementation(() => Promise.resolve(readShownPage().title ?? ""));
    mockPage.locator.mockImplementation((selector: string) =>
      selector === "body" ? mockBodyLocator : mockLinkLocator,
    );
    mockBodyLocator.ariaSnapshot.mockImplementation(() => Promise.resolve(`- text: ${currentUrl}`));
    mockLinkLocator.evaluateAll.mockImplementation(() =>
      Promise.resolve({ baseUrl: currentUrl, hrefs: readShownPage().hrefs ?? [] }),
    );
    mockCrawlerButtonService.followPageButtons.mockImplementation(() =>
      Promise.resolve(readShownPage().buttonLinks ?? []),
    );
    recordVisitedPage.mockImplementation((visitedPage, progress) => {
      recordedPages.push(visitedPage);
      recordedProgress.push(progress);
      return Promise.resolve(`page-${String(visitedPage.visitOrder)}`);
    });
    savedStructureSkeletons = [];
    recordStructureSkeletons.mockImplementation((structureSkeletons) => {
      savedStructureSkeletons.push(...structureSkeletons);
      return Promise.resolve(true);
    });
    installFakeSite(SITE_WITH_BUTTONS);
  });

  it("never clicks buttons, nor watches for pop-ups, when no button mode is given (links only)", async () => {
    await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage, recordStructureSkeletons);

    expect(mockCrawlerButtonService.followPageButtons).not.toHaveBeenCalled();
    expect(mockPage.on).not.toHaveBeenCalled();
    expect(readVisitedUrls()).toEqual(["https://example.com/", "https://example.com/about"]);
    expect(findRecordedPage("https://example.com/")).toMatchObject({
      foundByButtonText: null,
      buttonUrls: [],
    });
  });

  it("never clicks buttons when the mode is linksOnly, even while logged in", async () => {
    mockCrawlerLoginService.logInWithCredential.mockResolvedValue({ loggedIn: true });
    const crawlLogin: CrawlLogin = {
      details: {
        loginUrl: "https://example.com/login",
        username: "admin@example.com",
        password: "correct horse",
        usernameSelector: null,
        passwordSelector: null,
        submitSelector: null,
      },
      failureScreenshotPath: "/screenshots/website-1/failed-login.png",
      recordLoginSucceeded: () => Promise.resolve(true),
    };

    const outcome = await crawlWebsite(
      START_URL,
      TIMING_SETTINGS,
      recordVisitedPage,
      recordStructureSkeletons,
      crawlLogin,
      "linksOnly",
    );

    expect(outcome.visitedPageCount).toBe(2);
    expect(mockCrawlerButtonService.followPageButtons).not.toHaveBeenCalled();
    expect(mockPage.on).not.toHaveBeenCalled();
  });

  it.each(["allButRisky", "openOnly"] as const)(
    "in %s mode, clicks a page's buttons after reading its snapshot, title, and links, from its final URL",
    async (buttonMode) => {
      installFakeSite({
        "https://example.com/": { finalUrl: "https://example.com/home?tab=1", title: "Home" },
      });

      await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage, recordStructureSkeletons, null, buttonMode);

      expect(mockCrawlerButtonService.followPageButtons).toHaveBeenCalledTimes(1);
      expect(mockCrawlerButtonService.followPageButtons).toHaveBeenCalledWith(
        mockPage,
        "https://example.com/home?tab=1",
        "https://example.com/home",
        "https://example.com",
        buttonMode,
        TIMING_SETTINGS,
      );
      const buttonsOrder = mockCrawlerButtonService.followPageButtons.mock.invocationCallOrder[0];
      expect(mockBodyLocator.ariaSnapshot.mock.invocationCallOrder[0]).toBeLessThan(buttonsOrder);
      expect(mockPage.title.mock.invocationCallOrder[0]).toBeLessThan(buttonsOrder);
      expect(mockLinkLocator.evaluateAll.mock.invocationCallOrder[0]).toBeLessThan(buttonsOrder);
    },
  );

  it("queues the new pages buttons led to after the page's links, found by their button, and lists them in buttonUrls", async () => {
    const outcome = await crawlWebsite(
      START_URL,
      TIMING_SETTINGS,
      recordVisitedPage,
      recordStructureSkeletons,
      null,
      "allButRisky",
    );

    expect(readVisitedUrls()).toEqual([
      "https://example.com/",
      "https://example.com/about",
      "https://example.com/sessions/yoga",
      "https://example.com/sessions/pilates",
    ]);
    expect(findRecordedPage("https://example.com/")).toMatchObject({
      foundByButtonText: null,
      buttonUrls: ["https://example.com/sessions/yoga", "https://example.com/sessions/pilates"],
      linkedUrls: ["https://example.com/about"],
    });
    expect(findRecordedPage("https://example.com/about").foundByButtonText).toBeNull();
    expect(findRecordedPage("https://example.com/sessions/yoga")).toMatchObject({
      foundByButtonText: "Open Yoga",
      parentPageId: "page-0",
      depth: 1,
      succeeded: true,
    });
    expect(findRecordedPage("https://example.com/sessions/pilates")).toMatchObject({
      requestedUrl: "https://example.com/sessions/pilates?day=mon",
      foundByButtonText: "Open Pilates",
      parentPageId: "page-0",
      depth: 1,
    });
    expect(recordedProgress[0]).toEqual({ visitedPageCount: 1, waitingUrlCount: 3 });
    expect(outcome.visitedPageCount).toBe(4);
  });

  it("counts a page reachable both by a link and by a button as found by the link, and never queues an already-seen page again", async () => {
    installFakeSite({
      "https://example.com/": {
        hrefs: ["/sessions/yoga"],
        buttonLinks: [
          buildButtonLink("Open Yoga", "https://example.com/sessions/yoga"),
          buildButtonLink("Back home", "https://example.com/"),
        ],
      },
      "https://example.com/sessions/yoga": {
        buttonLinks: [buildButtonLink("Open start", "https://example.com/")],
      },
    });

    await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage, recordStructureSkeletons, null, "allButRisky");

    expect(readVisitedUrls()).toEqual(["https://example.com/", "https://example.com/sessions/yoga"]);
    expect(findRecordedPage("https://example.com/sessions/yoga").foundByButtonText).toBeNull();
    expect(findRecordedPage("https://example.com/").buttonUrls).toEqual([
      "https://example.com/sessions/yoga",
      "https://example.com/",
    ]);
    expect(findRecordedPage("https://example.com/sessions/yoga").buttonUrls).toEqual([
      "https://example.com/",
    ]);
  });

  it("skips a button's page whose URL pattern already has 3 pages, but still lists it in buttonUrls", async () => {
    installFakeSite({
      "https://example.com/": {
        hrefs: ["/orders/1", "/orders/2", "/orders/3"],
        buttonLinks: [buildButtonLink("Open order", "https://example.com/orders/4")],
      },
      "https://example.com/orders/1": {},
      "https://example.com/orders/2": {},
      "https://example.com/orders/3": {},
      "https://example.com/orders/4": {},
    });

    const outcome = await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage, recordStructureSkeletons, null, "allButRisky");

    expect(readVisitedUrls()).not.toContain("https://example.com/orders/4");
    expect(findRecordedPage("https://example.com/").buttonUrls).toEqual(["https://example.com/orders/4"]);
    expect(outcome.skippedSimilarUrlCountsByPattern).toEqual({ "/orders/{order}": 1 });
  });

  it("never follows a button to a logout-looking page while logged in, but still lists it", async () => {
    mockCrawlerLoginService.logInWithCredential.mockResolvedValue({ loggedIn: true });
    installFakeSite({
      "https://example.com/": {
        buttonLinks: [
          buildButtonLink("Leave", "https://example.com/users/sign_out"),
          buildButtonLink("Open Yoga", "https://example.com/sessions/yoga"),
        ],
      },
      "https://example.com/users/sign_out": {},
      "https://example.com/sessions/yoga": {},
    });
    const crawlLogin: CrawlLogin = {
      details: {
        loginUrl: "https://example.com/login",
        username: "admin@example.com",
        password: "correct horse",
        usernameSelector: null,
        passwordSelector: null,
        submitSelector: null,
      },
      failureScreenshotPath: "/screenshots/website-1/failed-login.png",
      recordLoginSucceeded: () => Promise.resolve(true),
    };

    await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage, recordStructureSkeletons, crawlLogin, "allButRisky");

    expect(readVisitedUrls()).toEqual(["https://example.com/", "https://example.com/sessions/yoga"]);
    expect(findRecordedPage("https://example.com/").buttonUrls).toEqual([
      "https://example.com/users/sign_out",
      "https://example.com/sessions/yoga",
    ]);
  });

  it("follows a button to a logout-looking page like any other when crawling logged out", async () => {
    installFakeSite({
      "https://example.com/": {
        buttonLinks: [buildButtonLink("Leave", "https://example.com/users/sign_out")],
      },
      "https://example.com/users/sign_out": {},
    });

    await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage, recordStructureSkeletons, null, "allButRisky");

    expect(findRecordedPage("https://example.com/users/sign_out").foundByButtonText).toBe("Leave");
  });

  it("clicks no buttons on a page that failed, redirected off-site, or whose snapshot could not be taken", async () => {
    installFakeSite({
      "https://example.com/": { hrefs: ["/missing", "/out", "/broken"] },
      "https://example.com/missing": {
        httpStatus: 404,
        buttonLinks: [buildButtonLink("Open A", "https://example.com/a")],
      },
      "https://example.com/out": {
        finalUrl: "https://other.example/landing",
        buttonLinks: [buildButtonLink("Open B", "https://example.com/b")],
      },
      "https://example.com/broken": {
        buttonLinks: [buildButtonLink("Open C", "https://example.com/c")],
      },
    });
    mockBodyLocator.ariaSnapshot.mockImplementation(() =>
      loadedUrl === "https://example.com/broken"
        ? Promise.reject(new Error("locator.ariaSnapshot: Timeout 10000ms exceeded."))
        : Promise.resolve(`- text: ${currentUrl}`),
    );

    await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage, recordStructureSkeletons, null, "allButRisky");

    expect(mockCrawlerButtonService.followPageButtons).toHaveBeenCalledTimes(1);
    expect(mockCrawlerButtonService.followPageButtons).toHaveBeenCalledWith(
      mockPage,
      "https://example.com/",
      "https://example.com/",
      "https://example.com",
      "allButRisky",
      TIMING_SETTINGS,
    );
    expect(readVisitedUrls()).toHaveLength(4);
    expect(recordedPages.every((recordedPage) => recordedPage.buttonUrls.length === 0)).toBe(true);
  });

  it("keeps the button's label on a page it led to that could not be loaded", async () => {
    installFakeSite({
      "https://example.com/": {
        buttonLinks: [buildButtonLink("Open report", "https://example.com/report.pdf")],
      },
      "https://example.com/report.pdf": {
        gotoError: new Error("page.goto: Download is starting\nCall log:\n  - navigating"),
      },
    });

    await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage, recordStructureSkeletons, null, "openOnly");

    expect(findRecordedPage("https://example.com/report.pdf")).toMatchObject({
      foundByButtonText: "Open report",
      buttonUrls: [],
      succeeded: false,
      parentPageId: "page-0",
    });
  });

  it("closes every pop-up window a click opens, without failing when one is already gone", async () => {
    await crawlWebsite(START_URL, TIMING_SETTINGS, recordVisitedPage, recordStructureSkeletons, null, "openOnly");

    expect(mockPage.on).toHaveBeenCalledTimes(1);
    expect(mockPage.on).toHaveBeenCalledWith("popup", expect.any(Function));
    const popupHandler = mockPage.on.mock.calls[0][1] as (popup: { close: () => Promise<void> }) => void;
    const openPopup = { close: vi.fn(() => Promise.resolve()) };
    const goneAlreadyPopup = {
      close: vi.fn(() => Promise.reject(new Error("page.close: Target page has been closed"))),
    };

    popupHandler(openPopup);
    popupHandler(goneAlreadyPopup);
    await Promise.resolve();

    expect(openPopup.close).toHaveBeenCalledTimes(1);
    expect(goneAlreadyPopup.close).toHaveBeenCalledTimes(1);
  });
});

describe("isLogoutLink", () => {
  it.each([
    "https://example.com/logout",
    "https://example.com/LogOut",
    "https://example.com/log-out",
    "https://example.com/log_out",
    "https://example.com/signout",
    "https://example.com/sign-out",
    "https://example.com/users/sign_out",
    "https://example.com/logoff",
    "https://example.com/auth/log-off.php",
    "https://example.com/account/logout/confirm",
  ])("treats %s as a logout link", (identityUrl) => {
    expect(isLogoutLink(identityUrl)).toBe(true);
  });

  it.each([
    "https://example.com/",
    "https://example.com/blog/outing",
    "https://example.com/catalogout",
    "https://example.com/login",
    "https://example.com/signup",
    "https://logout.example.com/dashboard",
    "not a url",
  ])("does not treat %s as a logout link", (identityUrl) => {
    expect(isLogoutLink(identityUrl)).toBe(false);
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
