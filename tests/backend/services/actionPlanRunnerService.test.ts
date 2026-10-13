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
  PLAN_NAVIGATION_TIMEOUT_MS,
  PLAN_OUTPUT_CHARACTER_LIMIT,
  PLAN_RUN_SLOW_MO_MS,
  PLAN_RUN_TIMEOUT_MS,
  PLAN_STEP_TIMEOUT_MS,
  TYPING_DELAY_MS,
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
  mockLocator.ariaSnapshot.mockResolvedValue(FAILING_PAGE_SNAPSHOT);
  mockPage.keyboard.press.mockResolvedValue(undefined);
  mockPage.mouse.wheel.mockResolvedValue(undefined);
  mockPage.waitForEvent.mockResolvedValue(mockFileChooser);
  mockFileChooser.setFiles.mockResolvedValue(undefined);
  mockPage.waitForURL.mockResolvedValue(undefined);
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
    expect(mockChromium.launch).toHaveBeenCalledWith({ headless: false, slowMo: PLAN_RUN_SLOW_MO_MS });
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
    expect(mockPage.screenshot).not.toHaveBeenCalled();
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
      expect(mockPage.screenshot).not.toHaveBeenCalled();
      expect(mockPage.url).not.toHaveBeenCalled();
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
      expect(mockPage.screenshot).not.toHaveBeenCalled();

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
      expect(mockPage.screenshot).toHaveBeenCalledTimes(1);
      expect(mockPage.screenshot).toHaveBeenCalledWith({
        path: FAILURE_SCREENSHOT_PATH,
        timeout: PLAN_STEP_TIMEOUT_MS,
      });
      expectCalledInOrder(mockPage.screenshot, mockBrowser.close);
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
      expectCalledInOrder(mockPage.screenshot, mockPage.url, mockLocator.ariaSnapshot, mockBrowser.close);
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
      expect(mockPage.screenshot).toHaveBeenCalledTimes(1);
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
