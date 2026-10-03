import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type {
  CrawledPageInput,
  Credential,
  Website,
} from "../../../server/services/dbService.js";
import type {
  CrawlLogin,
  CrawlOutcome,
  RecordVisitedPage,
} from "../../../server/services/crawlerService.js";

/**
 * The database and the browser are both replaced: this spec is about how a
 * crawl is started, guarded, recorded, and finished. `crawlWebsite` is a mock
 * whose outcome each test controls; `measureElapsedMs` is pinned so recorded
 * durations are predictable.
 */
const { mockDbService, mockCrawlerService, mockPlaywrightService, mockCredentialEncryption } =
  vi.hoisted(() => ({
    mockDbService: {
      adoptWebsiteLoginUrl: vi.fn(),
      createCrawlRunForWebsite: vi.fn(),
      recordCrawledPage: vi.fn(),
      markCrawlRunLoggedIn: vi.fn(),
      finishCrawlRun: vi.fn(),
      markRunningCrawlRunsInterrupted: vi.fn(),
    },
    mockCrawlerService: { CRAWL_PAGE_LIMIT: 50, crawlWebsite: vi.fn() },
    mockPlaywrightService: { measureElapsedMs: vi.fn() },
    /** Decryption is replaced: its own spec covers the cryptography. */
    mockCredentialEncryption: { decryptCredentialPassword: vi.fn() },
  }));

vi.mock("../../../server/services/dbService.js", () => mockDbService);
vi.mock("../../../server/services/crawlerService.js", () => mockCrawlerService);
vi.mock("../../../server/services/playwrightService.js", () => mockPlaywrightService);
vi.mock("../../../server/utils/credentialEncryption.js", () => mockCredentialEncryption);

import {
  startCrawlRun,
  markUnfinishedCrawlRunsInterrupted,
} from "../../../server/services/crawlRunService.js";

const website: Website = {
  id: "website-1",
  url: "https://example.com/",
  name: "Example",
  description: null,
  networkIdleTimeoutMs: 4000,
  screenshotMinimumWaitMs: 250,
  loginUrl: null,
  createdAt: new Date("2026-03-01T00:00:00.000Z"),
  updatedAt: new Date("2026-03-01T00:00:00.000Z"),
  deletedAt: null,
};

const createdCrawlRun = {
  id: "crawl-run-1",
  websiteId: "website-1",
  credentialId: null,
  isLoggedIn: false,
  credential: null,
  startUrl: "https://example.com/",
  status: "running",
  pageLimit: 50,
  visitedPageCount: 0,
  waitingUrlCount: 0,
  errorMessage: null,
  durationMs: null,
  finishedAt: null,
  createdAt: new Date("2026-03-02T00:00:00.000Z"),
  updatedAt: new Date("2026-03-02T00:00:00.000Z"),
  deletedAt: null,
};

const visitedPage: CrawledPageInput = {
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
  title: "Example",
  ariaSnapshot: '- heading "Example" [level=1]',
  linkedUrls: [],
  durationMs: 800,
};

/** A credential of the website, as crawl start reads it (with its encrypted password). */
const credential: Credential = {
  id: "credential-1",
  websiteId: "website-1",
  name: "Admin",
  description: null,
  username: "admin@example.com",
  encryptedPassword: "iv.tag.ciphertext",
  loginUrl: "https://example.com/login",
  usernameSelector: "#email",
  passwordSelector: null,
  submitSelector: "button.sign-in",
  createdAt: new Date("2026-03-01T00:00:00.000Z"),
  updatedAt: new Date("2026-03-01T00:00:00.000Z"),
  deletedAt: null,
};

/** The website with a login page of its own, which credentials without one inherit. */
const websiteWithLoginUrl: Website = { ...website, loginUrl: "https://example.com/sign-in" };

/** The credential without a login URL of its own: it logs in on its website's. */
const inheritingCredential: Credential = { ...credential, loginUrl: null };

/** The screenshot directory handed to every crawl start. */
const SCREENSHOT_DIRECTORY = "/tmp/easy-test-screenshots";

/** The duration `measureElapsedMs` reports for every crawl. */
const PINNED_DURATION_MS = 4321;

/**
 * Reads the recorder `startCrawlRun` handed to `crawlWebsite`.
 * @returns The recorder function
 */
function readRecorderPassedToCrawler(): RecordVisitedPage {
  const crawlWebsiteArguments = mockCrawlerService.crawlWebsite.mock.calls[0] as [
    string,
    unknown,
    RecordVisitedPage,
    CrawlLogin | null,
  ];
  return crawlWebsiteArguments[2];
}

/**
 * Reads the login `startCrawlRun` handed to `crawlWebsite`.
 * @returns The login, or null for a logged-out crawl
 */
function readLoginPassedToCrawler(): CrawlLogin | null {
  const crawlWebsiteArguments = mockCrawlerService.crawlWebsite.mock.calls[0] as [
    string,
    unknown,
    RecordVisitedPage,
    CrawlLogin | null,
  ];
  return crawlWebsiteArguments[3];
}

/**
 * Starts a crawl and narrows the result to the started case.
 * @param crawlCredential - The credential to log in as, or null to crawl logged out
 * @param crawledWebsite - The website to crawl; the fixture website (no login URL) by default
 * @returns The new run and the promise for the crawl's end
 */
async function startCrawlThatMustStart(
  crawlCredential: Credential | null = null,
  crawledWebsite: Website = website,
): Promise<{
  crawlRun: unknown;
  crawlCompletion: Promise<void>;
}> {
  const crawlRunStart = await startCrawlRun(crawledWebsite, crawlCredential, SCREENSHOT_DIRECTORY);
  if (!crawlRunStart.crawlStarted) {
    throw new Error("Expected the crawl to start");
  }
  return crawlRunStart;
}

describe("startCrawlRun", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockCrawlerService.CRAWL_PAGE_LIMIT = 50;
    mockPlaywrightService.measureElapsedMs.mockReturnValue(PINNED_DURATION_MS);
    mockDbService.createCrawlRunForWebsite.mockResolvedValue(createdCrawlRun);
    mockDbService.finishCrawlRun.mockResolvedValue(true);
    const finishedOutcome: CrawlOutcome = {
      stopReason: "finished",
      visitedPageCount: 3,
      waitingUrlCount: 0,
      loginErrorMessage: null,
      loginFailureScreenshotWasCaptured: false,
    };
    mockCrawlerService.crawlWebsite.mockResolvedValue(finishedOutcome);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a running run for the website's URL and page limit, and returns it before the crawl ends", async () => {
    let finishCrawl: (outcome: CrawlOutcome) => void = () => undefined;
    mockCrawlerService.crawlWebsite.mockReturnValue(
      new Promise<CrawlOutcome>((resolve) => {
        finishCrawl = resolve;
      }),
    );

    const { crawlRun, crawlCompletion } = await startCrawlThatMustStart();

    expect(crawlRun).toBe(createdCrawlRun);
    expect(mockDbService.createCrawlRunForWebsite).toHaveBeenCalledWith("website-1", {
      startUrl: "https://example.com/",
      pageLimit: 50,
      credentialId: null,
      buttonMode: "linksOnly",
    });
    expect(mockCrawlerService.crawlWebsite).toHaveBeenCalledWith(
      "https://example.com/",
      { networkIdleTimeoutMs: 4000, screenshotMinimumWaitMs: 250 },
      expect.any(Function),
      null,
      "linksOnly",
    );
    expect(mockCredentialEncryption.decryptCredentialPassword).not.toHaveBeenCalled();
    expect(mockDbService.finishCrawlRun).not.toHaveBeenCalled();

    finishCrawl({
      stopReason: "finished",
      visitedPageCount: 1,
      waitingUrlCount: 0,
      loginErrorMessage: null,
      loginFailureScreenshotWasCaptured: false,
    });
    await crawlCompletion;
    expect(mockDbService.finishCrawlRun).toHaveBeenCalledTimes(1);
  });

  it.each(["allButRisky", "openOnly"] as const)(
    "stores the button mode %s on the run and hands it to the crawler",
    async (buttonMode) => {
      const crawlRunStart = await startCrawlRun(website, null, SCREENSHOT_DIRECTORY, buttonMode);
      if (!crawlRunStart.crawlStarted) {
        throw new Error("Expected the crawl to start");
      }
      await crawlRunStart.crawlCompletion;

      expect(mockDbService.createCrawlRunForWebsite).toHaveBeenCalledWith("website-1", {
        startUrl: "https://example.com/",
        pageLimit: 50,
        credentialId: null,
        buttonMode,
      });
      expect(mockCrawlerService.crawlWebsite).toHaveBeenCalledWith(
        "https://example.com/",
        { networkIdleTimeoutMs: 4000, screenshotMinimumWaitMs: 250 },
        expect.any(Function),
        null,
        buttonMode,
      );
    },
  );

  it("records each visited page on the run and hands back the saved page's id", async () => {
    mockDbService.recordCrawledPage.mockResolvedValue({ ...visitedPage, id: "crawled-page-1" });
    const { crawlCompletion } = await startCrawlThatMustStart();
    await crawlCompletion;
    const recordVisitedPage = readRecorderPassedToCrawler();

    const savedPageId = await recordVisitedPage(visitedPage, {
      visitedPageCount: 1,
      waitingUrlCount: 4,
    });

    expect(savedPageId).toBe("crawled-page-1");
    expect(mockDbService.recordCrawledPage).toHaveBeenCalledWith(
      "website-1",
      "crawl-run-1",
      { visitedPageCount: 1, waitingUrlCount: 4 },
      visitedPage,
    );
  });

  it("hands back null from the recorder when the run is no longer active", async () => {
    mockDbService.recordCrawledPage.mockResolvedValue(null);
    const { crawlCompletion } = await startCrawlThatMustStart();
    await crawlCompletion;
    const recordVisitedPage = readRecorderPassedToCrawler();

    const savedPageId = await recordVisitedPage(visitedPage, {
      visitedPageCount: 1,
      waitingUrlCount: 0,
    });

    expect(savedPageId).toBeNull();
  });

  it.each([
    { stopReason: "finished" as const, waitingUrlCount: 0 },
    { stopReason: "stoppedAtPageLimit" as const, waitingUrlCount: 17 },
    { stopReason: "stoppedAtTimeLimit" as const, waitingUrlCount: 5 },
  ])(
    "finishes the run as $stopReason with the waiting links and the crawl's duration",
    async ({ stopReason, waitingUrlCount }) => {
      mockCrawlerService.crawlWebsite.mockResolvedValue({
        stopReason,
        visitedPageCount: 50,
        waitingUrlCount,
        loginErrorMessage: null,
        loginFailureScreenshotWasCaptured: false,
      });

      const { crawlCompletion } = await startCrawlThatMustStart();
      await crawlCompletion;

      expect(mockDbService.finishCrawlRun).toHaveBeenCalledWith("website-1", "crawl-run-1", {
        status: stopReason,
        waitingUrlCount,
        errorMessage: null,
        loginFailureScreenshotFileName: null,
        durationMs: PINNED_DURATION_MS,
      });
    },
  );

  it("writes nothing more when the run was deleted with its website mid-crawl", async () => {
    mockCrawlerService.crawlWebsite.mockResolvedValue({
      stopReason: "stoppedBecauseRunWasDeleted",
      visitedPageCount: 2,
      waitingUrlCount: 3,
      loginErrorMessage: null,
      loginFailureScreenshotWasCaptured: false,
    });

    const { crawlCompletion } = await startCrawlThatMustStart();
    await crawlCompletion;

    expect(mockDbService.finishCrawlRun).not.toHaveBeenCalled();
  });

  it("finishes the run as interrupted, with the reason, when the browser closed mid-crawl", async () => {
    mockCrawlerService.crawlWebsite.mockResolvedValue({
      stopReason: "stoppedBecauseBrowserClosed",
      visitedPageCount: 4,
      waitingUrlCount: 9,
      loginErrorMessage: null,
      loginFailureScreenshotWasCaptured: false,
    });

    const { crawlCompletion } = await startCrawlThatMustStart();
    await crawlCompletion;

    expect(mockDbService.finishCrawlRun).toHaveBeenCalledWith("website-1", "crawl-run-1", {
      status: "interrupted",
      waitingUrlCount: 9,
      errorMessage: "The browser closed mid-crawl - most likely the server restarted.",
      loginFailureScreenshotFileName: null,
      durationMs: PINNED_DURATION_MS,
    });
  });

  it("finishes the run as failed with the reason when the crawl itself breaks", async () => {
    mockCrawlerService.crawlWebsite.mockRejectedValue(
      new Error("browserType.launch: Executable doesn't exist"),
    );

    const { crawlCompletion } = await startCrawlThatMustStart();
    await expect(crawlCompletion).resolves.toBeUndefined();

    expect(mockDbService.finishCrawlRun).toHaveBeenCalledWith("website-1", "crawl-run-1", {
      status: "failed",
      waitingUrlCount: 0,
      errorMessage: "browserType.launch: Executable doesn't exist",
      loginFailureScreenshotFileName: null,
      durationMs: PINNED_DURATION_MS,
    });
  });

  it("logs instead of rejecting when even marking the run failed fails", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockCrawlerService.crawlWebsite.mockRejectedValue(new Error("crawl broke"));
    mockDbService.finishCrawlRun.mockRejectedValue(new Error("database is down"));

    const { crawlCompletion } = await startCrawlThatMustStart();
    await expect(crawlCompletion).resolves.toBeUndefined();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[crawl] crawl run crawl-run-1 failed (crawl broke) and could not be marked failed: database is down",
    );
  });

  it("refuses a second crawl of the same website while one is running, then allows one after it ends", async () => {
    let finishCrawl: (outcome: CrawlOutcome) => void = () => undefined;
    mockCrawlerService.crawlWebsite.mockReturnValueOnce(
      new Promise<CrawlOutcome>((resolve) => {
        finishCrawl = resolve;
      }),
    );

    const { crawlCompletion } = await startCrawlThatMustStart();
    const secondStart = await startCrawlRun(website, null, SCREENSHOT_DIRECTORY);

    expect(secondStart).toEqual({ crawlStarted: false });
    expect(mockDbService.createCrawlRunForWebsite).toHaveBeenCalledTimes(1);

    finishCrawl({
      stopReason: "finished",
      visitedPageCount: 1,
      waitingUrlCount: 0,
      loginErrorMessage: null,
      loginFailureScreenshotWasCaptured: false,
    });
    await crawlCompletion;
    const thirdStart = await startCrawlThatMustStart();
    await thirdStart.crawlCompletion;
    expect(mockDbService.createCrawlRunForWebsite).toHaveBeenCalledTimes(2);
  });

  it("starts only one crawl when two requests for the same website arrive together", async () => {
    const [firstStart, secondStart] = await Promise.all([
      startCrawlRun(website, null, SCREENSHOT_DIRECTORY),
      startCrawlRun(website, null, SCREENSHOT_DIRECTORY),
    ]);

    const startedCount = [firstStart, secondStart].filter((start) => start.crawlStarted).length;
    expect(startedCount).toBe(1);
    expect(mockDbService.createCrawlRunForWebsite).toHaveBeenCalledTimes(1);
    for (const start of [firstStart, secondStart]) {
      if (start.crawlStarted) await start.crawlCompletion;
    }
  });

  it("crawls two different websites at the same time", async () => {
    const otherWebsite = { ...website, id: "website-2", url: "https://other.example/" };

    const [firstStart, secondStart] = await Promise.all([
      startCrawlRun(website, null, SCREENSHOT_DIRECTORY),
      startCrawlRun(otherWebsite, null, SCREENSHOT_DIRECTORY),
    ]);

    expect(firstStart.crawlStarted).toBe(true);
    expect(secondStart.crawlStarted).toBe(true);
    for (const start of [firstStart, secondStart]) {
      if (start.crawlStarted) await start.crawlCompletion;
    }
  });

  it("rejects, crawls nothing, and releases the website when the run cannot be created", async () => {
    const createError = new Error("connection refused");
    mockDbService.createCrawlRunForWebsite.mockRejectedValueOnce(createError);

    await expect(startCrawlRun(website, null, SCREENSHOT_DIRECTORY)).rejects.toBe(createError);
    expect(mockCrawlerService.crawlWebsite).not.toHaveBeenCalled();

    const retry = await startCrawlThatMustStart();
    await retry.crawlCompletion;
    expect(mockCrawlerService.crawlWebsite).toHaveBeenCalledTimes(1);
  });
});

describe("startCrawlRun with a credential", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockCrawlerService.CRAWL_PAGE_LIMIT = 50;
    mockPlaywrightService.measureElapsedMs.mockReturnValue(PINNED_DURATION_MS);
    mockCredentialEncryption.decryptCredentialPassword.mockReturnValue("correct horse");
    mockDbService.createCrawlRunForWebsite.mockResolvedValue({
      ...createdCrawlRun,
      credentialId: "credential-1",
      credential: { id: "credential-1", name: "Admin" },
    });
    mockDbService.finishCrawlRun.mockResolvedValue(true);
    mockCrawlerService.crawlWebsite.mockResolvedValue({
      stopReason: "finished",
      visitedPageCount: 3,
      waitingUrlCount: 0,
      loginErrorMessage: null,
      loginFailureScreenshotWasCaptured: false,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("decrypts the password, records the credential on the run, and hands the crawler the login details", async () => {
    const { crawlCompletion } = await startCrawlThatMustStart(credential);
    await crawlCompletion;

    expect(mockCredentialEncryption.decryptCredentialPassword).toHaveBeenCalledWith(
      "iv.tag.ciphertext",
    );
    expect(mockDbService.createCrawlRunForWebsite).toHaveBeenCalledWith("website-1", {
      startUrl: "https://example.com/",
      pageLimit: 50,
      credentialId: "credential-1",
      buttonMode: "linksOnly",
    });
    const login = readLoginPassedToCrawler();
    expect(login?.details).toEqual({
      loginUrl: "https://example.com/login",
      username: "admin@example.com",
      password: "correct horse",
      usernameSelector: "#email",
      passwordSelector: null,
      submitSelector: "button.sign-in",
    });
    expect(login?.failureScreenshotPath).toMatch(
      /^\/tmp\/easy-test-screenshots\/website-1\/[0-9a-f-]{36}\.png$/,
    );
  });

  it("logs in on the website's login URL when the credential has none of its own (inherits it)", async () => {
    const { crawlCompletion } = await startCrawlThatMustStart(
      inheritingCredential,
      websiteWithLoginUrl,
    );
    await crawlCompletion;

    expect(readLoginPassedToCrawler()?.details.loginUrl).toBe("https://example.com/sign-in");
  });

  it("logs in on the credential's own login URL even when the website has one (overrides it)", async () => {
    const { crawlCompletion } = await startCrawlThatMustStart(credential, websiteWithLoginUrl);
    await crawlCompletion;

    expect(readLoginPassedToCrawler()?.details.loginUrl).toBe("https://example.com/login");
  });

  it("rejects before claiming the website or creating a run when neither the credential nor the website has a login URL", async () => {
    await expect(
      startCrawlRun(website, inheritingCredential, SCREENSHOT_DIRECTORY),
    ).rejects.toThrow('The credential "Admin" has no login page URL, and neither does its website');
    expect(mockDbService.createCrawlRunForWebsite).not.toHaveBeenCalled();
    expect(mockCrawlerService.crawlWebsite).not.toHaveBeenCalled();

    const retry = await startCrawlThatMustStart(credential);
    await retry.crawlCompletion;
    expect(mockDbService.createCrawlRunForWebsite).toHaveBeenCalledTimes(1);
  });

  it("teaches a website with no login URL the credential's URL once the login succeeded", async () => {
    mockDbService.markCrawlRunLoggedIn.mockResolvedValue(true);
    mockDbService.adoptWebsiteLoginUrl.mockResolvedValue(true);
    const { crawlCompletion } = await startCrawlThatMustStart(credential);
    await crawlCompletion;
    expect(mockDbService.adoptWebsiteLoginUrl).not.toHaveBeenCalled();

    const runIsStillActive = await readLoginPassedToCrawler()?.recordLoginSucceeded();

    expect(runIsStillActive).toBe(true);
    expect(mockDbService.adoptWebsiteLoginUrl).toHaveBeenCalledWith(
      "website-1",
      "https://example.com/login",
    );
  });

  it("still crawls on when the website turned out to have a login URL already (nothing adopted)", async () => {
    mockDbService.markCrawlRunLoggedIn.mockResolvedValue(true);
    mockDbService.adoptWebsiteLoginUrl.mockResolvedValue(false);
    const { crawlCompletion } = await startCrawlThatMustStart(credential);
    await crawlCompletion;

    const runIsStillActive = await readLoginPassedToCrawler()?.recordLoginSucceeded();

    expect(runIsStillActive).toBe(true);
    expect(mockDbService.adoptWebsiteLoginUrl).toHaveBeenCalledTimes(1);
  });

  it.each([
    { label: "the credential's own URL", crawlCredential: credential },
    { label: "the inherited URL", crawlCredential: inheritingCredential },
  ])(
    "does not touch the login URL of a website that already has one, after logging in on $label",
    async ({ crawlCredential }) => {
      mockDbService.markCrawlRunLoggedIn.mockResolvedValue(true);
      const { crawlCompletion } = await startCrawlThatMustStart(
        crawlCredential,
        websiteWithLoginUrl,
      );
      await crawlCompletion;

      const runIsStillActive = await readLoginPassedToCrawler()?.recordLoginSucceeded();

      expect(runIsStillActive).toBe(true);
      expect(mockDbService.adoptWebsiteLoginUrl).not.toHaveBeenCalled();
    },
  );

  it("does not teach the website the login URL when the run is no longer active", async () => {
    mockDbService.markCrawlRunLoggedIn.mockResolvedValue(false);
    const { crawlCompletion } = await startCrawlThatMustStart(credential);
    await crawlCompletion;

    const runIsStillActive = await readLoginPassedToCrawler()?.recordLoginSucceeded();

    expect(runIsStillActive).toBe(false);
    expect(mockDbService.adoptWebsiteLoginUrl).not.toHaveBeenCalled();
  });

  it("does not teach the website the login URL when the login failed", async () => {
    mockCrawlerService.crawlWebsite.mockResolvedValue({
      stopReason: "loginFailed",
      visitedPageCount: 0,
      waitingUrlCount: 0,
      loginErrorMessage: "Still on the login form after submitting - check the username and password",
      loginFailureScreenshotWasCaptured: false,
    });

    const { crawlCompletion } = await startCrawlThatMustStart(credential);
    await crawlCompletion;

    expect(mockDbService.markCrawlRunLoggedIn).not.toHaveBeenCalled();
    expect(mockDbService.adoptWebsiteLoginUrl).not.toHaveBeenCalled();
  });

  it("logs a failure to save the learned login URL and still crawls on logged in", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockDbService.markCrawlRunLoggedIn.mockResolvedValue(true);
    mockDbService.adoptWebsiteLoginUrl.mockRejectedValue(new Error("database is down"));
    const { crawlCompletion } = await startCrawlThatMustStart(credential);
    await crawlCompletion;

    const runIsStillActive = await readLoginPassedToCrawler()?.recordLoginSucceeded();

    expect(runIsStillActive).toBe(true);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[crawl] website website-1 could not learn its login page URL https://example.com/login: database is down",
    );
  });

  it.each([true, false])(
    "marks the run logged in when the crawler reports the login worked, handing back the result (%s)",
    async (runWasMarked) => {
      mockDbService.markCrawlRunLoggedIn.mockResolvedValue(runWasMarked);
      const { crawlCompletion } = await startCrawlThatMustStart(credential);
      await crawlCompletion;
      const login = readLoginPassedToCrawler();

      const runIsStillActive = await login?.recordLoginSucceeded();

      expect(runIsStillActive).toBe(runWasMarked);
      expect(mockDbService.markCrawlRunLoggedIn).toHaveBeenCalledWith("website-1", "crawl-run-1");
    },
  );

  it("finishes the run as failed, naming the credential and the reason, with the screenshot taken of the failed login", async () => {
    mockCrawlerService.crawlWebsite.mockResolvedValue({
      stopReason: "loginFailed",
      visitedPageCount: 0,
      waitingUrlCount: 0,
      loginErrorMessage: "Still on the login form after submitting - check the username and password",
      loginFailureScreenshotWasCaptured: true,
    });

    const { crawlCompletion } = await startCrawlThatMustStart(credential);
    await crawlCompletion;

    const login = readLoginPassedToCrawler();
    const expectedFileName = String(login?.failureScreenshotPath).replace(
      `${SCREENSHOT_DIRECTORY}/`,
      "",
    );
    expect(expectedFileName).toMatch(/^website-1\/[0-9a-f-]{36}\.png$/);
    expect(mockDbService.finishCrawlRun).toHaveBeenCalledWith("website-1", "crawl-run-1", {
      status: "failed",
      waitingUrlCount: 0,
      errorMessage:
        'Login as "Admin" failed: Still on the login form after submitting - check the username and password',
      loginFailureScreenshotFileName: expectedFileName,
      durationMs: PINNED_DURATION_MS,
    });
    expect(mockDbService.markCrawlRunLoggedIn).not.toHaveBeenCalled();
  });

  it("records no screenshot when the failed login's screenshot could not be taken", async () => {
    mockCrawlerService.crawlWebsite.mockResolvedValue({
      stopReason: "loginFailed",
      visitedPageCount: 0,
      waitingUrlCount: 0,
      loginErrorMessage: "No visible password field was found on the login page (found automatically)",
      loginFailureScreenshotWasCaptured: false,
    });

    const { crawlCompletion } = await startCrawlThatMustStart(credential);
    await crawlCompletion;

    expect(mockDbService.finishCrawlRun).toHaveBeenCalledWith(
      "website-1",
      "crawl-run-1",
      expect.objectContaining({ status: "failed", loginFailureScreenshotFileName: null }),
    );
  });

  it("still words the failure (with no screenshot to record) when a failed login comes without a reason or a credential", async () => {
    mockCrawlerService.crawlWebsite.mockResolvedValue({
      stopReason: "loginFailed",
      visitedPageCount: 0,
      waitingUrlCount: 0,
      loginErrorMessage: null,
      loginFailureScreenshotWasCaptured: true,
    });

    const { crawlCompletion } = await startCrawlThatMustStart(null);
    await crawlCompletion;

    expect(mockDbService.finishCrawlRun).toHaveBeenCalledWith(
      "website-1",
      "crawl-run-1",
      expect.objectContaining({
        status: "failed",
        errorMessage: 'Login as "the credential" failed: no reason was given',
        loginFailureScreenshotFileName: null,
      }),
    );
  });

  it("rejects before claiming the website or creating a run when the password cannot be decrypted", async () => {
    const decryptError = new Error("The saved password could not be decrypted");
    mockCredentialEncryption.decryptCredentialPassword.mockImplementationOnce(() => {
      throw decryptError;
    });

    await expect(startCrawlRun(website, credential, SCREENSHOT_DIRECTORY)).rejects.toBe(
      decryptError,
    );
    expect(mockDbService.createCrawlRunForWebsite).not.toHaveBeenCalled();
    expect(mockCrawlerService.crawlWebsite).not.toHaveBeenCalled();

    const retry = await startCrawlThatMustStart(credential);
    await retry.crawlCompletion;
    expect(mockDbService.createCrawlRunForWebsite).toHaveBeenCalledTimes(1);
  });
});

describe("markUnfinishedCrawlRunsInterrupted", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("marks the leftover running runs interrupted and logs how many", async () => {
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    mockDbService.markRunningCrawlRunsInterrupted.mockResolvedValue(2);

    await markUnfinishedCrawlRunsInterrupted();

    expect(mockDbService.markRunningCrawlRunsInterrupted).toHaveBeenCalledTimes(1);
    expect(consoleLogSpy).toHaveBeenCalledWith(
      "[crawl] marked 2 unfinished crawl run(s) interrupted",
    );
  });

  it("logs nothing when no run was left running", async () => {
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    mockDbService.markRunningCrawlRunsInterrupted.mockResolvedValue(0);

    await markUnfinishedCrawlRunsInterrupted();

    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it("logs the failure instead of rejecting, so the server still starts", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockDbService.markRunningCrawlRunsInterrupted.mockRejectedValue(new Error("database is down"));

    await expect(markUnfinishedCrawlRunsInterrupted()).resolves.toBeUndefined();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[crawl] could not mark unfinished crawl runs interrupted: database is down",
    );
  });
});
