import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Page } from "playwright";

/**
 * No test here launches a browser. The two page-level helpers a reload uses
 * (`navigateToUrl`, `waitForPageReadiness`) are replaced, and the page is a
 * FAKE PAGE OF BUTTONS (see `buildFakePage`): reading the buttons reports
 * `shownButtons`, clicking one moves the fake browser to where that button
 * leads (and may start requests), and a reload shows `buttonsAfterReload`.
 * The waits after each click are the real ones (`pageActionService`), paced
 * by the fake page's `waitForTimeout`. The real browser round trip is proven
 * by the manual verification run against a fixture site.
 */
const { mockNavigateToUrl, mockWaitForPageReadiness } = vi.hoisted(() => ({
  mockNavigateToUrl: vi.fn(),
  mockWaitForPageReadiness: vi.fn(),
}));

vi.mock("../../../server/services/playwrightService.js", async (importOriginal) => {
  const actualPlaywrightService =
    await importOriginal<typeof import("../../../server/services/playwrightService.js")>();
  return {
    ...actualPlaywrightService,
    navigateToUrl: mockNavigateToUrl,
    waitForPageReadiness: mockWaitForPageReadiness,
  };
});

import {
  BUTTON_CLICKS_PER_PAGE_LIMIT,
  BUTTON_CLICK_TIMEOUT_MS,
  CLICKABLE_BUTTON_SELECTOR,
  RISKY_BUTTON_WORDS,
  chooseButtonsToClick,
  followPageButtons,
  readRawPageButtons,
  type RawPageButton,
} from "../../../server/services/crawlerButtonService.js";
import {
  ACTION_REQUESTS_POLL_INTERVAL_MS,
  ACTION_REQUESTS_QUIET_WINDOW_MS,
} from "../../../server/services/pageActionService.js";

/** The page whose buttons are followed. */
const PAGE_URL = "https://example.com/sessions";
/** Its identity (origin + path). */
const PAGE_IDENTITY_URL = "https://example.com/sessions";
/** The crawl's origin. */
const CRAWL_ORIGIN = "https://example.com";
/** The website's timing settings: no minimum wait, so only the request checks wait. */
const TIMING_SETTINGS = { networkIdleTimeoutMs: 5000, screenshotMinimumWaitMs: 0 };
/** The checks one quiet window takes after a click that started no request. */
const QUIET_WINDOW_CHECKS = Array<string>(
  ACTION_REQUESTS_QUIET_WINDOW_MS / ACTION_REQUESTS_POLL_INTERVAL_MS,
).fill(`wait ${String(ACTION_REQUESTS_POLL_INTERVAL_MS)} ms`);

/**
 * Builds a button as `readRawPageButtons` reports it: visible and enabled
 * unless the overrides say otherwise.
 * @param text - The button's label
 * @param overrides - Any field to change
 * @returns The raw button
 */
function rawButton(text: string, overrides: Partial<RawPageButton> = {}): RawPageButton {
  return { text, isVisible: true, isDisabled: false, ...overrides };
}

/**
 * Reads the labels of the buttons `chooseButtonsToClick` picked.
 * @param buttons - The page's buttons
 * @param buttonMode - The crawl's button mode
 * @returns The chosen labels, in order
 */
function chooseLabels(
  buttons: RawPageButton[],
  buttonMode: Parameters<typeof chooseButtonsToClick>[1],
): string[] {
  return chooseButtonsToClick(buttons, buttonMode).map((chosenButton) => chosenButton.text);
}

describe("chooseButtonsToClick", () => {
  it("clicks no button at all in linksOnly mode", () => {
    const buttons = [rawButton("Open Yoga"), rawButton("Details")];

    expect(chooseButtonsToClick(buttons, "linksOnly")).toEqual([]);
  });

  it("picks every visible, enabled, labelled, non-risky button in allButRisky mode, in page order, with its position", () => {
    const buttons = [
      rawButton("Open Yoga"),
      rawButton("Delete session"),
      rawButton("Details"),
      rawButton("More", { isVisible: false }),
      rawButton("Next page", { isDisabled: true }),
      rawButton(""),
      rawButton("Show tips"),
    ];

    expect(chooseButtonsToClick(buttons, "allButRisky")).toEqual([
      { index: 0, text: "Open Yoga" },
      { index: 2, text: "Details" },
      { index: 6, text: "Show tips" },
    ]);
  });

  it.each(RISKY_BUTTON_WORDS)("never clicks a button labelled with the risky word %j, in any case, in any mode", (riskyWord) => {
    const buttons = [
      rawButton(riskyWord),
      rawButton(riskyWord.toUpperCase()),
      rawButton(`Please ${riskyWord} now`),
      rawButton(`Open and ${riskyWord}`),
    ];

    expect(chooseLabels(buttons, "allButRisky")).toEqual([]);
    expect(chooseLabels(buttons, "openOnly")).toEqual([]);
  });

  it.each(["Log out", "log-out", "LOG  OUT", "Sign out", "sign-out", "Log off", "Check out", "check-out"])(
    "treats the two-word form %j as risky, with a space or a hyphen",
    (riskyLabel) => {
      expect(chooseLabels([rawButton(riskyLabel)], "allButRisky")).toEqual([]);
    },
  );

  it.each(["Address book", "Newsletter", "Editorial team", "Sender details", "Orders", "Logbook", "Renewals"])(
    "matches risky words only as whole words, so %j is clicked in allButRisky mode",
    (safeLabel) => {
      expect(chooseLabels([rawButton(safeLabel)], "allButRisky")).toEqual([safeLabel]);
    },
  );

  it("picks only buttons that say \"open\" as a whole word in openOnly mode, unless they are also risky", () => {
    const buttons = [
      rawButton("Open"),
      rawButton("Open session"),
      rawButton("OPEN →"),
      rawButton("open yoga"),
      rawButton("Reopen"),
      rawButton("Opens at 9"),
      rawButton("Details"),
      rawButton("Open and delete"),
    ];

    expect(chooseLabels(buttons, "openOnly")).toEqual(["Open", "Open session", "OPEN →", "open yoga"]);
  });

  it("never picks a hidden, disabled, or unlabelled (icon-only) button, in any mode", () => {
    const buttons = [
      rawButton("Open hidden", { isVisible: false }),
      rawButton("Open archive", { isDisabled: true }),
      rawButton(""),
    ];

    expect(chooseButtonsToClick(buttons, "allButRisky")).toEqual([]);
    expect(chooseButtonsToClick(buttons, "openOnly")).toEqual([]);
  });

  it(`picks at most ${String(BUTTON_CLICKS_PER_PAGE_LIMIT)} buttons, the first ones in page order`, () => {
    const buttons = Array.from({ length: BUTTON_CLICKS_PER_PAGE_LIMIT * 2 }, (_, index) =>
      index % 2 === 0 ? rawButton(`Open ${String(index)}`) : rawButton(`Delete ${String(index)}`),
    );

    const chosenButtons = chooseButtonsToClick(buttons, "openOnly");

    expect(chosenButtons).toHaveLength(BUTTON_CLICKS_PER_PAGE_LIMIT);
    expect(chosenButtons[0]).toEqual({ index: 0, text: "Open 0" });
    expect(chosenButtons.at(-1)).toEqual({ index: 38, text: "Open 38" });
  });
});

/** One button of the fake page. */
interface FakeButton {
  /** Its label. */
  text: string;
  /** Whether it is visible; true by default. */
  isVisible?: boolean;
  /** Where clicking it sends the browser; it stays put (a dialog, a panel) when unset. */
  leadsTo?: string;
  /** When set, clicking it rejects with this. */
  clickError?: Error;
  /** How many requests clicking it starts; none by default. */
  requestsStartedByClick?: number;
}

/** How the fake page behaves; `beforeEach` resets it. */
let fakeButtonPage: {
  /** The buttons the page shows when the crawl first reads it. */
  buttons: FakeButton[];
  /** The buttons a reload shows; the same as `buttons` when null. */
  buttonsAfterReload: FakeButton[] | null;
  /** Which reads of the buttons (counting from 1) reject. */
  failingButtonReads: number[];
  /** After how many 100 ms checks the click's requests finish (Infinity: never). */
  checksUntilClickRequestsFinish: number;
};

/** The buttons the fake browser shows right now. */
let shownButtons: FakeButton[] = [];
/** What `page.url()` reports. */
let currentUrl = PAGE_URL;
/** How many times the buttons were read. */
let buttonReadCount = 0;
/** How many requests the last click started that are still running. */
let runningClickRequests = 0;
/** How many 100 ms checks were made since the last click. */
let checksSinceClick = 0;
/** What happened to the page, in order, e.g. "click Open Yoga". */
let pageActions: string[] = [];
/** The fake page's request event listeners, by event name. */
let pageListeners = new Map<string, Set<() => void>>();

/** Records the selector, the `evaluateAll` function, the `nth` position, and the click options used. */
const mockLocator = vi.fn<(selector: string) => void>();
const mockEvaluateAll = vi.fn<(pageFunction: unknown) => void>();
const mockNth = vi.fn<(index: number) => void>();
const mockClick = vi.fn<(options: { timeout: number }) => void>();

/**
 * Fires one of the fake page's events at every listener, like Playwright
 * does when a request starts, finishes, or fails.
 * @param eventName - "request", "requestfinished", or "requestfailed"
 */
function emitPageEvent(eventName: string): void {
  for (const listener of pageListeners.get(eventName) ?? []) {
    listener();
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
 * The fake locator's `evaluateAll`: reports the shown buttons the way
 * `readRawPageButtons` would, or rejects when this read is set to fail.
 * @param pageFunction - The function the crawler asked to run in the page
 * @returns The shown buttons as raw buttons
 */
function fakeEvaluateAll(pageFunction: unknown): Promise<RawPageButton[]> {
  mockEvaluateAll(pageFunction);
  buttonReadCount += 1;
  pageActions.push("read the buttons");
  const readFails = fakeButtonPage.failingButtonReads.includes(buttonReadCount);
  if (readFails) {
    return Promise.reject(new Error("locator.evaluateAll: Execution context was destroyed"));
  }
  return Promise.resolve(
    shownButtons.map((fakeButton) =>
      rawButton(fakeButton.text, { isVisible: fakeButton.isVisible ?? true }),
    ),
  );
}

/**
 * The fake locator's `nth(index).click()`: starts the button's requests and
 * moves the fake browser to where the button leads.
 * @param index - The button's position among the shown buttons
 * @param options - The click options the crawler passed
 * @returns Resolves once clicked, or rejects with the button's `clickError`
 */
function fakeClick(index: number, options: { timeout: number }): Promise<void> {
  mockClick(options);
  const clickedButton = shownButtons[index];
  pageActions.push(`click ${clickedButton.text}`);
  if (clickedButton.clickError !== undefined) {
    return Promise.reject(clickedButton.clickError);
  }
  checksSinceClick = 0;
  runningClickRequests = clickedButton.requestsStartedByClick ?? 0;
  for (let requestIndex = 0; requestIndex < runningClickRequests; requestIndex += 1) {
    emitPageEvent("request");
  }
  currentUrl = clickedButton.leadsTo ?? currentUrl;
  return Promise.resolve();
}

/**
 * The fake page's `waitForTimeout`: records the wait, and finishes the
 * click's requests after `checksUntilClickRequestsFinish` checks.
 * @param timeoutMs - How long the crawler asked to wait
 * @returns Resolves at once (no real time passes)
 */
function fakeWaitForTimeout(timeoutMs: number): Promise<void> {
  pageActions.push(`wait ${String(timeoutMs)} ms`);
  checksSinceClick += 1;
  const clickRequestsFinishNow = checksSinceClick === fakeButtonPage.checksUntilClickRequestsFinish;
  if (clickRequestsFinishNow) {
    for (let requestIndex = 0; requestIndex < runningClickRequests; requestIndex += 1) {
      emitPageEvent("requestfinished");
    }
    runningClickRequests = 0;
  }
  return Promise.resolve();
}

/**
 * Builds the fake page the buttons are followed on.
 * @returns A Page-shaped stand-in
 */
function buildFakePage(): Page {
  const fakePage = {
    locator: (selector: string) => {
      mockLocator(selector);
      return {
        evaluateAll: fakeEvaluateAll,
        nth: (index: number) => {
          mockNth(index);
          return { click: (options: { timeout: number }) => fakeClick(index, options) };
        },
      };
    },
    url: () => {
      pageActions.push("read where the click landed");
      return currentUrl;
    },
    on: (eventName: string, listener: () => void) => {
      const listeners = pageListeners.get(eventName) ?? new Set<() => void>();
      listeners.add(listener);
      pageListeners.set(eventName, listeners);
    },
    off: (eventName: string, listener: () => void) => {
      pageListeners.get(eventName)?.delete(listener);
    },
    waitForTimeout: fakeWaitForTimeout,
  };
  // Only the members above are ever called; the rest of Page is not needed.
  return fakePage as unknown as Page;
}

/**
 * Follows the fake page's buttons with the test's page, origin, and timing settings.
 * @param page - The fake page
 * @param buttonMode - The crawl's button mode
 * @param timingSettings - The website's timing settings
 * @returns What `followPageButtons` returned
 */
function followFakePageButtons(
  page: Page,
  buttonMode: Parameters<typeof followPageButtons>[4] = "allButRisky",
  timingSettings = TIMING_SETTINGS,
): ReturnType<typeof followPageButtons> {
  return followPageButtons(page, PAGE_URL, PAGE_IDENTITY_URL, CRAWL_ORIGIN, buttonMode, timingSettings);
}

describe("followPageButtons", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    fakeButtonPage = {
      buttons: [],
      buttonsAfterReload: null,
      failingButtonReads: [],
      checksUntilClickRequestsFinish: Infinity,
    };
    shownButtons = [];
    currentUrl = PAGE_URL;
    buttonReadCount = 0;
    runningClickRequests = 0;
    checksSinceClick = 0;
    pageActions = [];
    pageListeners = new Map();
    mockNavigateToUrl.mockImplementation((_page: Page, url: string) => {
      pageActions.push(`reload ${url}`);
      currentUrl = url;
      shownButtons = fakeButtonPage.buttonsAfterReload ?? fakeButtonPage.buttons;
      return Promise.resolve({ navigationCompleted: true, httpStatus: 200, durationMs: 5 });
    });
    mockWaitForPageReadiness.mockImplementation(() => {
      pageActions.push("wait until ready");
      return Promise.resolve();
    });
  });

  /**
   * Puts buttons on the fake page, as the crawl first sees it.
   * @param buttons - The page's buttons
   */
  function showButtons(buttons: FakeButton[]): void {
    fakeButtonPage.buttons = buttons;
    shownButtons = buttons;
  }

  it("clicks each chosen button on the page as crawled, reloading it before every click but the first, and returns the new pages in click order", async () => {
    showButtons([
      { text: "Open Yoga", leadsTo: "https://example.com/sessions/yoga" },
      { text: "Open Pilates", leadsTo: "https://example.com/sessions/pilates?day=mon#top" },
      { text: "Details", leadsTo: "https://example.com/sessions/details" },
    ]);
    const page = buildFakePage();

    const buttonLinks = await followFakePageButtons(page);

    expect(buttonLinks).toEqual([
      {
        buttonText: "Open Yoga",
        link: {
          identityUrl: "https://example.com/sessions/yoga",
          loadUrl: "https://example.com/sessions/yoga",
        },
      },
      {
        buttonText: "Open Pilates",
        link: {
          identityUrl: "https://example.com/sessions/pilates",
          loadUrl: "https://example.com/sessions/pilates?day=mon",
        },
      },
      {
        buttonText: "Details",
        link: {
          identityUrl: "https://example.com/sessions/details",
          loadUrl: "https://example.com/sessions/details",
        },
      },
    ]);
    expect(pageActions).toEqual([
      "read the buttons",
      "read the buttons",
      "click Open Yoga",
      ...QUIET_WINDOW_CHECKS,
      "read where the click landed",
      `reload ${PAGE_URL}`,
      "wait until ready",
      "read the buttons",
      "click Open Pilates",
      ...QUIET_WINDOW_CHECKS,
      "read where the click landed",
      `reload ${PAGE_URL}`,
      "wait until ready",
      "read the buttons",
      "click Details",
      ...QUIET_WINDOW_CHECKS,
      "read where the click landed",
    ]);
    expect(mockNavigateToUrl).toHaveBeenCalledTimes(2);
    expect(mockNavigateToUrl).toHaveBeenCalledWith(page, PAGE_URL);
    expect(mockWaitForPageReadiness).toHaveBeenCalledWith(page, TIMING_SETTINGS);
  });

  it("reads the buttons with readRawPageButtons and clicks the chosen one by its position, with the click timeout", async () => {
    showButtons([
      { text: "Delete session", leadsTo: "https://example.com/deleted" },
      { text: "Hidden", isVisible: false },
      { text: "Open Yoga", leadsTo: "https://example.com/sessions/yoga" },
    ]);

    await followFakePageButtons(buildFakePage());

    expect(mockLocator).toHaveBeenCalledWith(CLICKABLE_BUTTON_SELECTOR);
    expect(mockLocator.mock.calls.every(([selector]) => selector === CLICKABLE_BUTTON_SELECTOR)).toBe(true);
    expect(mockEvaluateAll).toHaveBeenCalledWith(readRawPageButtons);
    expect(mockNth.mock.calls).toEqual([[2]]);
    expect(mockClick.mock.calls).toEqual([[{ timeout: BUTTON_CLICK_TIMEOUT_MS }]]);
    expect(pageActions).not.toContain("click Delete session");
  });

  it("skips a button whose label changed after the reload, or that is gone, and still follows the rest", async () => {
    showButtons([
      { text: "Open Yoga", leadsTo: "https://example.com/sessions/yoga" },
      { text: "Open Pilates", leadsTo: "https://example.com/sessions/pilates" },
      { text: "Open Barre", leadsTo: "https://example.com/sessions/barre" },
      { text: "Open Spin", leadsTo: "https://example.com/sessions/spin" },
    ]);
    fakeButtonPage.buttonsAfterReload = [
      { text: "Open Yoga", leadsTo: "https://example.com/sessions/yoga" },
      { text: "Book now", leadsTo: "https://example.com/booked" },
      { text: "Open Barre", leadsTo: "https://example.com/sessions/barre" },
    ];

    const buttonLinks = await followFakePageButtons(buildFakePage(), "openOnly");

    expect(buttonLinks.map((buttonLink) => buttonLink.buttonText)).toEqual(["Open Yoga", "Open Barre"]);
    expect(pageActions.filter((action) => action.startsWith("click"))).toEqual([
      "click Open Yoga",
      "click Open Barre",
    ]);
  });

  it("keeps only clicks that land on a new page of the crawl's origin", async () => {
    showButtons([
      { text: "Show tips" },
      { text: "Next tab", leadsTo: "https://example.com/sessions?tab=2#list" },
      { text: "Partner site", leadsTo: "https://partner.example/sessions" },
      { text: "Broken", leadsTo: "chrome-error://chromewebdata/" },
      { text: "Open Yoga", leadsTo: "https://example.com/sessions/yoga" },
    ]);

    const buttonLinks = await followFakePageButtons(buildFakePage());

    expect(buttonLinks).toEqual([
      {
        buttonText: "Open Yoga",
        link: {
          identityUrl: "https://example.com/sessions/yoga",
          loadUrl: "https://example.com/sessions/yoga",
        },
      },
    ]);
    expect(pageActions.filter((action) => action.startsWith("click"))).toHaveLength(5);
  });

  it("waits for the requests a click started to finish and stay quiet before reading where it landed", async () => {
    showButtons([
      { text: "Open Yoga", leadsTo: "https://example.com/sessions/yoga", requestsStartedByClick: 2 },
    ]);
    fakeButtonPage.checksUntilClickRequestsFinish = 7;

    await followFakePageButtons(buildFakePage());

    // 7 checks while the requests ran (the 7th saw them finish), then 5 quiet ones.
    const checksAfterTheClick = pageActions.slice(pageActions.indexOf("click Open Yoga") + 1, -1);
    expect(checksAfterTheClick).toEqual(Array<string>(12).fill("wait 100 ms"));
    expect(pageActions.at(-1)).toBe("read where the click landed");
  });

  it("stops waiting for a click's requests at the website's network idle cap", async () => {
    showButtons([
      { text: "Open Yoga", leadsTo: "https://example.com/sessions/yoga", requestsStartedByClick: 1 },
    ]);

    const buttonLinks = await followFakePageButtons(buildFakePage(), "openOnly", {
      networkIdleTimeoutMs: 1000,
      screenshotMinimumWaitMs: 0,
    });

    expect(buttonLinks).toHaveLength(1);
    expect(pageActions.filter((action) => action === "wait 100 ms")).toHaveLength(10);
  });

  it("never reads where a click landed sooner than the website's minimum wait after the click", async () => {
    showButtons([{ text: "Open Yoga", leadsTo: "https://example.com/sessions/yoga" }]);

    await followFakePageButtons(buildFakePage(), "openOnly", {
      networkIdleTimeoutMs: 0,
      screenshotMinimumWaitMs: 3000,
    });

    const minimumWaitAction = pageActions[pageActions.indexOf("click Open Yoga") + 1];
    const minimumWaitMs = Number(/^wait (\d+) ms$/.exec(minimumWaitAction)?.[1]);
    expect(minimumWaitMs).toBeGreaterThan(2900);
    expect(minimumWaitMs).toBeLessThanOrEqual(3000);
    expect(pageActions.at(-1)).toBe("read where the click landed");
  });

  it("skips a button whose click fails, still follows the rest, and stops listening to the page's requests every time", async () => {
    showButtons([
      {
        text: "Open Yoga",
        clickError: new Error("locator.click: Timeout 10000ms exceeded.\nCall log: ..."),
      },
      { text: "Open Pilates", leadsTo: "https://example.com/sessions/pilates", requestsStartedByClick: 1 },
    ]);

    const buttonLinks = await followFakePageButtons(buildFakePage());

    expect(buttonLinks.map((buttonLink) => buttonLink.buttonText)).toEqual(["Open Pilates"]);
    expect(pageActions).toContain(`reload ${PAGE_URL}`);
    expect(countPageListeners()).toBe(0);
  });

  it("skips a button when the page cannot be reloaded first, or never becomes ready again", async () => {
    showButtons([
      { text: "Open A", leadsTo: "https://example.com/a" },
      { text: "Open B", leadsTo: "https://example.com/b" },
      { text: "Open C", leadsTo: "https://example.com/c" },
      { text: "Open D", leadsTo: "https://example.com/d" },
    ]);
    mockNavigateToUrl.mockImplementationOnce(() =>
      Promise.resolve({
        navigationCompleted: false,
        errorMessage: "page.goto: net::ERR_CONNECTION_RESET",
        durationMs: 5,
      }),
    );
    mockWaitForPageReadiness.mockRejectedValueOnce(new Error("page.waitForLoadState: Target closed"));

    const buttonLinks = await followFakePageButtons(buildFakePage(), "openOnly");

    expect(buttonLinks.map((buttonLink) => buttonLink.buttonText)).toEqual(["Open A", "Open D"]);
    expect(pageActions.filter((action) => action.startsWith("click"))).toEqual(["click Open A", "click Open D"]);
  });

  it("skips a button whose label cannot be read again, and still follows the rest", async () => {
    showButtons([
      { text: "Open Yoga", leadsTo: "https://example.com/sessions/yoga" },
      { text: "Open Pilates", leadsTo: "https://example.com/sessions/pilates" },
    ]);
    fakeButtonPage.failingButtonReads = [2];

    const buttonLinks = await followFakePageButtons(buildFakePage(), "openOnly");

    expect(buttonLinks.map((buttonLink) => buttonLink.buttonText)).toEqual(["Open Pilates"]);
  });

  it("returns no button links, and clicks nothing, when the page's buttons cannot be read", async () => {
    showButtons([{ text: "Open Yoga", leadsTo: "https://example.com/sessions/yoga" }]);
    fakeButtonPage.failingButtonReads = [1];

    const buttonLinks = await followFakePageButtons(buildFakePage());

    expect(buttonLinks).toEqual([]);
    expect(mockClick).not.toHaveBeenCalled();
  });

  it("clicks nothing, and never reloads, in linksOnly mode", async () => {
    showButtons([{ text: "Open Yoga", leadsTo: "https://example.com/sessions/yoga" }]);

    const buttonLinks = await followFakePageButtons(buildFakePage(), "linksOnly");

    expect(buttonLinks).toEqual([]);
    expect(mockClick).not.toHaveBeenCalled();
    expect(mockNavigateToUrl).not.toHaveBeenCalled();
  });

  it("clicks only the open buttons in openOnly mode", async () => {
    showButtons([
      { text: "Details", leadsTo: "https://example.com/sessions/details" },
      { text: "Open Yoga", leadsTo: "https://example.com/sessions/yoga" },
    ]);

    const buttonLinks = await followFakePageButtons(buildFakePage(), "openOnly");

    expect(buttonLinks.map((buttonLink) => buttonLink.buttonText)).toEqual(["Open Yoga"]);
    expect(pageActions).not.toContain("click Details");
    expect(mockNavigateToUrl).not.toHaveBeenCalled();
  });
});

/** A stand-in for one element the button scan is handed. */
interface FakeButtonElement {
  /** The rendered text; missing on an element that has none (an SVG). */
  innerText?: string;
  /** The `value` property (inputs and buttons); missing on other elements. */
  value?: string;
  /** The `disabled` property; missing on elements that have none. */
  disabled?: boolean;
  /** The element's attributes. */
  attributes?: Record<string, string>;
  /** What `checkVisibility()` answers; true by default. */
  isVisible?: boolean;
}

/**
 * Builds an Element-shaped stand-in carrying only what the scan reads.
 * @param fakeElement - The element's properties and attributes
 * @returns The stand-in, typed as an Element
 */
function buildFakeElement(fakeElement: FakeButtonElement): Element {
  const { attributes = {}, isVisible = true, ...properties } = fakeElement;
  return {
    ...properties,
    getAttribute: (attributeName: string) => attributes[attributeName] ?? null,
    checkVisibility: () => isVisible,
  } as unknown as Element;
}

describe("readRawPageButtons (runs inside the browser)", () => {
  it("labels each button with its first non-blank text, value, aria-label, or title, whitespace collapsed", () => {
    const elements = [
      buildFakeElement({ innerText: "  Open\n   Yoga  ", value: "" }),
      buildFakeElement({ innerText: "", value: " Save  changes " }),
      buildFakeElement({ innerText: " ", value: "", attributes: { "aria-label": "Close dialog", title: "Close" } }),
      buildFakeElement({ innerText: "", attributes: { title: "Settings" } }),
      buildFakeElement({ attributes: { "aria-label": "Play" } }),
      buildFakeElement({ innerText: "", value: "" }),
    ];

    expect(readRawPageButtons(elements).map((rawPageButton) => rawPageButton.text)).toEqual([
      "Open Yoga",
      "Save changes",
      "Close dialog",
      "Settings",
      "Play",
      "",
    ]);
  });

  it("reports whether each button is visible, and disabled by its property or aria-disabled=\"true\"", () => {
    const elements = [
      buildFakeElement({ innerText: "Open", disabled: false }),
      buildFakeElement({ innerText: "Hidden", isVisible: false }),
      buildFakeElement({ innerText: "Off", disabled: true }),
      buildFakeElement({ innerText: "Aria off", attributes: { "aria-disabled": "true" } }),
      buildFakeElement({ innerText: "Aria on", attributes: { "aria-disabled": "false" } }),
    ];

    expect(readRawPageButtons(elements)).toEqual([
      { text: "Open", isVisible: true, isDisabled: false },
      { text: "Hidden", isVisible: false, isDisabled: false },
      { text: "Off", isVisible: true, isDisabled: true },
      { text: "Aria off", isVisible: true, isDisabled: true },
      { text: "Aria on", isVisible: true, isDisabled: false },
    ]);
  });
});
