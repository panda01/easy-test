import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, screen, waitFor, within, type RenderResult } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { type ReactElement } from "react";
import { Route, useLocation, useNavigationType } from "react-router-dom";
import CrawlRunPage from "../../src/pages/CrawlRunPage";
import { nocturneTokens, statusColors } from "../../src/theme/nocturneTheme";
import { formatDayAndTime } from "../../src/utils/formatRelativeTime";
import {
  buildCrawledPageRecord,
  buildCrawledPageSummaryRecord,
  buildCrawlPageGroupingWebObjectRecord,
  buildCrawlRunWithPagesRecord,
  buildJsonResponse,
  buildWebsiteRecord,
  countRequests,
  createDeferred,
  readBreadcrumbTrail,
  renderPageRoutes,
  stubFetchRoutes,
  stubWindowWidth,
  type FetchStub,
  type StubbedRouteTable,
} from "./support/frontendTestHelpers";

const RUN_PATH = "/websites/website-1/crawl-runs/crawl-run-1";
const WEBSITE_API_URL = "/api/websites/website-1";
const RUN_API_URL = "/api/websites/website-1/crawl-runs/crawl-run-1";
const HOME_PAGE_API_URL = `${RUN_API_URL}/pages/home`;
const ABOUT_PAGE_API_URL = `${RUN_API_URL}/pages/about`;

const homePage = buildCrawledPageSummaryRecord({
  id: "home",
  url: "https://example.com/",
  title: "Home",
});
const aboutPage = buildCrawledPageSummaryRecord({
  id: "about",
  parentPageId: "home",
  url: "https://example.com/about",
  title: "About",
  visitOrder: 1,
  depth: 1,
});
const finishedRun = buildCrawlRunWithPagesRecord({
  status: "finished",
  visitedPageCount: 2,
  durationMs: 6400,
  createdAt: "2026-03-04T05:06:07.000Z",
  pages: [homePage, aboutPage],
});

/**
 * Shows the current query string and how the router got there, next to the
 * page, so a test can see `?page=` change.
 * @returns The probe's readouts
 */
function SearchProbe(): ReactElement {
  const location = useLocation();
  const navigationType = useNavigationType();
  return (
    <>
      <span data-testid="probe-search">{location.search}</span>
      <span data-testid="probe-navigation-type">{navigationType}</span>
    </>
  );
}

/**
 * Renders the crawl run page on its real route, starting at the given URL.
 * @param startUrl - The path (and query string) to open
 * @returns The Testing Library render result
 */
function renderCrawlRunPage(startUrl = RUN_PATH): RenderResult {
  return renderPageRoutes(
    <Route
      path="/websites/:websiteId/crawl-runs/:crawlRunId"
      element={
        <>
          <CrawlRunPage />
          <SearchProbe />
        </>
      }
    />,
    { initialEntries: [startUrl] },
  );
}

/**
 * Stubs the website, a finished two-page run, and both pages in full, plus
 * any extra or replacement routes.
 * @param extraRoutes - More replies, or replacements
 * @returns The installed fetch stub
 */
function stubFinishedRun(extraRoutes: StubbedRouteTable = {}): FetchStub {
  return stubFetchRoutes({
    [`GET ${WEBSITE_API_URL}`]: { status: 200, body: buildWebsiteRecord() },
    [`GET ${RUN_API_URL}`]: { status: 200, body: finishedRun },
    [`GET ${HOME_PAGE_API_URL}`]: {
      status: 200,
      body: buildCrawledPageRecord({
        ...homePage,
        ariaSnapshot: '- heading "Home" [level=1]',
        linkedUrls: ["https://example.com/about"],
      }),
    },
    [`GET ${ABOUT_PAGE_API_URL}`]: {
      status: 200,
      body: buildCrawledPageRecord({
        ...aboutPage,
        ariaSnapshot: '- heading "About" [level=1]',
        linkedUrls: [],
      }),
    },
    ...extraRoutes,
  });
}

/**
 * Finds the tag that says who the crawl viewed the site as, by its text.
 * @param tagText - The tag's text, e.g. "Logged out"
 * @returns The tag's chip element
 */
function getLoginTag(tagText: string): HTMLElement {
  const tag = screen.getByText(tagText).closest(".MuiChip-root");
  if (!(tag instanceof HTMLElement)) throw new Error(`No login tag reads "${tagText}"`);
  return tag;
}

describe("CrawlRunPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a spinner and a placeholder breadcrumb while the crawl loads", () => {
    const pendingRun = createDeferred<Response>();
    stubFinishedRun({ [`GET ${RUN_API_URL}`]: () => pendingRun.promise });

    renderCrawlRunPage();

    expect(screen.getByRole("progressbar", { name: "Loading crawl" })).toBeInTheDocument();
    expect(readBreadcrumbTrail().at(-1)).toEqual({ label: "Crawl", href: null });
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
  });

  it("shows the server's not-found text for an unknown crawl", async () => {
    stubFinishedRun({
      [`GET ${RUN_API_URL}`]: { status: 404, body: { error: "Crawl run not found" } },
    });

    renderCrawlRunPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Crawl run not found");
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
  });

  it("shows the finished crawl's outcome, breadcrumbs, site map, and the start page in full", async () => {
    const fetchStub = stubFinishedRun();

    renderCrawlRunPage();

    expect(await screen.findByRole("heading", { level: 1, name: "Crawl" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Finished · 2 pages · 6.4 s");
    expect(await screen.findByText("Example")).toBeInTheDocument();
    expect(readBreadcrumbTrail()).toEqual([
      { label: "Websites", href: "/" },
      { label: "Example", href: "/websites/website-1" },
      { label: `Crawl · ${formatDayAndTime(finishedRun.createdAt, new Date())}`, href: null },
    ]);
    const siteMap = screen.getByRole("list", { name: "Site map" });
    expect(within(siteMap).getAllByRole("button")).toHaveLength(2);
    expect(within(siteMap).getByRole("button", { name: "/" })).toHaveAttribute("aria-current", "true");
    expect(await screen.findByLabelText("Aria snapshot")).toHaveTextContent(
      '- heading "Home" [level=1]',
    );
    expect(screen.queryByRole("progressbar", { name: "Pages crawled" })).not.toBeInTheDocument();
    expect(countRequests(fetchStub, "GET", ABOUT_PAGE_API_URL)).toBe(0);
  });

  it("colors the ended crawl's dot by how it ended", async () => {
    stubFinishedRun();

    renderCrawlRunPage();

    const status = await screen.findByRole("status");
    expect(status.querySelector('[aria-hidden="true"]')).toHaveStyle({
      backgroundColor: statusColors.passed,
    });
  });

  it("shows a page found by a button with that button, and lists the pages its buttons led to", async () => {
    const user = userEvent.setup();
    const sessionsPage = buildCrawledPageSummaryRecord({
      id: "sessions",
      parentPageId: "home",
      url: "https://example.com/sessions",
      title: "Sessions",
      visitOrder: 1,
      depth: 1,
    });
    const yogaPage = buildCrawledPageSummaryRecord({
      id: "yoga",
      parentPageId: "sessions",
      url: "https://example.com/sessions/yoga",
      foundByButtonText: "Open Yoga",
      title: "Yoga",
      visitOrder: 2,
      depth: 2,
    });
    stubFinishedRun({
      [`GET ${RUN_API_URL}`]: {
        status: 200,
        body: buildCrawlRunWithPagesRecord({
          ...finishedRun,
          buttonMode: "openOnly",
          pages: [homePage, sessionsPage, yogaPage],
        }),
      },
      [`GET ${RUN_API_URL}/pages/sessions`]: {
        status: 200,
        body: buildCrawledPageRecord({
          ...sessionsPage,
          buttonUrls: ["https://example.com/sessions/yoga"],
        }),
      },
      [`GET ${RUN_API_URL}/pages/yoga`]: {
        status: 200,
        body: buildCrawledPageRecord({ ...yogaPage, ariaSnapshot: '- heading "Yoga" [level=1]' }),
      },
    });
    renderCrawlRunPage(`${RUN_PATH}?page=sessions`);

    const siteMap = await screen.findByRole("list", { name: "Site map" });
    expect(within(siteMap).getByRole("button", { name: /^\/sessions\/yoga/ })).toHaveTextContent(
      "/sessions/yogavia “Open Yoga”",
    );
    const buttonsCard = await screen.findByRole("region", { name: "Buttons led to · 1" });
    await user.click(within(buttonsCard).getByRole("button", { name: "“Open Yoga” → /sessions/yoga" }));

    expect(await screen.findByLabelText("Aria snapshot")).toHaveTextContent(
      '- heading "Yoga" [level=1]',
    );
    expect(screen.getByRole("region", { name: "/sessions/yoga" })).toHaveTextContent(
      "Found on /sessions via “Open Yoga”",
    );
    expect(screen.getByTestId("probe-search").textContent).toBe("?page=yoga");
  });

  it("shows a page picked from the site map, and keeps the choice in the query string (replaced)", async () => {
    const user = userEvent.setup();
    const fetchStub = stubFinishedRun();
    renderCrawlRunPage();
    const siteMap = await screen.findByRole("list", { name: "Site map" });

    await user.click(within(siteMap).getByRole("button", { name: "/about" }));

    expect(await screen.findByLabelText("Aria snapshot")).toHaveTextContent(
      '- heading "About" [level=1]',
    );
    expect(within(siteMap).getByRole("button", { name: "/about" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByTestId("probe-search").textContent).toBe("?page=about");
    expect(screen.getByTestId("probe-navigation-type").textContent).toBe("REPLACE");
    expect(countRequests(fetchStub, "GET", ABOUT_PAGE_API_URL)).toBe(1);
  });

  it("follows a link listed on the shown page to that page", async () => {
    const user = userEvent.setup();
    stubFinishedRun();
    renderCrawlRunPage();
    const linksCard = await screen.findByRole("region", { name: "Links · 1" });

    await user.click(within(linksCard).getByRole("button", { name: "/about" }));

    expect(await screen.findByLabelText("Aria snapshot")).toHaveTextContent(
      '- heading "About" [level=1]',
    );
  });

  it("opens the page named in ?page= (e.g. after a reload)", async () => {
    stubFinishedRun();

    renderCrawlRunPage(`${RUN_PATH}?page=about`);

    expect(await screen.findByLabelText("Aria snapshot")).toHaveTextContent(
      '- heading "About" [level=1]',
    );
  });

  it("falls back to the start page when ?page= names no page of this crawl", async () => {
    stubFinishedRun();

    renderCrawlRunPage(`${RUN_PATH}?page=gone`);

    expect(await screen.findByLabelText("Aria snapshot")).toHaveTextContent(
      '- heading "Home" [level=1]',
    );
  });

  it("shows a failed crawl's reason, with a red dot", async () => {
    stubFinishedRun({
      [`GET ${RUN_API_URL}`]: {
        status: 200,
        body: buildCrawlRunWithPagesRecord({
          status: "failed",
          visitedPageCount: 0,
          durationMs: 120,
          errorMessage: "browserType.launch: Executable doesn't exist",
          pages: [],
        }),
      },
    });

    renderCrawlRunPage();

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Failed · 0 pages · 0.1 s");
    expect(status).toHaveTextContent("browserType.launch: Executable doesn't exist");
    expect(status.querySelector('[aria-hidden="true"]')).toHaveStyle({
      backgroundColor: statusColors.failed,
    });
    expect(screen.getByText("No pages yet.")).toBeInTheDocument();
  });

  it("shows a crawl interrupted at boot without a duration", async () => {
    stubFinishedRun({
      [`GET ${RUN_API_URL}`]: {
        status: 200,
        body: buildCrawlRunWithPagesRecord({
          status: "interrupted",
          visitedPageCount: 2,
          durationMs: null,
          pages: [homePage, aboutPage],
        }),
      },
    });

    renderCrawlRunPage();

    expect(await screen.findByRole("status")).toHaveTextContent(
      /^Interrupted \(the server restarted or the browser closed\) · 2 pages$/,
    );
  });

  it("labels redirects in the site map and the details, and lets a link to a requested URL select the page it led to", async () => {
    const user = userEvent.setup();
    const calendarPage = buildCrawledPageSummaryRecord({
      id: "calendar",
      url: "https://example.com/calendar",
      requestedUrl: "https://example.com/",
      finalUrl: "https://example.com/calendar",
      wasRedirected: true,
      title: "Calendar",
    });
    const oldAccountPage = buildCrawledPageSummaryRecord({
      id: "old-account",
      parentPageId: "calendar",
      url: "https://example.com/old-account",
      requestedUrl: "https://example.com/old-account",
      finalUrl: "https://example.com/calendar",
      wasRedirected: true,
      visitOrder: 1,
      depth: 1,
    });
    stubFinishedRun({
      [`GET ${RUN_API_URL}`]: {
        status: 200,
        body: buildCrawlRunWithPagesRecord({ ...finishedRun, pages: [calendarPage, oldAccountPage] }),
      },
      [`GET ${RUN_API_URL}/pages/calendar`]: {
        status: 200,
        body: buildCrawledPageRecord({ ...calendarPage, linkedUrls: [] }),
      },
      [`GET ${RUN_API_URL}/pages/old-account`]: {
        status: 200,
        body: buildCrawledPageRecord({ ...oldAccountPage, linkedUrls: ["https://example.com/"] }),
      },
    });
    renderCrawlRunPage(`${RUN_PATH}?page=old-account`);

    const siteMap = await screen.findByRole("list", { name: "Site map" });
    expect(within(siteMap).getByRole("button", { name: /^\/calendar/ })).toHaveTextContent("/calendarfrom /");
    const oldAccountRow = within(siteMap).getByRole("button", { name: /^\/old-account/ });
    expect(oldAccountRow).toHaveTextContent("/old-account→ /calendar");
    expect(oldAccountRow).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("heading", { level: 2, name: "/old-account" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "/old-account" })).toHaveTextContent("Redirected to /calendar");

    // "/" was only ever requested: the page it led to is recorded as /calendar.
    const linksCard = await screen.findByRole("region", { name: "Links · 1" });
    await user.click(within(linksCard).getByRole("button", { name: "/" }));

    expect(await screen.findByRole("heading", { level: 2, name: "/calendar" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "/calendar" })).toHaveTextContent("Redirected from /");
    expect(screen.getByTestId("probe-search").textContent).toBe("?page=calendar");
  });

  it("tags a crawl without a credential as logged out, with no login screenshot", async () => {
    stubFinishedRun();

    renderCrawlRunPage();

    await screen.findByRole("heading", { level: 1, name: "Crawl" });
    expect(getLoginTag("Logged out")).toHaveStyle({ backgroundColor: nocturneTokens.neutral[800] });
    expect(
      screen.queryByRole("region", { name: "Login failure screenshot" }),
    ).not.toBeInTheDocument();
  });

  it("tags which credential a logged-in crawl viewed every page as, in green", async () => {
    stubFinishedRun({
      [`GET ${RUN_API_URL}`]: {
        status: 200,
        body: buildCrawlRunWithPagesRecord({
          ...finishedRun,
          credentialId: "credential-1",
          isLoggedIn: true,
          credential: { id: "credential-1", name: "Admin" },
        }),
      },
    });

    renderCrawlRunPage();

    await screen.findByRole("heading", { level: 1, name: "Crawl" });
    expect(getLoginTag("Logged in as “Admin”")).toHaveStyle({
      backgroundColor: statusColors.loggedInTagBackground,
    });
  });

  it("shows a failed login's reason, a red tag, and the screenshot of what the browser showed", async () => {
    stubFinishedRun({
      [`GET ${RUN_API_URL}`]: {
        status: 200,
        body: buildCrawlRunWithPagesRecord({
          status: "failed",
          visitedPageCount: 0,
          durationMs: 1600,
          credentialId: "credential-2",
          credential: { id: "credential-2", name: "Wrong password" },
          errorMessage:
            'Login as "Wrong password" failed: Still on the login form after submitting - check the username and password',
          loginFailureScreenshotFileName: "website-1/failed-login.png",
          createdAt: "2026-03-04T05:06:07.000Z",
          pages: [],
        }),
      },
    });

    renderCrawlRunPage();

    await screen.findByRole("heading", { level: 1, name: "Crawl" });
    expect(getLoginTag("Not logged in — login as “Wrong password” failed")).toHaveStyle({
      backgroundColor: statusColors.failedBannerBackground,
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      'Login as "Wrong password" failed: Still on the login form after submitting',
    );
    const screenshotSection = screen.getByRole("region", { name: "Login failure screenshot" });
    const startedAtText = new Date("2026-03-04T05:06:07.000Z").toLocaleString();
    expect(
      within(screenshotSection).getByRole("img", {
        name: `Login failure screenshot of the crawl started ${startedAtText}`,
      }),
    ).toHaveAttribute("src", `${RUN_API_URL}/login-failure-screenshot`);
  });
});

describe("CrawlRunPage's Objects view", () => {
  const RENAME_API_URL = "/api/websites/website-1/web-objects/web-object-about";
  const aboutObject = buildCrawlPageGroupingWebObjectRecord({
    webObjectId: "web-object-about",
    instancePatternKey: "/about/{about}",
    displayName: "About",
    detectedName: "About",
    instanceValues: ["us"],
    skippedLinkCount: 4,
    patterns: [{ key: "/about/{about}", role: "instance", viewName: null, detectedBy: "siblingStructure", pageIds: ["about"] }],
  });
  const groupedRun = buildCrawlRunWithPagesRecord({
    ...finishedRun,
    skippedSimilarUrlCount: 4,
    skippedSimilarUrlCountsByPattern: { "/about/{about}": 4 },
    pageGrouping: { webObjects: [aboutObject], standalonePageIds: ["home"] },
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("says how many similar pages the crawl skipped, and opens the Objects view from ?view=objects", async () => {
    stubFinishedRun({ [`GET ${RUN_API_URL}`]: { status: 200, body: groupedRun } });

    renderCrawlRunPage(`${RUN_PATH}?view=objects`);

    expect(await screen.findByRole("heading", { name: "About" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Finished · 2 pages · 6.4 s · 4 similar pages skipped");
    expect(screen.getByText("1 instance · 4 more skipped")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Objects" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("list", { name: "Site map" })).not.toBeInTheDocument();
  });

  it("switches views in the query string (replaced), keeping the selected page, and the selection keeps the view", async () => {
    const user = userEvent.setup();
    stubFinishedRun({ [`GET ${RUN_API_URL}`]: { status: 200, body: groupedRun } });
    renderCrawlRunPage(`${RUN_PATH}?page=home`);

    await user.click(await screen.findByRole("button", { name: "Objects" }));

    expect(screen.getByTestId("probe-search").textContent).toBe("?page=home&view=objects");
    expect(screen.getByTestId("probe-navigation-type").textContent).toBe("REPLACE");
    const webObjectList = screen.getByRole("list", { name: "Web objects" });
    await user.click(within(webObjectList).getByRole("button", { name: "/about" }));

    expect(await screen.findByLabelText("Aria snapshot")).toHaveTextContent('- heading "About" [level=1]');
    expect(screen.getByTestId("probe-search").textContent).toBe("?page=about&view=objects");

    await user.click(screen.getByRole("button", { name: "Tree" }));

    expect(screen.getByTestId("probe-search").textContent).toBe("?page=about");
    expect(screen.getByRole("list", { name: "Site map" })).toBeInTheDocument();
  });

  it("renames a saved object and shows the new name at once", async () => {
    const user = userEvent.setup();
    const fetchStub = stubFinishedRun({
      [`GET ${RUN_API_URL}`]: { status: 200, body: groupedRun },
      [`PUT ${RENAME_API_URL}`]: { status: 200, body: { id: "web-object-about", name: "Company page" } },
    });
    renderCrawlRunPage(`${RUN_PATH}?view=objects`);

    await user.click(await screen.findByRole("button", { name: "Rename About" }));
    const nameField = screen.getByRole("textbox", { name: "Name" });
    await user.clear(nameField);
    await user.type(nameField, "Company page");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("heading", { name: "Company page" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(countRequests(fetchStub, "PUT", RENAME_API_URL)).toBe(1);

    await user.click(screen.getByRole("button", { name: "Rename Company page" }));
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Company page");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("keeps the dialog open with the server's reason when the rename fails", async () => {
    const user = userEvent.setup();
    stubFinishedRun({
      [`GET ${RUN_API_URL}`]: { status: 200, body: groupedRun },
      [`PUT ${RENAME_API_URL}`]: { status: 404, body: { error: "Web object not found" } },
    });
    renderCrawlRunPage(`${RUN_PATH}?view=objects`);

    await user.click(await screen.findByRole("button", { name: "Rename About" }));
    await user.click(screen.getByRole("button", { name: "Use detected name" }));

    expect(await screen.findByText("Web object not found")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("CrawlRunPage while the crawl runs", () => {
  /** When the running crawl started. */
  const CRAWL_STARTED_AT = "2026-03-04T05:06:07.000Z";
  /** "Now" at the first render: 2 minutes 14 seconds into the crawl. */
  const TWO_MINUTES_FOURTEEN_IN = new Date(Date.parse(CRAWL_STARTED_AT) + (2 * 60 + 14) * 1000);

  let removeWidthStub: (() => void) | null = null;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(TWO_MINUTES_FOURTEEN_IN);
  });

  afterEach(() => {
    removeWidthStub?.();
    removeWidthStub = null;
    vi.useRealTimers();
  });

  /**
   * Moves the fake clock forward and lets whatever it triggered settle.
   * @param milliseconds - How far to move the clock
   * @returns Resolves once the triggered work has settled
   */
  async function advanceClock(milliseconds: number): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(milliseconds);
    });
  }

  /** The run as the first poll finds it: one page visited, one link waiting. */
  const runningRun = buildCrawlRunWithPagesRecord({
    status: "running",
    visitedPageCount: 1,
    waitingUrlCount: 1,
    durationMs: null,
    finishedAt: null,
    createdAt: CRAWL_STARTED_AT,
    pages: [homePage],
  });

  it("shows live progress, grows the site map as pages arrive, and stops polling when the crawl ends", async () => {
    let runRequestCount = 0;
    const fetchStub = stubFinishedRun({
      [`GET ${RUN_API_URL}`]: () => {
        runRequestCount += 1;
        const body = runRequestCount === 1 ? runningRun : finishedRun;
        return Promise.resolve(buildJsonResponse(200, body));
      },
    });

    renderCrawlRunPage();
    await advanceClock(0);

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Running");
    expect(status).toHaveTextContent("1 of up to 50 pages · 1 waiting");
    expect(status).toHaveTextContent("2:14 of 10:00 max");
    expect(status).toHaveTextContent("Updated just now");
    expect(within(status).getByRole("progressbar", { name: "Pages crawled" })).toHaveAttribute(
      "aria-valuenow",
      "2",
    );
    expect(within(screen.getByRole("list", { name: "Site map" })).getAllByRole("button")).toHaveLength(1);

    await advanceClock(1000);
    expect(screen.getByRole("status")).toHaveTextContent("2:15 of 10:00 max");

    await advanceClock(1000);

    expect(screen.getByRole("status")).toHaveTextContent("Finished · 2 pages · 6.4 s");
    expect(within(screen.getByRole("list", { name: "Site map" })).getAllByRole("button")).toHaveLength(2);
    expect(screen.queryByRole("progressbar", { name: "Pages crawled" })).not.toBeInTheDocument();
    await advanceClock(10_000);
    expect(countRequests(fetchStub, "GET", RUN_API_URL)).toBe(2);
  });

  it("keeps showing the last progress, with a warning, while the server cannot be reached", async () => {
    let runRequestCount = 0;
    stubFinishedRun({
      [`GET ${RUN_API_URL}`]: () => {
        runRequestCount += 1;
        const firstRequest = runRequestCount === 1;
        return Promise.resolve(
          firstRequest
            ? buildJsonResponse(200, runningRun)
            : buildJsonResponse(502, { error: "Bad gateway" }),
        );
      },
    });

    renderCrawlRunPage();
    await advanceClock(0);
    await advanceClock(2000);

    expect(screen.getByRole("status")).toHaveTextContent("1 of up to 50 pages · 1 waiting");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not refresh the crawl (Bad gateway); still trying.",
    );
  });

  it("tags a crawl still logging in with its credential", async () => {
    stubFinishedRun({
      [`GET ${RUN_API_URL}`]: {
        status: 200,
        body: buildCrawlRunWithPagesRecord({
          ...runningRun,
          credentialId: "credential-1",
          credential: { id: "credential-1", name: "Admin" },
          pages: [],
        }),
      },
    });

    renderCrawlRunPage();
    await advanceClock(0);

    expect(getLoginTag("Logging in as “Admin”…")).toHaveStyle({ backgroundColor: nocturneTokens.neutral[800] });
  });

  it("shows a progress card, the site map, and the selected page below it on a phone", async () => {
    removeWidthStub = stubWindowWidth(390);
    stubFinishedRun({ [`GET ${RUN_API_URL}`]: { status: 200, body: runningRun } });

    renderCrawlRunPage();
    await advanceClock(0);

    const progressCard = screen.getByRole("status");
    expect(progressCard).toHaveTextContent("Running");
    expect(progressCard).toHaveTextContent("2:14");
    expect(progressCard).toHaveTextContent("1 of up to 50 pages · 1 waiting");
    expect(progressCard).not.toHaveTextContent("of 10:00 max");
    const siteMapRows = within(screen.getByRole("list", { name: "Site map" })).getAllByRole("button");
    expect(siteMapRows[0]).toHaveStyle({ minHeight: "44px" });
    expect(screen.getByRole("region", { name: "/" })).toBeInTheDocument();
    const backLink = within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByRole("link");
    expect(backLink).toHaveTextContent("Example");
    expect(backLink).toHaveAttribute("href", "/websites/website-1");
  });
});
