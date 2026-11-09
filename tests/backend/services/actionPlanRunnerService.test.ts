import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import path from "node:path";
import type { Page } from "playwright";
import type { ActionPlan, PlanStep, PlanTarget } from "../../../server/utils/actionPlanSchema.js";

/**
 * No test here launches a real browser. `playwright` is replaced by a fake
 * `chromium` whose `launch` resolves a fake browser, whose `newPage` resolves
 * a fake page; every `getBy...` / `locator` call on that page returns ONE
 * shared fake locator, so a test reads which finder was used from the page
 * and what was done from the locator. `node:fs/promises` is replaced so no
 * run folder is created, and the crawler's login routine is replaced: its
 * own spec drives a fake login form, here only its outcome matters. The real
 * browser round trip is proven by the manual verification run.
 */
const {
  mockChromium,
  mockBrowser,
  mockPage,
  mockLocator,
  mockFileChooser,
  mockMkdir,
  mockLogInWithCredential,
  MockTimeoutError,
} = vi.hoisted(() => ({
  mockChromium: { launch: vi.fn() },
  mockBrowser: { newPage: vi.fn(), close: vi.fn() },
  mockPage: {
    setDefaultTimeout: vi.fn(),
    setDefaultNavigationTimeout: vi.fn(),
    goto: vi.fn(),
    url: vi.fn(),
    getByRole: vi.fn(),
    getByLabel: vi.fn(),
    getByPlaceholder: vi.fn(),
    getByText: vi.fn(),
    getByAltText: vi.fn(),
    getByTitle: vi.fn(),
    locator: vi.fn(),
    keyboard: { press: vi.fn() },
    mouse: { wheel: vi.fn() },
    waitForEvent: vi.fn(),
    once: vi.fn(),
    waitForURL: vi.fn(),
    waitForLoadState: vi.fn(),
    screenshot: vi.fn(),
  },
  mockLocator: {
    click: vi.fn(),
    dblclick: vi.fn(),
    hover: vi.fn(),
    press: vi.fn(),
    pressSequentially: vi.fn(),
    check: vi.fn(),
    uncheck: vi.fn(),
    selectOption: vi.fn(),
    scrollIntoViewIfNeeded: vi.fn(),
    waitFor: vi.fn(),
    ariaSnapshot: vi.fn(),
    first: vi.fn(),
    evaluate: vi.fn(),
    evaluateHandle: vi.fn(),
    allInnerTexts: vi.fn(),
  },
  /** What `page.waitForEvent("filechooser")` resolves with. */
  mockFileChooser: { setFiles: vi.fn() },
  mockMkdir: vi.fn(),
  mockLogInWithCredential: vi.fn(),
  /** Stands in for Playwright's `errors.TimeoutError`, which `playwrightService` checks with instanceof. */
  MockTimeoutError: class MockTimeoutError extends Error {},
}));

vi.mock("playwright", () => ({
  chromium: mockChromium,
  errors: { TimeoutError: MockTimeoutError },
}));
vi.mock("node:fs/promises", () => ({ mkdir: mockMkdir }));
vi.mock("../../../server/services/crawlerLoginService.js", () => ({
  logInWithCredential: mockLogInWithCredential,
}));

import {
  FAILURE_SCREENSHOT_FILE_NAME,
  LOGGED_IN_SCREENSHOT_FILE_NAME,
  NO_PARAMETER_RUN,
  PLAN_NAVIGATION_TIMEOUT_MS,
  PLAN_OUTPUT_CHARACTER_LIMIT,
  PLAN_RUN_SLOW_MO_MS,
  PLAN_RUN_TIMEOUT_MS,
  PLAN_STEP_TIMEOUT_MS,
  START_PAGE_SCREENSHOT_FILE_NAME,
  STEP_SCREENSHOT_SETTLE_TIMEOUT_MS,
  TYPING_DELAY_MS,
  alertReadsAsAnError,
  buildStepScreenshotFileName,
  describePlanStep,
  describePlanTarget,
  runActionPlan,
  runPlanStep,
  scrubSecrets,
  type ActionPlanRunRequest,
  type PlanRunLogin,
} from "../../../server/services/actionPlanRunnerService.js";
import { MAX_SNAPSHOT_CHARACTERS } from "../../../server/utils/selectRelevantCrawledPages.js";

/** What every step is handed besides the page. */
type PlanStepContext = Parameters<typeof runPlanStep>[2];

/** A browser dialog, as the `page.once("dialog")` handler receives it. */
interface FakeDialog {
  accept: Mock;
  dismiss: Mock;
}

/** The fake page, as the service sees it. Only the members above are ever called. */
const fakePage = mockPage as unknown as Page;

const RUN_DIRECTORY = "/runs/action-1/run-1";
const UPLOADS_DIRECTORY = "/uploads/website-1";
const FAILURE_SCREENSHOT_PATH = path.join(RUN_DIRECTORY, FAILURE_SCREENSHOT_FILE_NAME);
/** The website's timing settings, handed to the login untouched. */
const TIMING_SETTINGS = { networkIdleTimeoutMs: 5000, screenshotMinimumWaitMs: 0 };
/** The website's own origin plus its login page's. */
const ALLOWED_ORIGINS = ["https://shop.example.com", "https://auth.example.com"];
const USERNAME = "admin@example.com";
const PASSWORD = "correct horse";
const TIME_LIMIT_MESSAGE = "Stopped after 5 minutes (the time limit)";
/** The address the fake page reports (see `beforeEach`). */
const FAILING_PAGE_URL = "https://shop.example.com/account";
/** The aria snapshot the fake page's `<body>` reports. */
const FAILING_PAGE_SNAPSHOT = '- heading "Your account" [level=1]\n- link "Profile"';
/** A plan whose second step fails in these tests; no step reads the page's address. */
const TWO_CLICK_PLAN = buildPlan([
  buildStep("click", { target: { role: "link", name: "Shoes" } }),
  buildStep("click", { target: { role: "button", name: "Pay" } }),
]);

/** The credential a logged-in run logs in as. */
const LOGIN: PlanRunLogin = {
  credentialName: "Admin",
  details: {
    loginUrl: "https://auth.example.com/login",
    username: USERNAME,
    password: PASSWORD,
    usernameSelector: null,
    passwordSelector: null,
    submitSelector: null,
  },
};

/**
 * Builds one step, defaulting to "no target, no value".
 * @param action - The step's action
 * @param fields - The step's target and value, when it has them
 * @returns The step
 */
function buildStep(
  action: PlanStep["action"],
  fields: { target?: PlanTarget | null; value?: string | null } = {},
): PlanStep {
  return { action, target: fields.target ?? null, value: fields.value ?? null };
}

/**
 * Builds a plan that starts on the shop's home page.
 * @param steps - The plan's steps
 * @returns The plan
 */
function buildPlan(steps: PlanStep[]): ActionPlan {
  return { name: "Add shoes to the cart", startUrl: "https://shop.example.com/", steps };
}

/** A plan that uses each kind of step a typical run has. */
const SHOPPING_PLAN = buildPlan([
  buildStep("click", { target: { role: "link", name: "Shoes" } }),
  buildStep("fill", { target: { label: "Email" }, value: "{{credential.username}}" }),
  buildStep("press", { value: "Enter" }),
  buildStep("expectVisible", { target: { text: "Added to cart" } }),
]);

/** A plan whose only step waits for an address that never comes, which only the time limit ends in these tests. */
const WAIT_FOR_URL_PLAN = buildPlan([buildStep("waitForUrl", { value: "**/never-reached" })]);

/**
 * Builds a run request: the shopping plan, logged in, with the test folders.
 * @param overrides - Fields to replace
 * @returns The request
 */
function buildRunRequest(overrides: Partial<ActionPlanRunRequest> = {}): ActionPlanRunRequest {
  return {
    plan: SHOPPING_PLAN,
    login: LOGIN,
    timingSettings: TIMING_SETTINGS,
    allowedOrigins: ALLOWED_ORIGINS,
    runDirectory: RUN_DIRECTORY,
    uploadsDirectory: UPLOADS_DIRECTORY,
    parameterRun: NO_PARAMETER_RUN,
    ...overrides,
  };
}

/**
 * Builds what one step is handed: the credential, the allowed origins, the
 * uploads folder, and a spy log.
 * @param overrides - Fields to replace
 * @returns The step context
 */
function buildStepContext(overrides: Partial<PlanStepContext> = {}): PlanStepContext {
  return {
    credentialValues: { username: USERNAME, password: PASSWORD },
    allowedOrigins: ALLOWED_ORIGINS,
    uploadsDirectory: UPLOADS_DIRECTORY,
    log: vi.fn(),
    ...overrides,
  };
}

/**
 * Reads when each mock was first called, so a test can check the order.
 * @param mocks - The mocks, in the order they should have been called
 * @returns Each mock's first invocation order
 */
function readFirstCallOrder(...mocks: Mock[]): number[] {
  return mocks.map((mock) => mock.mock.invocationCallOrder[0]);
}

/**
 * Asserts that each mock was first called after the one before it.
 * @param mocks - The mocks, in the order they should have been called
 */
function expectCalledInOrder(...mocks: Mock[]): void {
  const callOrder = readFirstCallOrder(...mocks);
  expect(callOrder.every((order) => typeof order === "number")).toBe(true);
  expect(callOrder).toEqual([...callOrder].sort((first, second) => first - second));
}

/**
 * Lists the files `page.screenshot` was asked to write, in call order - step
 * screenshots and the failure screenshot alike.
 * @returns Each call's `path`
 */
function readScreenshotPaths(): string[] {
  return mockPage.screenshot.mock.calls.map((call) => (call[0] as { path: string }).path);
}

/**
 * Counts the calls that asked for the FAILURE screenshot (not a step one).
 * @returns How many times `failure.png` was asked for
 */
function countFailureScreenshotCalls(): number {
  return readScreenshotPaths().filter((screenshotPath) => screenshotPath === FAILURE_SCREENSHOT_PATH).length;
}

/**
 * Reads when the failure screenshot was first asked for, so a test can
 * check it came before what follows it.
 * @returns Its invocation order, or undefined when it was never asked for
 */
function readFailureScreenshotCallOrder(): number | undefined {
  const failureCallIndex = readScreenshotPaths().indexOf(FAILURE_SCREENSHOT_PATH);
  return failureCallIndex === -1 ? undefined : mockPage.screenshot.mock.invocationCallOrder[failureCallIndex];
}

/**
 * Builds the step screenshot a run reports for one moment, taken, on the
 * fake page's address.
 * @param moment - When it was taken
 * @param stepNumber - The plan step it follows, or null
 * @param fileName - The PNG's name inside the run folder
 * @returns The reported step screenshot
 */
function buildTakenStepScreenshot(
  moment: "loggedIn" | "startPage" | "step",
  stepNumber: number | null,
  fileName: string,
): { moment: string; stepNumber: number | null; fileName: string; errorMessage: null; pageUrl: string } {
  return { moment, stepNumber, fileName, errorMessage: null, pageUrl: FAILING_PAGE_URL };
}

/**
 * Counts every call made to the fake page and the fake locator.
 * @returns How many Playwright calls were made
 */
function countPlaywrightCalls(): number {
  const pageMembers = Object.values(mockPage).flatMap((member) =>
    typeof member === "function" ? [member] : Object.values(member),
  );
  const allMocks = [...pageMembers, ...Object.values(mockLocator)] as Mock[];
  return allMocks.reduce((total, mock) => total + mock.mock.calls.length, 0);
}

/**
 * Runs some work and collects every promise rejection nobody handled while
 * it settled - one that would stop the server.
 * @param work - The work to run
 * @returns The unhandled rejections' reasons
 */
async function collectUnhandledRejections(work: () => Promise<void>): Promise<unknown[]> {
  const unhandledRejections: unknown[] = [];
  /**
   * Records one unhandled rejection.
   * @param reason - What the promise rejected with
   */
  const recordUnhandledRejection = (reason: unknown): void => {
    unhandledRejections.push(reason);
  };
  process.on("unhandledRejection", recordUnhandledRejection);
  try {
    await work();
    // Node reports unhandled rejections after the microtasks drain.
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    process.off("unhandledRejection", recordUnhandledRejection);
  }
  return unhandledRejections;
}

/**
 * Splits a run's output into its lines (the output ends with a newline).
 * @param output - The run's output
 * @returns The lines
 */
function readOutputLines(output: string): string[] {
  return output.split("\n").slice(0, -1);
}

beforeEach(() => {
  vi.resetAllMocks();
  mockMkdir.mockResolvedValue(undefined);
  mockChromium.launch.mockResolvedValue(mockBrowser);
  mockBrowser.newPage.mockResolvedValue(mockPage);
  mockBrowser.close.mockResolvedValue(undefined);
  mockLogInWithCredential.mockResolvedValue({ loggedIn: true });
  mockPage.goto.mockResolvedValue(null);
  mockPage.url.mockReturnValue("https://shop.example.com/account");
  for (const finder of [
    mockPage.getByRole,
    mockPage.getByLabel,
    mockPage.getByPlaceholder,
    mockPage.getByText,
    mockPage.getByAltText,
    mockPage.getByTitle,
    mockPage.locator,
  ]) {
    finder.mockReturnValue(mockLocator);
  }
  for (const locatorMethod of Object.values(mockLocator)) {
    locatorMethod.mockResolvedValue(undefined);
  }
  mockLocator.first.mockReturnValue(mockLocator);
  mockLocator.allInnerTexts.mockResolvedValue([]);
  mockLocator.ariaSnapshot.mockResolvedValue(FAILING_PAGE_SNAPSHOT);
  mockPage.keyboard.press.mockResolvedValue(undefined);
  mockPage.mouse.wheel.mockResolvedValue(undefined);
  mockPage.waitForEvent.mockResolvedValue(mockFileChooser);
  mockFileChooser.setFiles.mockResolvedValue(undefined);
  mockPage.waitForURL.mockResolvedValue(undefined);
  mockPage.waitForLoadState.mockResolvedValue(undefined);
  mockPage.screenshot.mockResolvedValue(Buffer.from("png"));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("runActionPlan", () => {
  it("creates the run folder, then opens a visible, slowed-down 1280x720 browser with the step timeouts", async () => {
    await runActionPlan(buildRunRequest());

    expect(mockMkdir).toHaveBeenCalledWith(RUN_DIRECTORY, { recursive: true });
    expect(mockChromium.launch).toHaveBeenCalledWith({ headless: true, slowMo: PLAN_RUN_SLOW_MO_MS });
    expect(PLAN_RUN_SLOW_MO_MS).toBe(100);
    expect(mockBrowser.newPage).toHaveBeenCalledWith({ viewport: { width: 1280, height: 720 } });
    expect(mockPage.setDefaultTimeout).toHaveBeenCalledWith(PLAN_STEP_TIMEOUT_MS);
    expect(mockPage.setDefaultNavigationTimeout).toHaveBeenCalledWith(PLAN_NAVIGATION_TIMEOUT_MS);
    expectCalledInOrder(mockMkdir, mockChromium.launch, mockBrowser.newPage);
  });

  it("logs in, opens the start URL, runs every step in order, and reports success", async () => {
    const { durationMs, ...outcome } = await runActionPlan(buildRunRequest());

    expect(durationMs).toBeGreaterThanOrEqual(0);
    expect(outcome).toEqual({
      succeeded: true,
      timedOut: false,
      errorMessage: null,
      failedStepNumber: null,
      output: [
        'Log in as "Admin"',
        "✔ Logged in",
        "Open https://shop.example.com/",
        'Step 1: Click link "Shoes"',
        'Step 2: Type into the field labelled "Email"',
        "Step 3: Press Enter",
        'Step 4: Check that the text "Added to cart" is visible',
        "✔ Use case completed",
        "",
      ].join("\n"),
      outputWasTruncated: false,
      failureScreenshotWasCaptured: false,
      failingPageUrl: null,
      failingPageAriaSnapshot: null,
      fieldReadings: [],
      confirmStepSucceeded: null,
      pageUrlAfterConfirm: null,
      finalPageUrl: FAILING_PAGE_URL,
      stepScreenshots: [
        buildTakenStepScreenshot("loggedIn", null, "logged-in.png"),
        buildTakenStepScreenshot("startPage", null, "start-page.png"),
        buildTakenStepScreenshot("step", 1, "step-001.png"),
        buildTakenStepScreenshot("step", 2, "step-002.png"),
        buildTakenStepScreenshot("step", 3, "step-003.png"),
        buildTakenStepScreenshot("step", 4, "step-004.png"),
      ],
    });
    expect(mockLocator.ariaSnapshot).not.toHaveBeenCalled();
    expect(mockLogInWithCredential).toHaveBeenCalledWith(mockPage, LOGIN.details, TIMING_SETTINGS);
    expect(mockPage.goto).toHaveBeenCalledWith("https://shop.example.com/");
    expect(mockPage.getByRole).toHaveBeenCalledWith("link", { name: "Shoes" });
    expect(mockPage.getByLabel).toHaveBeenCalledWith("Email");
    expect(mockLocator.pressSequentially).toHaveBeenCalledWith(USERNAME, expect.any(Object));
    expect(mockPage.keyboard.press).toHaveBeenCalledWith("Enter");
    expect(mockPage.getByText).toHaveBeenCalledWith("Added to cart");
    expect(mockLocator.waitFor).toHaveBeenCalledWith({ state: "visible" });
    expectCalledInOrder(
      mockLogInWithCredential,
      mockPage.goto,
      mockPage.getByRole,
      mockPage.getByLabel,
      mockPage.keyboard.press,
      mockPage.getByText,
    );
    // Only step screenshots: a passing run takes no failure screenshot.
    expect(countFailureScreenshotCalls()).toBe(0);
    expect(mockBrowser.close).toHaveBeenCalledTimes(1);
  });

  it("does not log in when the action runs logged out", async () => {
    const result = await runActionPlan(
      buildRunRequest({ login: null, plan: buildPlan([buildStep("log", { value: "Hello" })]) }),
    );

    expect(mockLogInWithCredential).not.toHaveBeenCalled();
    expect(result.succeeded).toBe(true);
    expect(readOutputLines(result.output)).toEqual([
      "Open https://shop.example.com/",
      "Step 1: Note: Hello",
      "✔ Use case completed",
    ]);
  });

  it("fails before the start URL, with a screenshot, when the login fails", async () => {
    mockLogInWithCredential.mockResolvedValue({
      loggedIn: false,
      errorMessage: "Still on the login form after submitting - check the username and password",
    });

    const result = await runActionPlan(buildRunRequest());

    const expectedError =
      'Could not log in as "Admin": Still on the login form after submitting - check the username and password';
    expect(result).toMatchObject({
      succeeded: false,
      timedOut: false,
      errorMessage: expectedError,
      failedStepNumber: null,
      failureScreenshotWasCaptured: true,
    });
    expect(readOutputLines(result.output)).toEqual(['Log in as "Admin"', `✘ Stopped: ${expectedError}`]);
    expect(mockPage.goto).not.toHaveBeenCalled();
    expect(mockPage.screenshot).toHaveBeenCalledWith({
      path: FAILURE_SCREENSHOT_PATH,
      timeout: PLAN_STEP_TIMEOUT_MS,
    });
    expect(mockBrowser.close).toHaveBeenCalledTimes(1);
  });

  it("fails before the first step, with a screenshot, when the start URL cannot be opened", async () => {
    mockPage.goto.mockRejectedValue(
      new Error("page.goto: net::ERR_NAME_NOT_RESOLVED at https://shop.example.com/\nCall log: ..."),
    );

    const result = await runActionPlan(buildRunRequest({ login: null }));

    expect(result).toMatchObject({
      succeeded: false,
      errorMessage:
        "Could not open the start URL: page.goto: net::ERR_NAME_NOT_RESOLVED at https://shop.example.com/",
      failedStepNumber: null,
      failureScreenshotWasCaptured: true,
    });
    expect(mockPage.getByRole).not.toHaveBeenCalled();
  });

  it("stops at the first failing step, keeps the first line of its error, and screenshots it into the run folder", async () => {
    mockLocator.click
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(
        new Error("locator.click: Timeout 10000ms exceeded.\nCall log:\n  - waiting for getByRole('button')"),
      );
    const plan = buildPlan([
      buildStep("click", { target: { role: "link", name: "Shoes" } }),
      buildStep("click", { target: { role: "button", name: "Pay" } }),
      buildStep("click", { target: { role: "button", name: "Confirm" } }),
    ]);

    const result = await runActionPlan(buildRunRequest({ plan, login: null }));

    expect(result).toMatchObject({
      succeeded: false,
      timedOut: false,
      errorMessage: "locator.click: Timeout 10000ms exceeded.",
      failedStepNumber: 2,
      failureScreenshotWasCaptured: true,
    });
    expect(mockLocator.click).toHaveBeenCalledTimes(2);
    expect(readOutputLines(result.output).slice(-2)).toEqual([
      'Step 2: Click button "Pay"',
      "✘ Stopped at step 2: locator.click: Timeout 10000ms exceeded.",
    ]);
    expect(mockPage.screenshot).toHaveBeenCalledWith({
      path: FAILURE_SCREENSHOT_PATH,
      timeout: PLAN_STEP_TIMEOUT_MS,
    });
    expectCalledInOrder(mockPage.screenshot, mockBrowser.close);
  });

  it("reports a failed run without a screenshot when the screenshot itself fails", async () => {
    mockPage.goto.mockRejectedValue(new Error("page.goto: net::ERR_CONNECTION_REFUSED"));
    mockPage.screenshot.mockRejectedValue(new Error("page.screenshot: Target page has been closed"));

    const result = await runActionPlan(buildRunRequest());

    expect(result).toMatchObject({
      succeeded: false,
      errorMessage: "Could not open the start URL: page.goto: net::ERR_CONNECTION_REFUSED",
      failureScreenshotWasCaptured: false,
    });
    expect(mockBrowser.close).toHaveBeenCalledTimes(1);
  });

  it("scrubs the credential's username and password from the error and the log", async () => {
    mockLocator.pressSequentially.mockRejectedValue(
      new Error(`locator.pressSequentially: Timeout exceeded while typing "${PASSWORD}"\nCall log: ...`),
    );
    const plan = buildPlan([
      buildStep("log", { value: `Signed in as ${USERNAME}` }),
      buildStep("fill", { target: { label: "Password" }, value: "{{credential.password}}" }),
    ]);

    const result = await runActionPlan(buildRunRequest({ plan }));

    expect(result.errorMessage).toBe('locator.pressSequentially: Timeout exceeded while typing "••••••"');
    expect(result.output).toContain("Step 1: Note: Signed in as ••••••");
    expect(result.output).toContain('✘ Stopped at step 2: locator.pressSequentially: Timeout exceeded while typing "••••••"');
    expect(result.output).not.toContain(USERNAME);
    expect(result.output).not.toContain(PASSWORD);
  });

  it("removes NUL characters from the log", async () => {
    const plan = buildPlan([buildStep("log", { value: "before\u0000after" })]);

    const result = await runActionPlan(buildRunRequest({ plan, login: null }));

    expect(result.output).toContain("Step 1: Note: beforeafter\n");
    expect(result.output).not.toContain("\u0000");
  });

  it(`keeps only the last ${String(PLAN_OUTPUT_CHARACTER_LIMIT)} characters of a long log, saying how many were dropped`, async () => {
    const longMessage = "m".repeat(10_000);
    const plan = buildPlan(Array.from({ length: 25 }, () => buildStep("log", { value: longMessage })));
    const fullOutput = [
      "Open https://shop.example.com/",
      ...plan.steps.map((_step, stepIndex) => `Step ${String(stepIndex + 1)}: Note: ${longMessage}`),
      "✔ Use case completed",
    ]
      .map((line) => `${line}\n`)
      .join("");
    const droppedCharacterCount = fullOutput.length - PLAN_OUTPUT_CHARACTER_LIMIT;

    const result = await runActionPlan(buildRunRequest({ plan, login: null }));

    expect(droppedCharacterCount).toBeGreaterThan(0);
    expect(result.outputWasTruncated).toBe(true);
    expect(result.output).toBe(
      `[... ${String(droppedCharacterCount)} earlier characters dropped ...]\n${fullOutput.slice(droppedCharacterCount)}`,
    );
    expect(result.output.endsWith("✔ Use case completed\n")).toBe(true);
  });

  it("closes the browser even when closing it fails, and still reports the run", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockBrowser.close.mockRejectedValue(new Error("browser.close: Browser has been closed"));

    const result = await runActionPlan(buildRunRequest());

    expect(result.succeeded).toBe(true);
    expect(mockBrowser.close).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[playwright] could not close the browser: browser.close: Browser has been closed",
    );
  });

  it("rejects without launching a browser when the run folder cannot be created", async () => {
    const folderError = new Error("EACCES: permission denied, mkdir '/runs/action-1/run-1'");
    mockMkdir.mockRejectedValue(folderError);

    await expect(runActionPlan(buildRunRequest())).rejects.toBe(folderError);
    expect(mockChromium.launch).not.toHaveBeenCalled();
  });

  it("rejects when the browser cannot be launched", async () => {
    const launchError = new Error("browserType.launch: Executable doesn't exist");
    mockChromium.launch.mockRejectedValue(launchError);

    await expect(runActionPlan(buildRunRequest())).rejects.toBe(launchError);
    expect(mockBrowser.close).not.toHaveBeenCalled();
  });

  it("closes the browser and rejects when no page can be opened", async () => {
    const pageError = new Error("browser.newPage: Target page, context or browser has been closed");
    mockBrowser.newPage.mockRejectedValue(pageError);

    await expect(runActionPlan(buildRunRequest())).rejects.toBe(pageError);
    expect(mockBrowser.close).toHaveBeenCalledTimes(1);
  });

  describe("the failing page's address and aria snapshot", () => {
    /** Makes the second click of `TWO_CLICK_PLAN` fail. */
    function failTheSecondClick(): void {
      mockLocator.click
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("locator.click: Timeout 10000ms exceeded."));
    }

    it("captures the screenshot, then the address, then the body's aria snapshot, before the browser closes", async () => {
      failTheSecondClick();

      const result = await runActionPlan(buildRunRequest({ plan: TWO_CLICK_PLAN, login: null }));

      expect(result).toMatchObject({
        succeeded: false,
        failedStepNumber: 2,
        failureScreenshotWasCaptured: true,
        failingPageUrl: FAILING_PAGE_URL,
        failingPageAriaSnapshot: FAILING_PAGE_SNAPSHOT,
      });
      expect(mockPage.locator).toHaveBeenCalledWith("body");
      expect(mockLocator.ariaSnapshot).toHaveBeenCalledTimes(1);
      expect(mockLocator.ariaSnapshot).toHaveBeenCalledWith({ timeout: PLAN_STEP_TIMEOUT_MS });
      expectCalledInOrder(
        mockPage.screenshot,
        mockPage.url,
        mockPage.locator,
        mockLocator.ariaSnapshot,
        mockBrowser.close,
      );
    });

    it("captures no evidence, and takes no snapshot, when the run passes", async () => {
      const result = await runActionPlan(buildRunRequest({ plan: TWO_CLICK_PLAN, login: null }));

      expect(result).toMatchObject({
        succeeded: true,
        failureScreenshotWasCaptured: false,
        failingPageUrl: null,
        failingPageAriaSnapshot: null,
      });
      expect(countFailureScreenshotCalls()).toBe(0);
      // The address is read once per step screenshot, and once as the run's
      // final address - never as failure evidence.
      expect(mockPage.url).toHaveBeenCalledTimes(result.stepScreenshots.length + 1);
      expect(result.finalPageUrl).toBe(FAILING_PAGE_URL);
      expect(mockPage.locator).not.toHaveBeenCalled();
      expect(mockLocator.ariaSnapshot).not.toHaveBeenCalled();
    });

    it("still captures the evidence when the run fails before the first step", async () => {
      mockLogInWithCredential.mockResolvedValue({ loggedIn: false, errorMessage: "Still on the login form" });

      const result = await runActionPlan(buildRunRequest());

      expect(result).toMatchObject({
        succeeded: false,
        failedStepNumber: null,
        failureScreenshotWasCaptured: true,
        failingPageUrl: FAILING_PAGE_URL,
        failingPageAriaSnapshot: FAILING_PAGE_SNAPSHOT,
      });
      expect(mockPage.goto).not.toHaveBeenCalled();
    });

    it("keeps the address and the snapshot when the screenshot fails", async () => {
      failTheSecondClick();
      mockPage.screenshot.mockRejectedValue(new Error("page.screenshot: Timeout 10000ms exceeded."));

      const result = await runActionPlan(buildRunRequest({ plan: TWO_CLICK_PLAN, login: null }));

      expect(result).toMatchObject({
        failureScreenshotWasCaptured: false,
        failingPageUrl: FAILING_PAGE_URL,
        failingPageAriaSnapshot: FAILING_PAGE_SNAPSHOT,
      });
    });

    it("reports no snapshot, and keeps the run's own error, when the snapshot cannot be taken", async () => {
      failTheSecondClick();
      mockLocator.ariaSnapshot.mockRejectedValue(new Error("locator.ariaSnapshot: Target page has been closed"));

      const result = await runActionPlan(buildRunRequest({ plan: TWO_CLICK_PLAN, login: null }));

      expect(result).toMatchObject({
        errorMessage: "locator.click: Timeout 10000ms exceeded.",
        failureScreenshotWasCaptured: true,
        failingPageUrl: FAILING_PAGE_URL,
        failingPageAriaSnapshot: null,
      });
    });

    it("reports no address, and still takes the snapshot, when the address cannot be read", async () => {
      failTheSecondClick();
      mockPage.url.mockImplementation(() => {
        throw new Error("page.url: Target page has been closed");
      });

      const result = await runActionPlan(buildRunRequest({ plan: TWO_CLICK_PLAN, login: null }));

      expect(result).toMatchObject({ failingPageUrl: null, failingPageAriaSnapshot: FAILING_PAGE_SNAPSHOT });
    });

    it.each(["about:blank", ""])("reports no address for a page that never opened anything (%j)", async (blankUrl) => {
      failTheSecondClick();
      mockPage.url.mockReturnValue(blankUrl);

      const result = await runActionPlan(buildRunRequest({ plan: TWO_CLICK_PLAN, login: null }));

      expect(result.failingPageUrl).toBeNull();
      expect(result.failingPageAriaSnapshot).toBe(FAILING_PAGE_SNAPSHOT);
    });

    it("scrubs the credential's username and password from the address and the snapshot", async () => {
      mockPage.url.mockReturnValue(`https://shop.example.com/account?user=${USERNAME}&hint=${PASSWORD}`);
      mockLocator.ariaSnapshot.mockResolvedValue(
        `- text: Signed in as ${USERNAME}\n- textbox "Password": ${PASSWORD}`,
      );
      mockLocator.waitFor.mockRejectedValue(new Error("locator.waitFor: Timeout 10000ms exceeded."));

      const result = await runActionPlan(buildRunRequest());

      expect(result.failedStepNumber).toBe(4);
      expect(result.failingPageUrl).toBe("https://shop.example.com/account?user=••••••&hint=••••••");
      expect(result.failingPageAriaSnapshot).toBe('- text: Signed in as ••••••\n- textbox "Password": ••••••');
    });

    it("removes NUL characters from the snapshot", async () => {
      failTheSecondClick();
      mockLocator.ariaSnapshot.mockResolvedValue('- heading "Before\u0000After"');

      const result = await runActionPlan(buildRunRequest({ plan: TWO_CLICK_PLAN, login: null }));

      expect(result.failingPageAriaSnapshot).toBe('- heading "BeforeAfter"');
    });

    it(`cuts a snapshot longer than ${String(MAX_SNAPSHOT_CHARACTERS)} characters, saying so at the cut`, async () => {
      failTheSecondClick();
      mockLocator.ariaSnapshot.mockResolvedValue("s".repeat(MAX_SNAPSHOT_CHARACTERS + 25));

      const result = await runActionPlan(buildRunRequest({ plan: TWO_CLICK_PLAN, login: null }));

      expect(result.failingPageAriaSnapshot).toBe(
        `${"s".repeat(MAX_SNAPSHOT_CHARACTERS)}\n# [... snapshot cut here: 25 more characters not shown ...]`,
      );
    });

    it("keeps a snapshot of exactly the limit whole", async () => {
      failTheSecondClick();
      const snapshotAtTheLimit = "s".repeat(MAX_SNAPSHOT_CHARACTERS);
      mockLocator.ariaSnapshot.mockResolvedValue(snapshotAtTheLimit);

      const result = await runActionPlan(buildRunRequest({ plan: TWO_CLICK_PLAN, login: null }));

      expect(result.failingPageAriaSnapshot).toBe(snapshotAtTheLimit);
    });
  });

  describe("the 5 minute time limit", () => {
    /** How a pending `page.waitForURL()` can be ended. */
    interface PendingWaitForUrl {
      resolve: () => void;
      reject: (error: Error) => void;
    }

    /**
     * Makes the plan's `waitForUrl` step wait until the browser is closed, like
     * a real `page.waitForURL()` whose address never comes, and makes closing
     * the browser end it with the given outcome.
     * @param endWaitForUrl - What closing the browser does to the pending wait
     */
    function holdWaitForUrlUntilBrowserCloses(
      endWaitForUrl: (settleWaitForUrl: PendingWaitForUrl) => void,
    ): void {
      let pendingWaitForUrl: PendingWaitForUrl | null = null;
      mockPage.waitForURL.mockImplementation(
        () =>
          new Promise<void>((resolve, reject) => {
            pendingWaitForUrl = { resolve, reject };
          }),
      );
      mockBrowser.close.mockImplementation(() => {
        if (pendingWaitForUrl !== null) endWaitForUrl(pendingWaitForUrl);
        return Promise.resolve();
      });
    }

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    });

    it("screenshots, then closes the browser, so the pending step rejects and the run reports the time limit", async () => {
      holdWaitForUrlUntilBrowserCloses(({ reject }) => {
        reject(new Error("page.waitForURL: Target page, context or browser has been closed"));
      });
      const run = runActionPlan(buildRunRequest({ plan: WAIT_FOR_URL_PLAN, login: null }));
      let runHasFinished = false;
      void run.then(() => {
        runHasFinished = true;
      });

      await vi.advanceTimersByTimeAsync(PLAN_RUN_TIMEOUT_MS - 1);
      expect(runHasFinished).toBe(false);
      // Only the start page's step screenshot so far.
      expect(readScreenshotPaths()).toEqual([path.join(RUN_DIRECTORY, START_PAGE_SCREENSHOT_FILE_NAME)]);

      await vi.advanceTimersByTimeAsync(1);
      const result = await run;

      expect(result).toMatchObject({
        succeeded: false,
        timedOut: true,
        errorMessage: TIME_LIMIT_MESSAGE,
        failedStepNumber: 1,
        failureScreenshotWasCaptured: true,
      });
      expect(readOutputLines(result.output).at(-1)).toBe(`✘ Stopped at step 1: ${TIME_LIMIT_MESSAGE}`);
      expect(countFailureScreenshotCalls()).toBe(1);
      expect(mockPage.screenshot).toHaveBeenCalledWith({
        path: FAILURE_SCREENSHOT_PATH,
        timeout: PLAN_STEP_TIMEOUT_MS,
      });
      expect(readFailureScreenshotCallOrder()).toBeLessThan(mockBrowser.close.mock.invocationCallOrder[0]);
      // The step that never finished gets no step screenshot.
      expect(result.stepScreenshots.map((stepScreenshot) => stepScreenshot.moment)).toEqual(["startPage"]);
    });

    it("captures the screenshot, the address, and the aria snapshot, in that order, before closing the browser", async () => {
      holdWaitForUrlUntilBrowserCloses(({ reject }) => {
        reject(new Error("page.waitForURL: Target page, context or browser has been closed"));
      });
      const run = runActionPlan(buildRunRequest({ plan: WAIT_FOR_URL_PLAN, login: null }));

      await vi.advanceTimersByTimeAsync(PLAN_RUN_TIMEOUT_MS);
      const result = await run;

      expect(result).toMatchObject({
        timedOut: true,
        failureScreenshotWasCaptured: true,
        failingPageUrl: FAILING_PAGE_URL,
        failingPageAriaSnapshot: FAILING_PAGE_SNAPSHOT,
      });
      expect(mockLocator.ariaSnapshot).toHaveBeenCalledTimes(1);
      // The failure screenshot, then the address read right after it, then the snapshot, then the close.
      const failureScreenshotCallOrder = readFailureScreenshotCallOrder() ?? Number.NaN;
      const addressReadAfterTheFailureScreenshot = mockPage.url.mock.invocationCallOrder.find(
        (callOrder) => callOrder > failureScreenshotCallOrder,
      );
      expect(addressReadAfterTheFailureScreenshot).toBeDefined();
      expect(addressReadAfterTheFailureScreenshot).toBeLessThan(mockLocator.ariaSnapshot.mock.invocationCallOrder[0]);
      expect(mockLocator.ariaSnapshot.mock.invocationCallOrder[0]).toBeLessThan(mockBrowser.close.mock.invocationCallOrder[0]);
    });

    it("reports no screenshot, without trying again, when the time-limit screenshot fails", async () => {
      holdWaitForUrlUntilBrowserCloses(({ reject }) => {
        reject(new Error("page.waitForURL: Target closed"));
      });
      mockPage.screenshot.mockRejectedValue(new Error("page.screenshot: Timeout 10000ms exceeded."));
      const run = runActionPlan(buildRunRequest({ plan: WAIT_FOR_URL_PLAN, login: null }));

      await vi.advanceTimersByTimeAsync(PLAN_RUN_TIMEOUT_MS);
      const result = await run;

      expect(result).toMatchObject({ timedOut: true, failureScreenshotWasCaptured: false });
      expect(countFailureScreenshotCalls()).toBe(1);
    });

    it("reports no step number when the time limit hit during the login", async () => {
      mockLogInWithCredential.mockImplementation(
        () =>
          new Promise((resolve) => {
            mockBrowser.close.mockImplementation(() => {
              resolve({ loggedIn: false, errorMessage: "The login page could not be loaded: Target closed" });
              return Promise.resolve();
            });
          }),
      );
      const run = runActionPlan(buildRunRequest());

      await vi.advanceTimersByTimeAsync(PLAN_RUN_TIMEOUT_MS);
      const result = await run;

      expect(result).toMatchObject({
        succeeded: false,
        timedOut: true,
        errorMessage: TIME_LIMIT_MESSAGE,
        failedStepNumber: null,
      });
      expect(readOutputLines(result.output).at(-1)).toBe(`✘ Stopped: ${TIME_LIMIT_MESSAGE}`);
      expect(mockPage.goto).not.toHaveBeenCalled();
    });

    it("still reports the time limit when the last step only finishes after it", async () => {
      holdWaitForUrlUntilBrowserCloses(({ resolve }) => {
        resolve();
      });
      const run = runActionPlan(buildRunRequest({ plan: WAIT_FOR_URL_PLAN, login: null }));

      await vi.advanceTimersByTimeAsync(PLAN_RUN_TIMEOUT_MS);
      const result = await run;

      expect(result).toMatchObject({
        succeeded: false,
        timedOut: true,
        errorMessage: TIME_LIMIT_MESSAGE,
        failedStepNumber: null,
      });
    });

    it("clears the time limit once a run finishes in time", async () => {
      const result = await runActionPlan(buildRunRequest());

      expect(result.succeeded).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});

describe("runActionPlan with parameters", () => {
  /** A plan that types a name, clicks Create, then checks the heading. */
  const CREATE_PLAN = buildPlan([
    buildStep("fill", { target: { label: "Project name" }, value: "Apollo 7" }),
    buildStep("click", { target: { role: "button", name: "Create project" } }),
    buildStep("expectVisible", { target: { role: "heading", name: "Apollo 7" } }),
  ]);

  /**
   * Builds a fake handle on the form the confirm button sits in.
   * @param formStates - What each look at the form reports, in order (the last one repeats)
   * @returns The handle
   */
  function buildFormHandle(...formStates: { formIsGone: boolean; formShowsAnInvalidField: boolean }[]): {
    evaluate: Mock;
  } {
    const evaluate = vi.fn();
    for (const formState of formStates) evaluate.mockResolvedValueOnce(formState);
    evaluate.mockResolvedValue(formStates.at(-1));
    return { evaluate };
  }

  it("skips the steps of a blank optional parameter, and logs them as skipped", async () => {
    const result = await runActionPlan(
      buildRunRequest({
        plan: TWO_CLICK_PLAN,
        login: null,
        parameterRun: { ...NO_PARAMETER_RUN, skippedStepNumbers: [1] },
      }),
    );

    expect(result.succeeded).toBe(true);
    expect(readOutputLines(result.output)).toContain('Step 1: skipped (its parameter was left blank) - Click link "Shoes"');
    expect(mockPage.getByRole).toHaveBeenCalledTimes(1);
    expect(mockPage.getByRole).toHaveBeenCalledWith("button", { name: "Pay" });
  });

  it("types an added field right after the step it follows, and reports a failure there", async () => {
    const addedField = {
      afterStepNumber: 1,
      step: buildStep("fill", { target: { label: "Notes" }, value: "Some notes" }),
      parameterKey: "notes",
    };
    const result = await runActionPlan(
      buildRunRequest({ plan: TWO_CLICK_PLAN, login: null, parameterRun: { ...NO_PARAMETER_RUN, insertedSteps: [addedField] } }),
    );
    expect(readOutputLines(result.output)).toContain('Step 1 (added field): Type into the field labelled "Notes"');
    expect(mockLocator.pressSequentially).toHaveBeenCalledWith("Some notes", expect.any(Object));

    mockLocator.pressSequentially.mockRejectedValue(new Error("element is not editable"));
    const failedResult = await runActionPlan(
      buildRunRequest({ plan: TWO_CLICK_PLAN, login: null, parameterRun: { ...NO_PARAMETER_RUN, insertedSteps: [addedField] } }),
    );
    expect(failedResult).toMatchObject({
      succeeded: false,
      failedStepNumber: 1,
      errorMessage: "The added field after step 1 could not be filled in: element is not editable",
    });
  });

  it("reads the fields around each parameter step, and goes on without a reading that fails", async () => {
    mockLocator.evaluate.mockResolvedValueOnce({
      fields: [
        {
          tagName: "input",
          typeAttribute: null,
          roleAttribute: null,
          allowsMultiple: false,
          label: "Project name *",
          placeholder: null,
          isRequired: true,
          containerNumber: 1,
          containerName: "New project",
        },
      ],
      startFieldIndex: 0,
    });
    const result = await runActionPlan(
      buildRunRequest({ plan: CREATE_PLAN, login: null, parameterRun: { ...NO_PARAMETER_RUN, readFieldsAfterStepNumbers: [1] } }),
    );

    expect(result.fieldReadings).toEqual([
      {
        stepNumber: 1,
        pageUrl: FAILING_PAGE_URL,
        fields: [
          {
            role: "textbox",
            inputType: "text",
            label: "Project name",
            placeholder: null,
            isRequired: true,
            containerNumber: 1,
            containerName: "New project",
          },
        ],
        targetFieldIndex: 0,
      },
    ]);

    mockLocator.evaluate.mockRejectedValueOnce(new Error("Timeout 2000ms exceeded"));
    const unreadResult = await runActionPlan(
      buildRunRequest({ plan: CREATE_PLAN, login: null, parameterRun: { ...NO_PARAMETER_RUN, readFieldsAfterStepNumbers: [1] } }),
    );
    expect(unreadResult.succeeded).toBe(true);
    expect(unreadResult.fieldReadings).toEqual([]);
  });

  it("scrubs secret parameter values from errors and the log", async () => {
    mockLocator.click.mockRejectedValue(new Error('Could not click "s3cret value"'));
    const result = await runActionPlan(
      buildRunRequest({
        plan: TWO_CLICK_PLAN,
        login: null,
        parameterRun: { ...NO_PARAMETER_RUN, secretValues: ["s3cret value"] },
      }),
    );
    expect(result.errorMessage).toBe('Could not click "••••••"');
    expect(result.output).not.toContain("s3cret value");
  });

  it("records a confirm step that showed no error - the form went away", async () => {
    mockLocator.evaluateHandle.mockResolvedValue(buildFormHandle({ formIsGone: true, formShowsAnInvalidField: false }));
    const result = await runActionPlan(
      buildRunRequest({ plan: CREATE_PLAN, login: null, parameterRun: { ...NO_PARAMETER_RUN, confirmStepNumber: 2 } }),
    );

    expect(result).toMatchObject({ succeeded: true, confirmStepSucceeded: true, pageUrlAfterConfirm: FAILING_PAGE_URL });
    expect(readOutputLines(result.output)).toContain("✔ Confirmed - no error showed, so the new object is recorded");
  });

  it("records a confirm step that moved the page on, even with no form found around the button", async () => {
    mockLocator.evaluateHandle.mockRejectedValue(new Error("no element"));
    mockPage.url.mockReturnValueOnce("https://shop.example.com/projects/new").mockReturnValue("https://shop.example.com/projects/abc");
    const result = await runActionPlan(
      buildRunRequest({ plan: CREATE_PLAN, login: null, parameterRun: { ...NO_PARAMETER_RUN, confirmStepNumber: 2 } }),
    );
    expect(result.confirmStepSucceeded).toBe(true);
    expect(result.pageUrlAfterConfirm).toBe("https://shop.example.com/projects/abc");
  });

  it("does not record a confirm step that showed a new error alert, and goes on with the run", async () => {
    mockLocator.allInnerTexts.mockResolvedValueOnce(["Welcome"]).mockResolvedValue(["Welcome", "That name is already taken\nTry another"]);
    mockLocator.evaluateHandle.mockResolvedValue(buildFormHandle({ formIsGone: false, formShowsAnInvalidField: false }));
    const result = await runActionPlan(
      buildRunRequest({ plan: CREATE_PLAN, login: null, parameterRun: { ...NO_PARAMETER_RUN, confirmStepNumber: 2 } }),
    );

    expect(result).toMatchObject({ succeeded: true, confirmStepSucceeded: false });
    expect(readOutputLines(result.output)).toContain(
      '✘ The confirm step showed an error (the page showed "That name is already taken"), so no new object is recorded',
    );
  });

  it("does not record a confirm step whose form shows an invalid field", async () => {
    mockLocator.evaluateHandle.mockResolvedValue(buildFormHandle({ formIsGone: false, formShowsAnInvalidField: true }));
    const result = await runActionPlan(
      buildRunRequest({ plan: CREATE_PLAN, login: null, parameterRun: { ...NO_PARAMETER_RUN, confirmStepNumber: 2 } }),
    );
    expect(result.confirmStepSucceeded).toBe(false);
    expect(readOutputLines(result.output)).toContain(
      "✘ The confirm step showed an error (the form still shows a field marked invalid), so no new object is recorded",
    );
  });

  it("records a confirm step - Enter, with no button - after watching a page that shows nothing new", async () => {
    mockLocator.allInnerTexts.mockRejectedValue(new Error("page closed"));
    const pressEnterPlan = buildPlan([
      buildStep("fill", { target: { label: "Project name" }, value: "Apollo 7" }),
      buildStep("press", { value: "Enter" }),
    ]);
    const result = await runActionPlan(
      buildRunRequest({ plan: pressEnterPlan, login: null, parameterRun: { ...NO_PARAMETER_RUN, confirmStepNumber: 2 } }),
    );
    expect(result.confirmStepSucceeded).toBe(true);
    expect(mockLocator.evaluateHandle).not.toHaveBeenCalled();
  });

  it("treats a form check that fails as no news", async () => {
    mockLocator.evaluateHandle.mockResolvedValue({ evaluate: vi.fn().mockRejectedValue(new Error("context destroyed")) });
    mockPage.url.mockReturnValueOnce("https://shop.example.com/projects/new").mockReturnValue("https://shop.example.com/projects/abc");
    const result = await runActionPlan(
      buildRunRequest({ plan: CREATE_PLAN, login: null, parameterRun: { ...NO_PARAMETER_RUN, confirmStepNumber: 2 } }),
    );
    expect(result.confirmStepSucceeded).toBe(true);
  });

  it("fails the run at a confirm step that cannot be clicked, and records no object", async () => {
    mockLocator.evaluateHandle.mockResolvedValue(buildFormHandle({ formIsGone: false, formShowsAnInvalidField: false }));
    // Typing into the name field clicks it first; the confirm button is the second click.
    mockLocator.click.mockResolvedValueOnce(undefined).mockRejectedValue(new Error("element is disabled"));
    const result = await runActionPlan(
      buildRunRequest({ plan: CREATE_PLAN, login: null, parameterRun: { ...NO_PARAMETER_RUN, confirmStepNumber: 2 } }),
    );
    expect(result).toMatchObject({ succeeded: false, failedStepNumber: 2, confirmStepSucceeded: false });
  });

  it("leaves the confirm check empty when the run never reaches the confirm step", async () => {
    mockLocator.pressSequentially.mockRejectedValue(new Error("no such field"));
    const result = await runActionPlan(
      buildRunRequest({ plan: CREATE_PLAN, login: null, parameterRun: { ...NO_PARAMETER_RUN, confirmStepNumber: 2 } }),
    );
    expect(result).toMatchObject({ succeeded: false, failedStepNumber: 1, confirmStepSucceeded: null, pageUrlAfterConfirm: null });
  });
});

describe("alertReadsAsAnError", () => {
  it("reads an alert as an error unless it reads as a success with no error word", () => {
    expect(alertReadsAsAnError("That name is already taken")).toBe(true);
    expect(alertReadsAsAnError("Project created")).toBe(false);
    expect(alertReadsAsAnError("Saved successfully")).toBe(false);
    expect(alertReadsAsAnError("Created, but the upload failed")).toBe(true);
    expect(alertReadsAsAnError("Heads up: maintenance tonight")).toBe(true);
  });
});

describe("runPlanStep", () => {
  /**
   * Runs one step on the fake page.
   * @param step - The step
   * @param context - What the step is handed; a logged-in context by default
   * @returns Resolves once the step is done
   */
  function runStep(step: PlanStep, context: PlanStepContext = buildStepContext()): Promise<void> {
    return runPlanStep(fakePage, step, context);
  }

  const BUTTON: PlanTarget = { role: "button", name: "Sign in" };

  describe("finding the target", () => {
    it.each<[string, PlanTarget, Mock, unknown[]]>([
      ["role and name", { role: "button", name: "Sign in" }, mockPage.getByRole, ["button", { name: "Sign in" }]],
      ["role with no name", { role: "navigation", name: "" }, mockPage.getByRole, ["navigation"]],
      ["label", { label: "Email" }, mockPage.getByLabel, ["Email"]],
      ["placeholder", { placeholder: "Search" }, mockPage.getByPlaceholder, ["Search"]],
      ["text", { text: "Welcome back" }, mockPage.getByText, ["Welcome back"]],
      ["alt text", { altText: "Company logo" }, mockPage.getByAltText, ["Company logo"]],
      ["title", { title: "Close" }, mockPage.getByTitle, ["Close"]],
      ["CSS", { css: "#main > .card" }, mockPage.locator, ["#main > .card"]],
    ])("finds a target by %s", async (_targetKind, target, expectedFinder, expectedArguments) => {
      await runStep(buildStep("click", { target }));

      expect(expectedFinder).toHaveBeenCalledTimes(1);
      expect(expectedFinder).toHaveBeenCalledWith(...expectedArguments);
      expect(mockLocator.click).toHaveBeenCalledTimes(1);
    });

    it("throws when a step that needs a target has none", async () => {
      await expect(runStep(buildStep("click"))).rejects.toThrow("The click step needs a target");
      expect(countPlaywrightCalls()).toBe(0);
    });

    it("throws when a step that needs a value has none", async () => {
      await expect(runStep(buildStep("goto"))).rejects.toThrow("The goto step needs a value");
      await expect(runStep(buildStep("fill", { target: { label: "Email" } }))).rejects.toThrow(
        "The fill step needs a value",
      );
      expect(mockLocator.click).not.toHaveBeenCalled();
    });
  });

  it("goto opens the URL", async () => {
    await runStep(buildStep("goto", { value: "https://shop.example.com/cart" }));

    expect(mockPage.goto).toHaveBeenCalledWith("https://shop.example.com/cart");
  });

  it("click clicks the target", async () => {
    await runStep(buildStep("click", { target: BUTTON }));

    expect(mockLocator.click).toHaveBeenCalledWith();
  });

  it("doubleClick double-clicks the target", async () => {
    await runStep(buildStep("doubleClick", { target: BUTTON }));

    expect(mockLocator.dblclick).toHaveBeenCalledWith();
    expect(mockLocator.click).not.toHaveBeenCalled();
  });

  it("hover hovers over the target", async () => {
    await runStep(buildStep("hover", { target: BUTTON }));

    expect(mockLocator.hover).toHaveBeenCalledWith();
  });

  describe("fill", () => {
    it("clicks the field, selects what is there, and types one key at a time", async () => {
      await runStep(buildStep("fill", { target: { label: "Search" }, value: "blue shoes" }));

      expect(mockLocator.click).toHaveBeenCalledWith();
      expect(mockLocator.press).toHaveBeenCalledWith("ControlOrMeta+A");
      expect(mockLocator.pressSequentially).toHaveBeenCalledWith("blue shoes", {
        delay: TYPING_DELAY_MS,
        timeout: PLAN_STEP_TIMEOUT_MS + "blue shoes".length * TYPING_DELAY_MS,
      });
      expect(TYPING_DELAY_MS).toBe(100);
      expectCalledInOrder(mockLocator.click, mockLocator.press, mockLocator.pressSequentially);
    });

    it("gives a long text a longer timeout, 100 ms per character", async () => {
      const longText = "a".repeat(500);

      await runStep(buildStep("fill", { target: { label: "Notes" }, value: longText }));

      expect(mockLocator.pressSequentially).toHaveBeenCalledWith(longText, { delay: 100, timeout: 60_000 });
    });

    it("clears the field with Backspace when the text is empty", async () => {
      await runStep(buildStep("fill", { target: { label: "Search" }, value: "" }));

      expect(mockLocator.press.mock.calls).toEqual([["ControlOrMeta+A"], ["Backspace"]]);
      expect(mockLocator.pressSequentially).not.toHaveBeenCalled();
    });

    it("types the credential's username and password for their placeholders on the website", async () => {
      await runStep(buildStep("fill", { target: { label: "Email" }, value: "{{credential.username}}" }));
      await runStep(buildStep("fill", { target: { label: "Password" }, value: "{{credential.password}}" }));

      expect(mockLocator.pressSequentially.mock.calls).toEqual([
        [USERNAME, { delay: 100, timeout: PLAN_STEP_TIMEOUT_MS + USERNAME.length * 100 }],
        [PASSWORD, { delay: 100, timeout: PLAN_STEP_TIMEOUT_MS + PASSWORD.length * 100 }],
      ]);
    });

    it("types the credential on the login page's own origin too", async () => {
      mockPage.url.mockReturnValue("https://auth.example.com/login?next=/");

      await runStep(buildStep("fill", { target: { label: "Email" }, value: "{{credential.username}}" }));

      expect(mockLocator.pressSequentially).toHaveBeenCalledWith(USERNAME, expect.any(Object));
    });

    it("refuses to type the credential on another site", async () => {
      mockPage.url.mockReturnValue("https://evil.example/login");

      await expect(
        runStep(buildStep("fill", { target: { label: "Password" }, value: "{{credential.password}}" })),
      ).rejects.toThrow("Refusing to type the credential on https://evil.example, which is not this website");
      expect(mockLocator.click).not.toHaveBeenCalled();
      expect(mockLocator.pressSequentially).not.toHaveBeenCalled();
    });

    it("names the whole address when the page is not on an http/https site", async () => {
      mockPage.url.mockReturnValue("about:blank");

      await expect(
        runStep(buildStep("fill", { target: { label: "Email" }, value: "{{credential.username}}" })),
      ).rejects.toThrow("Refusing to type the credential on about:blank, which is not this website");
    });

    it("throws when a placeholder needs a credential the run does not have", async () => {
      await expect(
        runStep(
          buildStep("fill", { target: { label: "Password" }, value: "{{credential.password}}" }),
          buildStepContext({ credentialValues: null }),
        ),
      ).rejects.toThrow("{{credential.password}} needs a credential, but this action runs logged out");
      expect(mockLocator.pressSequentially).not.toHaveBeenCalled();
    });

    it("types literal text without a credential or a check of the page's address", async () => {
      mockPage.url.mockReturnValue("https://evil.example/");

      await runStep(
        buildStep("fill", { target: { label: "Search" }, value: "shoes" }),
        buildStepContext({ credentialValues: null }),
      );

      expect(mockLocator.pressSequentially).toHaveBeenCalledWith("shoes", expect.any(Object));
      expect(mockPage.url).not.toHaveBeenCalled();
    });
  });

  describe("press", () => {
    it("presses the key wherever the focus is when there is no target", async () => {
      await runStep(buildStep("press", { value: "Enter" }));

      expect(mockPage.keyboard.press).toHaveBeenCalledWith("Enter");
      expect(mockLocator.press).not.toHaveBeenCalled();
    });

    it("presses the key in the target when there is one", async () => {
      await runStep(buildStep("press", { target: { placeholder: "Search" }, value: "Tab" }));

      expect(mockPage.getByPlaceholder).toHaveBeenCalledWith("Search");
      expect(mockLocator.press).toHaveBeenCalledWith("Tab");
      expect(mockPage.keyboard.press).not.toHaveBeenCalled();
    });
  });

  it("check checks the target", async () => {
    await runStep(buildStep("check", { target: { role: "checkbox", name: "Remember me" } }));

    expect(mockLocator.check).toHaveBeenCalledWith();
  });

  it("uncheck unchecks the target", async () => {
    await runStep(buildStep("uncheck", { target: { role: "checkbox", name: "Newsletter" } }));

    expect(mockLocator.uncheck).toHaveBeenCalledWith();
  });

  it("selectOption picks the option by its visible label", async () => {
    await runStep(buildStep("selectOption", { target: { label: "Size" }, value: "Large" }));

    expect(mockLocator.selectOption).toHaveBeenCalledWith({ label: "Large" });
  });

  it("scrollIntoView scrolls the target into view", async () => {
    await runStep(buildStep("scrollIntoView", { target: { css: "#footer" } }));

    expect(mockLocator.scrollIntoViewIfNeeded).toHaveBeenCalledWith();
  });

  it("scroll turns the mouse wheel by the number of pixels", async () => {
    await runStep(buildStep("scroll", { value: "-600" }));

    expect(mockPage.mouse.wheel).toHaveBeenCalledWith(0, -600);
  });

  describe("uploadFile", () => {
    it("waits for the file chooser, clicks the opener, and picks the file from the uploads folder", async () => {
      await runStep(buildStep("uploadFile", { target: { role: "button", name: "Upload" }, value: "report.pdf" }));

      expect(mockPage.waitForEvent).toHaveBeenCalledWith("filechooser");
      expect(mockLocator.click).toHaveBeenCalledWith();
      expect(mockFileChooser.setFiles).toHaveBeenCalledWith(path.resolve(UPLOADS_DIRECTORY, "report.pdf"));
      expectCalledInOrder(mockPage.waitForEvent, mockLocator.click, mockFileChooser.setFiles);
    });

    it.each(["../secrets.txt", "sub/report.pdf", "..", "/etc/passwd"])(
      "refuses %j, which is not directly in the uploads folder",
      async (fileName) => {
        await expect(
          runStep(buildStep("uploadFile", { target: { role: "button", name: "Upload" }, value: fileName })),
        ).rejects.toThrow(`"${fileName}" is not a file in the uploads folder`);
        expect(mockPage.waitForEvent).not.toHaveBeenCalled();
        expect(mockLocator.click).not.toHaveBeenCalled();
      },
    );

    it("fails when no file chooser opens", async () => {
      mockPage.waitForEvent.mockRejectedValue(new Error("page.waitForEvent: Timeout 10000ms exceeded"));

      await expect(
        runStep(buildStep("uploadFile", { target: { role: "button", name: "Upload" }, value: "report.pdf" })),
      ).rejects.toThrow("page.waitForEvent: Timeout 10000ms exceeded");
      expect(mockFileChooser.setFiles).not.toHaveBeenCalled();
    });

    it("keeps the unawaited chooser wait from becoming an unhandled rejection when the click fails", async () => {
      mockPage.waitForEvent.mockImplementation(() =>
        Promise.reject(new Error("page.waitForEvent: Target page has been closed")),
      );
      mockLocator.click.mockRejectedValue(new Error("locator.click: Target page has been closed"));

      const unhandledRejections = await collectUnhandledRejections(async () => {
        await expect(
          runStep(buildStep("uploadFile", { target: { role: "button", name: "Upload" }, value: "report.pdf" })),
        ).rejects.toThrow("locator.click: Target page has been closed");
      });

      expect(unhandledRejections).toEqual([]);
    });
  });

  describe("respondToNextDialog", () => {
    /**
     * Reads the handler the step registered for the next dialog.
     * @returns The handler
     */
    function readDialogHandler(): (dialog: FakeDialog) => void {
      const [eventName, handleDialog] = mockPage.once.mock.calls[0] as [string, (dialog: FakeDialog) => void];
      expect(eventName).toBe("dialog");
      return handleDialog;
    }

    /**
     * Builds a dialog whose answers resolve.
     * @returns The dialog
     */
    function buildDialog(): FakeDialog {
      return { accept: vi.fn().mockResolvedValue(undefined), dismiss: vi.fn().mockResolvedValue(undefined) };
    }

    it("answers only the next dialog, without waiting for it", async () => {
      await runStep(buildStep("respondToNextDialog", { value: "accept" }));

      expect(mockPage.once).toHaveBeenCalledTimes(1);
      expect(mockPage.once).toHaveBeenCalledWith("dialog", expect.any(Function));
    });

    it("accepts the dialog for accept", async () => {
      await runStep(buildStep("respondToNextDialog", { value: "accept" }));
      const dialog = buildDialog();

      readDialogHandler()(dialog);

      expect(dialog.accept).toHaveBeenCalledTimes(1);
      expect(dialog.dismiss).not.toHaveBeenCalled();
    });

    it("dismisses the dialog for dismiss", async () => {
      await runStep(buildStep("respondToNextDialog", { value: "dismiss" }));
      const dialog = buildDialog();

      readDialogHandler()(dialog);

      expect(dialog.dismiss).toHaveBeenCalledTimes(1);
      expect(dialog.accept).not.toHaveBeenCalled();
    });

    it("swallows the rejection of a dialog answered as the page closes", async () => {
      await runStep(buildStep("respondToNextDialog", { value: "accept" }));
      const dialog = buildDialog();
      dialog.accept.mockRejectedValue(new Error("dialog.accept: Target page has been closed"));

      const unhandledRejections = await collectUnhandledRejections(() => {
        readDialogHandler()(dialog);
        return Promise.resolve();
      });

      expect(dialog.accept).toHaveBeenCalledTimes(1);
      expect(unhandledRejections).toEqual([]);
    });
  });

  it("waitForUrl waits for the pattern exactly as written, never as a RegExp", async () => {
    await runStep(buildStep("waitForUrl", { value: "**/order/*/confirmation" }));

    expect(mockPage.waitForURL).toHaveBeenCalledWith("**/order/*/confirmation");
  });

  it("expectVisible waits for the target to be visible", async () => {
    await runStep(buildStep("expectVisible", { target: { text: "Order placed" } }));

    expect(mockLocator.waitFor).toHaveBeenCalledWith({ state: "visible" });
  });

  it("expectHidden waits for the target to be hidden", async () => {
    await runStep(buildStep("expectHidden", { target: { role: "dialog", name: "" } }));

    expect(mockPage.getByRole).toHaveBeenCalledWith("dialog");
    expect(mockLocator.waitFor).toHaveBeenCalledWith({ state: "hidden" });
  });

  it("log makes no Playwright call and writes nothing itself", async () => {
    const context = buildStepContext();

    await runStep(buildStep("log", { value: "Cart opened" }), context);

    expect(countPlaywrightCalls()).toBe(0);
    expect(context.log).not.toHaveBeenCalled();
  });

  it("throws for an action that is not allowed, without touching the page", async () => {
    const unknownStep = { action: "evaluate", target: null, value: "process.exit()" } as unknown as PlanStep;

    await expect(runStep(unknownStep)).rejects.toThrow('"evaluate" is not an allowed step action');
    expect(countPlaywrightCalls()).toBe(0);
  });
});

describe("describePlanTarget", () => {
  it.each<[PlanTarget, string]>([
    [{ role: "button", name: "Sign in" }, 'button "Sign in"'],
    [{ role: "navigation", name: "" }, "the navigation"],
    [{ label: "Email" }, 'the field labelled "Email"'],
    [{ placeholder: "Search" }, 'the field with placeholder "Search"'],
    [{ text: "Welcome back" }, 'the text "Welcome back"'],
    [{ altText: "Company logo" }, 'the image "Company logo"'],
    [{ title: "Close" }, 'the element titled "Close"'],
    [{ css: "#main > .card" }, 'the element matching CSS "#main > .card"'],
  ])("describes %j as %j", (target, expectedDescription) => {
    expect(describePlanTarget(target)).toBe(expectedDescription);
  });
});

describe("describePlanStep", () => {
  it.each<[PlanStep, string]>([
    [buildStep("goto", { value: "https://shop.example.com/cart" }), "Go to https://shop.example.com/cart"],
    [buildStep("click", { target: { role: "button", name: "Sign in" } }), 'Click button "Sign in"'],
    [buildStep("doubleClick", { target: { text: "Row 1" } }), 'Double-click the text "Row 1"'],
    [buildStep("hover", { target: { title: "Help" } }), 'Hover over the element titled "Help"'],
    [buildStep("fill", { target: { label: "Email" }, value: "someone@example.com" }), 'Type into the field labelled "Email"'],
    [buildStep("press", { value: "Enter" }), "Press Enter"],
    [buildStep("press", { target: { placeholder: "Search" }, value: "Enter" }), 'Press Enter in the field with placeholder "Search"'],
    [buildStep("check", { target: { role: "checkbox", name: "Remember me" } }), 'Check checkbox "Remember me"'],
    [buildStep("uncheck", { target: { role: "checkbox", name: "Newsletter" } }), 'Uncheck checkbox "Newsletter"'],
    [buildStep("selectOption", { target: { label: "Size" }, value: "Large" }), 'Select "Large" in the field labelled "Size"'],
    [buildStep("scrollIntoView", { target: { css: "#footer" } }), 'Scroll to the element matching CSS "#footer"'],
    [buildStep("scroll", { value: "600" }), "Scroll by 600 pixels"],
    [buildStep("uploadFile", { target: { role: "button", name: "Upload" }, value: "report.pdf" }), 'Upload "report.pdf" with button "Upload"'],
    [buildStep("respondToNextDialog", { value: "accept" }), 'Answer the next browser dialog with "accept"'],
    [buildStep("waitForUrl", { value: "**/done" }), "Wait for the address **/done"],
    [buildStep("expectVisible", { target: { altText: "Logo" } }), 'Check that the image "Logo" is visible'],
    [buildStep("expectHidden", { target: { role: "dialog", name: "" } }), "Check that the dialog is hidden"],
    [buildStep("log", { value: "Cart opened" }), "Note: Cart opened"],
  ])("describes %j as %j", (step, expectedDescription) => {
    expect(describePlanStep(step)).toBe(expectedDescription);
  });

  it("never includes the text a fill types", () => {
    const passwordStep = buildStep("fill", { target: { label: "Password" }, value: "hunter2" });
    const placeholderStep = buildStep("fill", { target: { label: "Password" }, value: "{{credential.password}}" });

    expect(describePlanStep(passwordStep)).not.toContain("hunter2");
    expect(describePlanStep(placeholderStep)).not.toContain("{{");
  });

  it("leaves the value out when a step that takes one has none", () => {
    const target: PlanTarget = { label: "Field" };

    expect(describePlanStep(buildStep("goto"))).toBe("Go to ");
    expect(describePlanStep(buildStep("press"))).toBe("Press ");
    expect(describePlanStep(buildStep("press", { target }))).toBe('Press  in the field labelled "Field"');
    expect(describePlanStep(buildStep("selectOption", { target }))).toBe('Select "" in the field labelled "Field"');
    expect(describePlanStep(buildStep("scroll"))).toBe("Scroll by  pixels");
    expect(describePlanStep(buildStep("uploadFile", { target }))).toBe('Upload "" with the field labelled "Field"');
    expect(describePlanStep(buildStep("respondToNextDialog"))).toBe('Answer the next browser dialog with ""');
    expect(describePlanStep(buildStep("waitForUrl"))).toBe("Wait for the address ");
    expect(describePlanStep(buildStep("log"))).toBe("Note: ");
  });

  it("leaves the target out when a step that needs one has none", () => {
    expect(describePlanStep(buildStep("click"))).toBe("Click ");
  });
});

describe("scrubSecrets", () => {
  it("replaces every occurrence of every secret", () => {
    expect(scrubSecrets("user admin, pass s3cret, again admin", ["s3cret", "admin"])).toBe(
      "user ••••••, pass ••••••, again ••••••",
    );
  });

  it("skips empty secrets instead of scrubbing between every character", () => {
    expect(scrubSecrets("nothing secret here", ["", "s3cret"])).toBe("nothing secret here");
  });

  it("returns the message unchanged when there are no secrets", () => {
    expect(scrubSecrets("plain message", [])).toBe("plain message");
  });
});

describe("step screenshots", () => {
  /** A logged-out plan of three clicks. */
  const THREE_CLICK_PLAN = buildPlan([
    buildStep("click", { target: { role: "link", name: "Shoes" } }),
    buildStep("click", { target: { role: "link", name: "Boots" } }),
    buildStep("click", { target: { role: "button", name: "Add to cart" } }),
  ]);

  it("names a step's screenshot by its step number, padded so the folder lists them in step order", () => {
    expect(buildStepScreenshotFileName(3)).toBe("step-003.png");
    expect(buildStepScreenshotFileName(42)).toBe("step-042.png");
    expect(buildStepScreenshotFileName(100)).toBe("step-100.png");
  });

  it("takes one after the login, one after the start URL opened, and one after each step, into the run folder", async () => {
    const result = await runActionPlan(buildRunRequest({ plan: THREE_CLICK_PLAN }));

    expect(readScreenshotPaths()).toEqual([
      path.join(RUN_DIRECTORY, LOGGED_IN_SCREENSHOT_FILE_NAME),
      path.join(RUN_DIRECTORY, START_PAGE_SCREENSHOT_FILE_NAME),
      path.join(RUN_DIRECTORY, "step-001.png"),
      path.join(RUN_DIRECTORY, "step-002.png"),
      path.join(RUN_DIRECTORY, "step-003.png"),
    ]);
    expect(mockPage.screenshot).toHaveBeenCalledWith({
      path: path.join(RUN_DIRECTORY, "step-002.png"),
      timeout: PLAN_STEP_TIMEOUT_MS,
    });
    expect(result.stepScreenshots.map(({ moment, stepNumber }) => [moment, stepNumber])).toEqual([
      ["loggedIn", null],
      ["startPage", null],
      ["step", 1],
      ["step", 2],
      ["step", 3],
    ]);
    // The login screenshot comes after the login and before the start URL opens.
    const [loggedInScreenshotCallOrder, startPageScreenshotCallOrder] = mockPage.screenshot.mock.invocationCallOrder;
    expect(mockLogInWithCredential.mock.invocationCallOrder[0]).toBeLessThan(loggedInScreenshotCallOrder);
    expect(loggedInScreenshotCallOrder).toBeLessThan(mockPage.goto.mock.invocationCallOrder[0]);
    expect(mockPage.goto.mock.invocationCallOrder[0]).toBeLessThan(startPageScreenshotCallOrder);
  });

  it("waits up to the settle time for the page's load event before each one", async () => {
    await runActionPlan(buildRunRequest({ plan: THREE_CLICK_PLAN, login: null }));

    expect(mockPage.waitForLoadState).toHaveBeenCalledTimes(4);
    expect(mockPage.waitForLoadState).toHaveBeenCalledWith("load", { timeout: STEP_SCREENSHOT_SETTLE_TIMEOUT_MS });
    expect(STEP_SCREENSHOT_SETTLE_TIMEOUT_MS).toBe(2000);
    expectCalledInOrder(mockPage.waitForLoadState, mockPage.screenshot);
  });

  it("still takes the screenshot, with no error, when the page is still loading after the settle time", async () => {
    mockPage.waitForLoadState.mockRejectedValue(new MockTimeoutError("page.waitForLoadState: Timeout 2000ms exceeded."));

    const result = await runActionPlan(buildRunRequest({ plan: THREE_CLICK_PLAN, login: null }));

    expect(result.succeeded).toBe(true);
    expect(readScreenshotPaths()).toHaveLength(4);
    expect(result.stepScreenshots.every((stepScreenshot) => stepScreenshot.errorMessage === null)).toBe(true);
    expect(result.output).not.toContain("⚠");
  });

  it("takes no login screenshot for a logged-out run", async () => {
    const result = await runActionPlan(buildRunRequest({ plan: THREE_CLICK_PLAN, login: null }));

    expect(result.stepScreenshots[0]).toEqual(buildTakenStepScreenshot("startPage", null, "start-page.png"));
    expect(readScreenshotPaths()).not.toContain(path.join(RUN_DIRECTORY, LOGGED_IN_SCREENSHOT_FILE_NAME));
  });

  it("takes none for a skipped step, but one for a skipped step whose added field ran", async () => {
    const addedField = {
      afterStepNumber: 3,
      step: buildStep("fill", { target: { label: "Note" }, value: "Gift" }),
      parameterKey: "note",
    };
    const result = await runActionPlan(
      buildRunRequest({
        plan: THREE_CLICK_PLAN,
        login: null,
        parameterRun: { ...NO_PARAMETER_RUN, skippedStepNumbers: [2, 3], insertedSteps: [addedField] },
      }),
    );

    expect(result.succeeded).toBe(true);
    expect(result.stepScreenshots.map(({ stepNumber }) => stepNumber)).toEqual([null, 1, 3]);
    expect(readScreenshotPaths()).not.toContain(path.join(RUN_DIRECTORY, "step-002.png"));
  });

  it("takes none for the step that failed: its frame is the failure screenshot", async () => {
    mockLocator.click.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("locator.click: Timeout 10000ms exceeded."));

    const result = await runActionPlan(buildRunRequest({ plan: THREE_CLICK_PLAN, login: null }));

    expect(result).toMatchObject({ succeeded: false, failedStepNumber: 2, failureScreenshotWasCaptured: true });
    expect(readScreenshotPaths()).toEqual([
      path.join(RUN_DIRECTORY, START_PAGE_SCREENSHOT_FILE_NAME),
      path.join(RUN_DIRECTORY, "step-001.png"),
      FAILURE_SCREENSHOT_PATH,
    ]);
    expect(result.stepScreenshots.map(({ stepNumber }) => stepNumber)).toEqual([null, 1]);
  });

  it("records a screenshot that could not be taken with why, logs it, and still passes the run", async () => {
    const stepTwoScreenshotPath = path.join(RUN_DIRECTORY, "step-002.png");
    mockPage.screenshot.mockImplementation((options: { path: string }) =>
      options.path === stepTwoScreenshotPath
        ? Promise.reject(new Error(`page.screenshot: Timeout 10000ms exceeded typing ${PASSWORD}\nCall log: ...`))
        : Promise.resolve(Buffer.from("png")),
    );

    const result = await runActionPlan(buildRunRequest({ plan: THREE_CLICK_PLAN }));

    expect(result.succeeded).toBe(true);
    expect(result.stepScreenshots[3]).toEqual({
      moment: "step",
      stepNumber: 2,
      fileName: null,
      errorMessage: "page.screenshot: Timeout 10000ms exceeded typing ••••••",
      pageUrl: FAILING_PAGE_URL,
    });
    expect(result.stepScreenshots[4]).toEqual(buildTakenStepScreenshot("step", 3, "step-003.png"));
    expect(readOutputLines(result.output)).toContain(
      "⚠ Screenshot after step 2 could not be taken: page.screenshot: Timeout 10000ms exceeded typing ••••••",
    );
    expect(result.output).not.toContain(PASSWORD);
  });

  it("names the login and the start page in the log line of a screenshot that could not be taken", async () => {
    mockPage.screenshot.mockRejectedValue(new Error("page.screenshot: Target page, context or browser has been closed"));

    const result = await runActionPlan(buildRunRequest({ plan: buildPlan([]) }));

    expect(result.succeeded).toBe(true);
    expect(result.stepScreenshots.map(({ fileName }) => fileName)).toEqual([null, null]);
    expect(readOutputLines(result.output)).toEqual(
      expect.arrayContaining([
        "⚠ Screenshot after the login could not be taken: page.screenshot: Target page, context or browser has been closed",
        "⚠ Screenshot after opening the start URL could not be taken: page.screenshot: Target page, context or browser has been closed",
      ]),
    );
  });
});
