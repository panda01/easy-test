import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, screen, waitFor, within, type RenderResult } from "@testing-library/react";
import { userEvent, type UserEvent } from "@testing-library/user-event";
import { type ReactElement } from "react";
import { Route, useLocation, useNavigationType } from "react-router-dom";
import WebsiteDetailPage from "../../src/pages/WebsiteDetailPage";
import {
  buildCrawlRunRecord,
  buildCredentialRecord,
  buildJsonResponse,
  buildNewestActionScriptRecord,
  buildScreenshotRunRecord,
  buildWebsiteItemRecord,
  buildWebObjectRecord,
  buildWebsiteRecord,
  countRequests,
  createDeferred,
  readBreadcrumbTrail,
  readProbeAfterLanding,
  renderPageRoutes,
  stubFetchRoutes,
  stubWindowWidth,
  type FetchStub,
  type RouterStart,
  type StubbedRouteTable,
} from "./support/frontendTestHelpers";

/** The website list: the dashboard, on the home page. */
const LIST_PATH = "/";
const DETAIL_PATH = "/websites/website-1";
const WEBSITE_API_URL = "/api/websites/website-1";
const USE_CASES_API_URL = "/api/websites/website-1/use-cases";
const ACTIONS_API_URL = "/api/websites/website-1/actions";
const SCREENSHOT_RUNS_API_URL = "/api/websites/website-1/screenshot-runs";
const CRAWL_RUNS_API_URL = "/api/websites/website-1/crawl-runs";
const CREDENTIALS_API_URL = "/api/websites/website-1/credentials";
const WEB_OBJECTS_API_URL = "/api/websites/website-1/web-objects";

/** History as it is after clicking the website on the dashboard. */
const OPENED_FROM_LIST: RouterStart = {
  initialEntries: [LIST_PATH, { pathname: DETAIL_PATH, state: { returnTo: LIST_PATH } }],
};

/** History after opening the page directly (deep link or reload): no state. */
const OPENED_BY_DEEP_LINK: RouterStart = { initialEntries: [DETAIL_PATH] };

/**
 * History after opening the page from the dashboard with a tab named in the
 * query string, e.g. after a reload of `?tab=screenshots`.
 * @param tab - The `?tab=` value
 * @returns The history stack to start from
 */
function openedFromListOnTab(tab: string): RouterStart {
  return {
    initialEntries: [
      LIST_PATH,
      { pathname: DETAIL_PATH, search: `?tab=${tab}`, state: { returnTo: LIST_PATH } },
    ],
  };
}

/**
 * Shows the page's current query string and how the router got there, so a
 * spec can tell a tab switch REPLACED the entry rather than pushing one.
 * @returns The readouts
 */
function SearchProbe(): ReactElement {
  const location = useLocation();
  const navigationType = useNavigationType();
  return (
    <div>
      <p data-testid="page-search">{location.search}</p>
      <p data-testid="page-navigation-type">{navigationType}</p>
    </div>
  );
}

/**
 * Renders the website page on its real route (`/websites/:websiteId`), with
 * a readout of its query string beside it.
 * @param routerStart - The history stack to start from
 * @returns The Testing Library render result
 */
function renderWebsiteDetailPage(routerStart: RouterStart): RenderResult {
  return renderPageRoutes(
    <Route
      path="/websites/:websiteId"
      element={
        <>
          <WebsiteDetailPage />
          <SearchProbe />
        </>
      }
    />,
    routerStart,
  );
}

/**
 * Stubs a successful load of the website with one use case, two actions (one
 * with a passing version, one without versions), no screenshot runs, no crawl
 * runs, and no credentials, plus any extra or replacement routes.
 * @param extraRoutes - More replies, e.g. for the DELETE, or replacements for the GETs
 * @returns The installed fetch stub
 */
function stubLoadedWebsite(extraRoutes: StubbedRouteTable = {}): FetchStub {
  return stubFetchRoutes({
    [`GET ${WEBSITE_API_URL}`]: { status: 200, body: buildWebsiteRecord() },
    [`GET ${USE_CASES_API_URL}`]: {
      status: 200,
      body: [buildWebsiteItemRecord({ id: "use-case-1", title: "Log in" })],
    },
    [`GET ${ACTIONS_API_URL}`]: {
      status: 200,
      body: [
        buildWebsiteItemRecord({
          id: "action-1",
          title: "Open the login page",
          newestScript: buildNewestActionScriptRecord({
            actionTitle: "Open the login page",
            latestRun: {
              id: "run-1",
              succeeded: true,
              failedStepNumber: null,
              timedOut: false,
              createdAt: "2026-02-04T03:04:05.000Z",
            },
          }),
        }),
        buildWebsiteItemRecord({ id: "action-2", title: "Submit credentials", newestScript: null }),
      ],
    },
    [`GET ${SCREENSHOT_RUNS_API_URL}`]: { status: 200, body: [] },
    [`GET ${CRAWL_RUNS_API_URL}`]: { status: 200, body: [] },
    [`GET ${CREDENTIALS_API_URL}`]: { status: 200, body: [] },
    ...extraRoutes,
  });
}

/**
 * Waits for the website to load, then opens the delete dialog.
 * @param user - The user-event session to click with
 * @returns The open dialog element
 */
async function openDeleteDialog(user: UserEvent): Promise<HTMLElement> {
  await screen.findByRole("heading", { level: 1, name: "Example" });
  await screen.findByRole("list", { name: "Actions" });
  await user.click(screen.getByRole("button", { name: "Delete" }));
  return screen.findByRole("dialog", { name: "Delete website?" });
}

/**
 * Waits for a tab, clicks it, and returns its panel.
 * @param user - The user-event session to click with
 * @param tabName - The tab's accessible name (a RegExp for "Credentials · N")
 * @returns The opened tab panel
 */
async function openTab(user: UserEvent, tabName: string | RegExp): Promise<HTMLElement> {
  await user.click(await screen.findByRole("tab", { name: tabName }));
  return screen.findByRole("tabpanel", { name: tabName });
}

describe("WebsiteDetailPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a spinner and a placeholder breadcrumb while the website loads", () => {
    const pendingWebsite = createDeferred<Response>();
    stubLoadedWebsite({ [`GET ${WEBSITE_API_URL}`]: () => pendingWebsite.promise });

    renderWebsiteDetailPage(OPENED_FROM_LIST);

    expect(screen.getByRole("progressbar", { name: "Loading website" })).toBeInTheDocument();
    expect(readBreadcrumbTrail()).toEqual([
      { label: "Websites", href: LIST_PATH },
      { label: "Website", href: null },
    ]);
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  });

  it("shows the server's not-found text and nothing else for an unknown website", async () => {
    stubLoadedWebsite({
      [`GET ${WEBSITE_API_URL}`]: { status: 404, body: { error: "Website not found" } },
    });

    renderWebsiteDetailPage(OPENED_FROM_LIST);

    expect(await screen.findByRole("alert")).toHaveTextContent("Website not found");
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Use cases" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Take screenshot" })).not.toBeInTheDocument();
  });

  it("shows the website's name, URL link, when it was last updated, and breadcrumbs - without its description", async () => {
    stubLoadedWebsite();

    renderWebsiteDetailPage(OPENED_FROM_LIST);

    expect(await screen.findByRole("heading", { level: 1, name: "Example" })).toBeInTheDocument();
    const urlLink = screen.getByRole("link", { name: "https://example.com" });
    expect(urlLink).toHaveAttribute("href", "https://example.com");
    expect(urlLink).toHaveAttribute("target", "_blank");
    expect(urlLink).toHaveAttribute("rel", "noopener noreferrer");
    const updatedText = screen.getByText(/^Updated /);
    expect(updatedText).toHaveAttribute("title", new Date("2026-01-03T03:04:05.000Z").toLocaleString());
    expect(screen.queryByText("The example site")).not.toBeInTheDocument();
    expect(screen.queryByText(/Created /)).not.toBeInTheDocument();
    expect(readBreadcrumbTrail()).toEqual([
      { label: "Websites", href: LIST_PATH },
      { label: "Example", href: null },
    ]);
  });

  it("shows the website's login page by its path, with the full URL as its hover title", async () => {
    stubLoadedWebsite();

    renderWebsiteDetailPage(OPENED_FROM_LIST);

    const loginPageText = await screen.findByText("Login page /login");
    expect(loginPageText).toHaveAttribute("title", "https://example.com/login");
    expect(screen.queryByText("Doesn't require login")).not.toBeInTheDocument();
  });

  it("shows a login page on another site by its full URL", async () => {
    stubLoadedWebsite({
      [`GET ${WEBSITE_API_URL}`]: {
        status: 200,
        body: buildWebsiteRecord({ loginUrl: "https://accounts.example.org/sign-in" }),
      },
    });

    renderWebsiteDetailPage(OPENED_FROM_LIST);

    expect(await screen.findByText("Login page https://accounts.example.org/sign-in")).toBeInTheDocument();
  });

  it("says so when the website doesn't require login", async () => {
    stubLoadedWebsite({
      [`GET ${WEBSITE_API_URL}`]: { status: 200, body: buildWebsiteRecord({ loginUrl: null }) },
    });

    renderWebsiteDetailPage(OPENED_FROM_LIST);

    expect(await screen.findByText("Doesn't require login")).toBeInTheDocument();
    expect(screen.queryByText(/^Login page/)).not.toBeInTheDocument();
  });

  it("shows the action and use case sections with their items", async () => {
    stubLoadedWebsite();

    renderWebsiteDetailPage(OPENED_FROM_LIST);

    const useCaseList = await screen.findByRole("list", { name: "Use cases" });
    expect(within(useCaseList).getByRole("link", { name: /Log in/ })).toHaveAttribute(
      "href",
      "/websites/website-1/use-cases/use-case-1",
    );
    const actionList = await screen.findByRole("list", { name: "Actions" });
    const actionLinks = within(actionList).getAllByRole("link");
    expect(actionLinks).toHaveLength(2);
    expect(within(actionLinks[0]).getByRole("img", { name: "Latest run passed" })).toBeInTheDocument();
    expect(within(actionLinks[1]).getByRole("img", { name: "Not run yet" })).toBeInTheDocument();
    expect(screen.getByText("1 passed · 0 failed · 1 not run")).toBeInTheDocument();
  });

  it("shows each section's empty state when the website has no items", async () => {
    stubLoadedWebsite({
      [`GET ${USE_CASES_API_URL}`]: { status: 200, body: [] },
      [`GET ${ACTIONS_API_URL}`]: { status: 200, body: [] },
    });

    renderWebsiteDetailPage(OPENED_FROM_LIST);

    expect(await screen.findByText("No use cases yet.")).toBeInTheDocument();
    expect(await screen.findByText("No actions yet.")).toBeInTheDocument();
  });

  it("opens the edit form with this page as its return state", async () => {
    const user = userEvent.setup();
    stubLoadedWebsite();
    renderWebsiteDetailPage(OPENED_FROM_LIST);

    await user.click(await screen.findByRole("link", { name: "Edit" }));

    const landing = await readProbeAfterLanding("/websites/website-1/edit");
    expect(landing.navigationType).toBe("PUSH");
    expect(landing.state).toBe(JSON.stringify({ returnTo: DETAIL_PATH }));
  });

  it("names the use case, action, screenshot run, and crawl run counts in the delete dialog", async () => {
    const user = userEvent.setup();
    stubLoadedWebsite();
    renderWebsiteDetailPage(OPENED_FROM_LIST);

    const dialog = await openDeleteDialog(user);

    expect(dialog).toHaveTextContent(
      '"Example" will be deleted, along with its 1 use case, 2 actions, 0 screenshot runs, 0 crawl runs, and 0 credentials.',
    );
  });

  it("counts the website's screenshot runs in the delete dialog", async () => {
    const user = userEvent.setup();
    stubLoadedWebsite({
      [`GET ${SCREENSHOT_RUNS_API_URL}`]: {
        status: 200,
        body: [buildScreenshotRunRecord({ id: "run-1" })],
      },
    });
    renderWebsiteDetailPage(openedFromListOnTab("screenshots"));
    await screen.findByRole("list", { name: "History" });

    const dialog = await openDeleteDialog(user);

    expect(dialog).toHaveTextContent("1 use case, 2 actions, 1 screenshot run, 0 crawl runs, and 0 credentials.");
  });

  it("counts zero items when the item lists failed to load", async () => {
    const user = userEvent.setup();
    stubLoadedWebsite({
      [`GET ${USE_CASES_API_URL}`]: { status: 500, body: { error: "Database unavailable" } },
      [`GET ${ACTIONS_API_URL}`]: { status: 500, body: { error: "Database unavailable" } },
    });
    renderWebsiteDetailPage(OPENED_FROM_LIST);

    await screen.findByRole("heading", { level: 1, name: "Example" });
    await waitFor(() => {
      expect(screen.getAllByRole("alert")).toHaveLength(2);
    });
    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "along with its 0 use cases, 0 actions, 0 screenshot runs, 0 crawl runs, and 0 credentials.",
    );
  });

  it("closes the delete dialog on Cancel without sending a request", async () => {
    const user = userEvent.setup();
    const fetchStub = stubLoadedWebsite();
    renderWebsiteDetailPage(OPENED_FROM_LIST);
    const dialog = await openDeleteDialog(user);

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(countRequests(fetchStub, "DELETE", WEBSITE_API_URL)).toBe(0);
    expect(screen.getByRole("heading", { level: 1, name: "Example" })).toBeInTheDocument();
  });

  it("keeps the dialog open with the server's reason when the delete fails", async () => {
    const user = userEvent.setup();
    const fetchStub = stubLoadedWebsite({
      [`DELETE ${WEBSITE_API_URL}`]: { status: 404, body: { error: "Website not found" } },
    });
    renderWebsiteDetailPage(OPENED_FROM_LIST);
    const dialog = await openDeleteDialog(user);

    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Website not found");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Delete" })).toBeEnabled();
    expect(countRequests(fetchStub, "DELETE", WEBSITE_API_URL)).toBe(1);
    expect(screen.queryByTestId("probe-pathname")).not.toBeInTheDocument();
  });

  it("disables the dialog's buttons while the delete is in flight", async () => {
    const user = userEvent.setup();
    const pendingDelete = createDeferred<Response>();
    stubLoadedWebsite({ [`DELETE ${WEBSITE_API_URL}`]: () => pendingDelete.promise });
    renderWebsiteDetailPage(OPENED_FROM_LIST);
    const dialog = await openDeleteDialog(user);

    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(within(dialog).getByRole("button", { name: "Delete" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();

    await act(async () => {
      pendingDelete.resolve(buildJsonResponse(204));
      await pendingDelete.promise;
    });
    await readProbeAfterLanding(LIST_PATH);
  });

  it("sends DELETE and goes back to the dashboard when the dashboard opened the page", async () => {
    const user = userEvent.setup();
    const fetchStub = stubLoadedWebsite({ [`DELETE ${WEBSITE_API_URL}`]: { status: 204 } });
    renderWebsiteDetailPage(OPENED_FROM_LIST);
    const dialog = await openDeleteDialog(user);

    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    const landing = await readProbeAfterLanding(LIST_PATH);
    expect(landing.navigationType).toBe("POP");
    expect(fetchStub).toHaveBeenCalledWith(WEBSITE_API_URL, { method: "DELETE" });
  });

  it("replaces the deleted website's page with the dashboard after a deep link", async () => {
    const user = userEvent.setup();
    stubLoadedWebsite({ [`DELETE ${WEBSITE_API_URL}`]: { status: 204 } });
    renderWebsiteDetailPage(OPENED_BY_DEEP_LINK);
    const dialog = await openDeleteDialog(user);

    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    const landing = await readProbeAfterLanding(LIST_PATH);
    expect(landing.navigationType).toBe("REPLACE");
  });

  describe("tabs", () => {
    it("keeps the actions and use cases in view and puts Crawls, Objects, Screenshots, and Credentials in a side panel, Crawls open", async () => {
      const fetchStub = stubLoadedWebsite();

      renderWebsiteDetailPage(OPENED_FROM_LIST);

      const sidePanel = await screen.findByRole("complementary", { name: "Crawls, objects, screenshots, and credentials" });
      const tabList = within(sidePanel).getByRole("tablist", { name: "Website sections" });
      await waitFor(() => {
        expect(within(tabList).getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
          "Crawls",
          "Objects",
          "Screenshots",
          "Credentials · 0",
        ]);
      });
      // The web objects are only fetched once their tab is opened.
      expect(countRequests(fetchStub, "GET", WEB_OBJECTS_API_URL)).toBe(0);
      expect(within(tabList).getByRole("tab", { name: "Crawls" })).toHaveAttribute("aria-selected", "true");
      expect(within(sidePanel).getByRole("tabpanel", { name: "Crawls" })).toBeInTheDocument();
      expect(screen.getByRole("region", { name: "Actions" })).toBeInTheDocument();
      expect(screen.getByRole("region", { name: "Use cases" })).toBeInTheDocument();
    });

    it("opens another tab in place of the last, replacing the query string rather than adding history", async () => {
      const user = userEvent.setup();
      stubLoadedWebsite();
      renderWebsiteDetailPage(OPENED_FROM_LIST);

      const screenshotsPanel = await openTab(user, "Screenshots");

      expect(within(screenshotsPanel).getByRole("button", { name: "Take screenshot" })).toBeInTheDocument();
      expect(screen.queryByRole("tabpanel", { name: "Crawls" })).not.toBeInTheDocument();
      expect(screen.getByTestId("page-search").textContent).toBe("?tab=screenshots");
      expect(screen.getByTestId("page-navigation-type").textContent).toBe("REPLACE");
    });

    it("opens the Objects tab, which lists the web objects the latest crawl found", async () => {
      const user = userEvent.setup();
      stubLoadedWebsite({
        [`GET ${WEB_OBJECTS_API_URL}`]: { status: 200, body: [buildWebObjectRecord({ name: "Site" })] },
      });
      renderWebsiteDetailPage(OPENED_FROM_LIST);

      const objectsPanel = await openTab(user, "Objects");

      expect(await within(objectsPanel).findByRole("heading", { name: "Site" })).toBeInTheDocument();
      expect(within(objectsPanel).getByText("detected as Website")).toBeInTheDocument();
      expect(screen.getByTestId("page-search").textContent).toBe("?tab=objects");
    });

    it("opens the tab named in the query string", async () => {
      stubLoadedWebsite();

      renderWebsiteDetailPage(openedFromListOnTab("screenshots"));

      expect(await screen.findByRole("tabpanel", { name: "Screenshots" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Screenshots" })).toHaveAttribute("aria-selected", "true");
    });

    it.each([
      { label: "an unknown tab", tab: "settings" },
      { label: "a phone-only tab on desktop", tab: "actions" },
    ])("falls back to Crawls for $label", async ({ tab }) => {
      stubLoadedWebsite();

      renderWebsiteDetailPage(openedFromListOnTab(tab));

      expect(await screen.findByRole("tabpanel", { name: "Crawls" })).toBeInTheDocument();
    });

    it("falls back to Crawls for the Credentials tab of a website nothing can log in to", async () => {
      const fetchStub = stubLoadedWebsite({
        [`GET ${WEBSITE_API_URL}`]: { status: 200, body: buildWebsiteRecord({ loginUrl: null }) },
      });

      renderWebsiteDetailPage(openedFromListOnTab("credentials"));

      expect(await screen.findByRole("tabpanel", { name: "Crawls" })).toBeInTheDocument();
      await waitFor(() => {
        expect(countRequests(fetchStub, "GET", CREDENTIALS_API_URL)).toBe(1);
      });
      expect(screen.queryByRole("tab", { name: /Credentials/ })).not.toBeInTheDocument();
    });
  });

  describe("screenshots", () => {
    const newerRun = buildScreenshotRunRecord({
      id: "run-2",
      succeeded: false,
      httpStatus: 404,
      errorMessage: "The page responded with HTTP 404",
      createdAt: "2026-03-02T00:00:00.000Z",
    });
    const olderRun = buildScreenshotRunRecord({
      id: "run-1",
      createdAt: "2026-03-01T00:00:00.000Z",
    });
    const takenRun = buildScreenshotRunRecord({
      id: "run-3",
      durationMs: 2100,
      createdAt: "2026-03-03T00:00:00.000Z",
    });

    it("keeps Take screenshot in the Screenshots tab, not the header", async () => {
      stubLoadedWebsite();

      renderWebsiteDetailPage(OPENED_FROM_LIST);

      await screen.findByRole("tabpanel", { name: "Crawls" });
      expect(screen.queryByRole("button", { name: "Take screenshot" })).not.toBeInTheDocument();
    });

    it("shows the empty state when the website has no screenshot runs", async () => {
      const user = userEvent.setup();
      stubLoadedWebsite();
      renderWebsiteDetailPage(OPENED_FROM_LIST);

      const screenshotsPanel = await openTab(user, "Screenshots");

      expect(await within(screenshotsPanel).findByText("No screenshots yet.")).toBeInTheDocument();
      expect(within(screenshotsPanel).getByRole("button", { name: "Take screenshot" })).toBeEnabled();
    });

    it("shows the website's own screenshot timing settings", async () => {
      stubLoadedWebsite({
        [`GET ${WEBSITE_API_URL}`]: {
          status: 200,
          body: buildWebsiteRecord({ networkIdleTimeoutMs: 8000, screenshotMinimumWaitMs: 1500 }),
        },
      });

      renderWebsiteDetailPage(openedFromListOnTab("screenshots"));

      const screenshotsPanel = await screen.findByRole("tabpanel", { name: "Screenshots" });
      expect(screenshotsPanel).toHaveTextContent("waits up to 8000 ms for network requests to finish");
      expect(screenshotsPanel).toHaveTextContent("at least 1500 ms after the page loads");
    });

    it("shows the newest run's status and screenshot, and every run in the history", async () => {
      stubLoadedWebsite({
        [`GET ${SCREENSHOT_RUNS_API_URL}`]: { status: 200, body: [newerRun, olderRun] },
      });

      renderWebsiteDetailPage(openedFromListOnTab("screenshots"));

      expect(await screen.findByRole("status")).toHaveTextContent("Failed · HTTP 404");
      // Named: the actions list has run status icons, which are images too.
      expect(screen.getByRole("img", { name: /^Screenshot of / })).toHaveAttribute(
        "src",
        `${SCREENSHOT_RUNS_API_URL}/run-2/screenshot`,
      );
      const runHistory = screen.getByRole("list", { name: "History" });
      expect(within(runHistory).getAllByRole("button")).toHaveLength(2);
    });

    it("switches the status and screenshot when an older run is clicked", async () => {
      const user = userEvent.setup();
      stubLoadedWebsite({
        [`GET ${SCREENSHOT_RUNS_API_URL}`]: { status: 200, body: [newerRun, olderRun] },
      });
      renderWebsiteDetailPage(openedFromListOnTab("screenshots"));
      const runHistory = await screen.findByRole("list", { name: "History" });

      await user.click(within(runHistory).getByRole("button", { name: /Succeeded · HTTP 200/ }));

      expect(screen.getByRole("status")).toHaveTextContent("Succeeded · HTTP 200");
      // Named: the actions list has run status icons, which are images too.
      expect(screen.getByRole("img", { name: /^Screenshot of / })).toHaveAttribute(
        "src",
        `${SCREENSHOT_RUNS_API_URL}/run-1/screenshot`,
      );
    });

    it("disables the button and shows progress while the screenshot is being taken", async () => {
      const user = userEvent.setup();
      const pendingScreenshot = createDeferred<Response>();
      stubLoadedWebsite({ [`POST ${SCREENSHOT_RUNS_API_URL}`]: () => pendingScreenshot.promise });
      renderWebsiteDetailPage(openedFromListOnTab("screenshots"));

      await user.click(await screen.findByRole("button", { name: "Take screenshot" }));

      expect(screen.getByRole("button", { name: "Taking screenshot…" })).toBeDisabled();
      expect(screen.getByRole("progressbar", { name: "Taking screenshot" })).toBeInTheDocument();

      await act(async () => {
        pendingScreenshot.resolve(buildJsonResponse(201, takenRun));
        await pendingScreenshot.promise;
      });
      expect(await screen.findByRole("button", { name: "Take screenshot" })).toBeEnabled();
      expect(screen.queryByRole("progressbar", { name: "Taking screenshot" })).not.toBeInTheDocument();
    });

    it("POSTs once, then shows the new run first and selected, without refetching the list", async () => {
      const user = userEvent.setup();
      const fetchStub = stubLoadedWebsite({
        [`GET ${SCREENSHOT_RUNS_API_URL}`]: { status: 200, body: [newerRun, olderRun] },
        [`POST ${SCREENSHOT_RUNS_API_URL}`]: { status: 201, body: takenRun },
      });
      renderWebsiteDetailPage(openedFromListOnTab("screenshots"));
      const runHistory = await screen.findByRole("list", { name: "History" });
      // Pick an older run first, to prove the new run takes over the selection.
      await user.click(within(runHistory).getByRole("button", { name: /Succeeded · HTTP 200/ }));

      await user.click(screen.getByRole("button", { name: "Take screenshot" }));

      await waitFor(() => {
        expect(within(runHistory).getAllByRole("button")).toHaveLength(3);
      });
      const historyItems = within(runHistory).getAllByRole("button");
      expect(historyItems[0]).toHaveAttribute("aria-current", "true");
      expect(screen.getByRole("status")).toHaveTextContent("Succeeded · HTTP 200 · 2.1 s");
      // Named: the actions list has run status icons, which are images too.
      expect(screen.getByRole("img", { name: /^Screenshot of / })).toHaveAttribute(
        "src",
        `${SCREENSHOT_RUNS_API_URL}/run-3/screenshot`,
      );
      expect(fetchStub).toHaveBeenCalledWith(SCREENSHOT_RUNS_API_URL, { method: "POST" });
      expect(countRequests(fetchStub, "POST", SCREENSHOT_RUNS_API_URL)).toBe(1);
      expect(countRequests(fetchStub, "GET", SCREENSHOT_RUNS_API_URL)).toBe(1);
    });

    it("shows the server's reason and re-enables the button when taking a screenshot fails", async () => {
      const user = userEvent.setup();
      stubLoadedWebsite({
        [`POST ${SCREENSHOT_RUNS_API_URL}`]: {
          status: 500,
          body: { error: "browserType.launch: Executable doesn't exist" },
        },
      });
      renderWebsiteDetailPage(openedFromListOnTab("screenshots"));

      await user.click(await screen.findByRole("button", { name: "Take screenshot" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Could not take a screenshot: browserType.launch: Executable doesn't exist",
      );
      expect(screen.getByRole("button", { name: "Take screenshot" })).toBeEnabled();
      expect(screen.getByText("No screenshots yet.")).toBeInTheDocument();
    });

    it("shows a run list failure in the tab, and still shows a newly taken run", async () => {
      const user = userEvent.setup();
      stubLoadedWebsite({
        [`GET ${SCREENSHOT_RUNS_API_URL}`]: { status: 500, body: { error: "Database unavailable" } },
        [`POST ${SCREENSHOT_RUNS_API_URL}`]: { status: 201, body: takenRun },
      });
      renderWebsiteDetailPage(openedFromListOnTab("screenshots"));
      const screenshotsPanel = await screen.findByRole("tabpanel", { name: "Screenshots" });
      expect(await within(screenshotsPanel).findByRole("alert")).toHaveTextContent("Database unavailable");

      await user.click(screen.getByRole("button", { name: "Take screenshot" }));

      expect(await within(screenshotsPanel).findByRole("status")).toHaveTextContent("Succeeded · HTTP 200");
    });
  });

  describe("crawls", () => {
    const finishedCrawlRun = buildCrawlRunRecord({
      id: "crawl-run-1",
      status: "finished",
      visitedPageCount: 12,
      createdAt: "2026-03-04T05:06:07.000Z",
    });
    const runningCrawlRun = buildCrawlRunRecord({
      id: "crawl-run-2",
      status: "running",
      visitedPageCount: 4,
      waitingUrlCount: 7,
      durationMs: null,
      finishedAt: null,
      createdAt: "2026-03-05T05:06:07.000Z",
    });

    it("shows the empty state and an enabled Crawl website button when the website has no crawls", async () => {
      stubLoadedWebsite();
      renderWebsiteDetailPage(OPENED_FROM_LIST);

      const crawlsPanel = await screen.findByRole("tabpanel", { name: "Crawls" });

      expect(await within(crawlsPanel).findByText("No crawls yet.")).toBeInTheDocument();
      expect(within(crawlsPanel).getByRole("button", { name: "Crawl website" })).toBeEnabled();
    });

    it("lists every crawl in the history, each linking to its own page", async () => {
      stubLoadedWebsite({
        [`GET ${CRAWL_RUNS_API_URL}`]: { status: 200, body: [finishedCrawlRun] },
      });
      renderWebsiteDetailPage(OPENED_FROM_LIST);

      const history = await screen.findByRole("list", { name: "History" });
      const runLink = within(history).getByRole("link", { name: /Finished · 12 pages/ });

      expect(runLink).toHaveAttribute("href", "/websites/website-1/crawl-runs/crawl-run-1");
      expect(within(runLink).getByTitle(new Date(finishedCrawlRun.createdAt).toLocaleString())).toBeInTheDocument();
    });

    it("disables the button and shows the running crawl's progress, with a Watch link, while one runs", async () => {
      stubLoadedWebsite({
        [`GET ${CRAWL_RUNS_API_URL}`]: {
          status: 200,
          body: [runningCrawlRun, finishedCrawlRun],
        },
      });
      renderWebsiteDetailPage(OPENED_FROM_LIST);

      const progressCard = await screen.findByRole("status");
      expect(within(progressCard).getByText("Crawl running")).toBeInTheDocument();
      expect(within(progressCard).getByText("4 of up to 50 pages · 7 waiting")).toBeInTheDocument();
      expect(within(progressCard).getByRole("link", { name: "Watch" })).toHaveAttribute(
        "href",
        "/websites/website-1/crawl-runs/crawl-run-2",
      );
      expect(screen.getByRole("button", { name: "Crawl website" })).toBeDisabled();
      expect(screen.getByText("One crawl at a time — wait for the current one to finish.")).toBeInTheDocument();
      const history = screen.getByRole("list", { name: "History" });
      expect(within(history).getAllByRole("link")).toHaveLength(1);
    });

    it("re-fetches the crawl list while a crawl runs, so its progress card counts pages live", async () => {
      const progressedCrawlRun = { ...runningCrawlRun, visitedPageCount: 9, waitingUrlCount: 3 };
      let crawlListRequestCount = 0;
      const fetchStub = stubLoadedWebsite({
        [`GET ${CRAWL_RUNS_API_URL}`]: () => {
          crawlListRequestCount += 1;
          const crawlList = crawlListRequestCount === 1 ? [runningCrawlRun] : [progressedCrawlRun];
          return Promise.resolve(buildJsonResponse(200, crawlList));
        },
      });
      renderWebsiteDetailPage(OPENED_FROM_LIST);

      expect(await screen.findByText("4 of up to 50 pages · 7 waiting")).toBeInTheDocument();

      expect(
        await screen.findByText("9 of up to 50 pages · 3 waiting", {}, { timeout: 4000 }),
      ).toBeInTheDocument();
      expect(countRequests(fetchStub, "GET", CRAWL_RUNS_API_URL)).toBeGreaterThanOrEqual(2);
    });

    it("POSTs once, following links only by default, and opens the new crawl's page", async () => {
      const user = userEvent.setup();
      const fetchStub = stubLoadedWebsite({
        [`POST ${CRAWL_RUNS_API_URL}`]: { status: 201, body: runningCrawlRun },
      });
      renderWebsiteDetailPage(OPENED_FROM_LIST);

      await user.click(await screen.findByRole("button", { name: "Crawl website" }));

      const landing = await readProbeAfterLanding("/websites/website-1/crawl-runs/crawl-run-2");
      expect(landing.navigationType).toBe("PUSH");
      expect(fetchStub).toHaveBeenCalledWith(CRAWL_RUNS_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credentialId: null, buttonMode: "linksOnly" }),
      });
      expect(countRequests(fetchStub, "POST", CRAWL_RUNS_API_URL)).toBe(1);
    });

    it("crawls logged in as the credential picked in Crawl as", async () => {
      const user = userEvent.setup();
      const fetchStub = stubLoadedWebsite({
        [`GET ${CREDENTIALS_API_URL}`]: {
          status: 200,
          body: [buildCredentialRecord({ id: "credential-1", name: "Admin" })],
        },
        [`POST ${CRAWL_RUNS_API_URL}`]: { status: 201, body: runningCrawlRun },
      });
      renderWebsiteDetailPage(OPENED_FROM_LIST);
      await screen.findByRole("tab", { name: "Credentials · 1" });

      await user.click(screen.getByRole("combobox", { name: "Crawl as" }));
      await user.click(await screen.findByRole("option", { name: "Admin" }));
      await user.click(screen.getByRole("button", { name: "Crawl website" }));

      await readProbeAfterLanding("/websites/website-1/crawl-runs/crawl-run-2");
      expect(fetchStub).toHaveBeenCalledWith(CRAWL_RUNS_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credentialId: "credential-1", buttonMode: "linksOnly" }),
      });
    });

    it("crawls with the button mode picked in Buttons", async () => {
      const user = userEvent.setup();
      const fetchStub = stubLoadedWebsite({
        [`POST ${CRAWL_RUNS_API_URL}`]: { status: 201, body: runningCrawlRun },
      });
      renderWebsiteDetailPage(OPENED_FROM_LIST);

      await user.click(await screen.findByRole("combobox", { name: "Buttons" }));
      await user.click(await screen.findByRole("option", { name: "Only “Open” buttons" }));
      await user.click(screen.getByRole("button", { name: "Crawl website" }));

      await readProbeAfterLanding("/websites/website-1/crawl-runs/crawl-run-2");
      expect(fetchStub).toHaveBeenCalledWith(CRAWL_RUNS_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credentialId: null, buttonMode: "openOnly" }),
      });
    });

    it("narrows the History to the crawls made with the mode picked in Buttons", async () => {
      const user = userEvent.setup();
      const allButRiskyCrawlRun = buildCrawlRunRecord({
        id: "crawl-run-all-but-risky",
        buttonMode: "allButRisky",
      });
      stubLoadedWebsite({
        [`GET ${CRAWL_RUNS_API_URL}`]: { status: 200, body: [allButRiskyCrawlRun, finishedCrawlRun] },
      });
      renderWebsiteDetailPage(OPENED_FROM_LIST);

      const linksOnlyHistory = await screen.findByRole("list", { name: "History" });
      expect(within(linksOnlyHistory).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
        "/websites/website-1/crawl-runs/crawl-run-1",
      ]);

      await user.click(screen.getByRole("combobox", { name: "Buttons" }));
      await user.click(await screen.findByRole("option", { name: "Buttons, except risky ones" }));
      const allButRiskyHistory = screen.getByRole("list", { name: "History" });
      expect(within(allButRiskyHistory).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
        "/websites/website-1/crawl-runs/crawl-run-all-but-risky",
      ]);

      await user.click(screen.getByRole("combobox", { name: "Buttons" }));
      await user.click(await screen.findByRole("option", { name: "Only “Open” buttons" }));
      expect(screen.getByText("No logged-out crawls with only “Open” buttons yet.")).toBeInTheDocument();
      expect(screen.queryByRole("list", { name: "History" })).not.toBeInTheDocument();
    });

    it("narrows the History to the crawls made as the person picked in Crawl as", async () => {
      const user = userEvent.setup();
      const adminCrawlRun = buildCrawlRunRecord({
        id: "crawl-run-admin",
        credentialId: "credential-1",
        isLoggedIn: true,
        credential: { id: "credential-1", name: "Admin" },
      });
      stubLoadedWebsite({
        [`GET ${CRAWL_RUNS_API_URL}`]: { status: 200, body: [adminCrawlRun, finishedCrawlRun] },
        [`GET ${CREDENTIALS_API_URL}`]: {
          status: 200,
          body: [
            buildCredentialRecord({ id: "credential-1", name: "Admin" }),
            buildCredentialRecord({ id: "credential-2", name: "Editor" }),
          ],
        },
      });
      renderWebsiteDetailPage(OPENED_FROM_LIST);
      await screen.findByRole("tab", { name: "Credentials · 2" });

      const loggedOutHistory = await screen.findByRole("list", { name: "History" });
      expect(within(loggedOutHistory).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
        "/websites/website-1/crawl-runs/crawl-run-1",
      ]);

      await user.click(screen.getByRole("combobox", { name: "Crawl as" }));
      await user.click(await screen.findByRole("option", { name: "Admin" }));
      const adminHistory = screen.getByRole("list", { name: "History" });
      expect(within(adminHistory).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
        "/websites/website-1/crawl-runs/crawl-run-admin",
      ]);

      await user.click(screen.getByRole("combobox", { name: "Crawl as" }));
      await user.click(await screen.findByRole("option", { name: "Editor" }));
      expect(screen.getByText("No crawls as “Editor” with links only yet.")).toBeInTheDocument();
      expect(screen.queryByRole("list", { name: "History" })).not.toBeInTheDocument();
    });

    it("hides Crawl as and crawls logged out when neither the website nor a credential has a login page", async () => {
      const user = userEvent.setup();
      const fetchStub = stubLoadedWebsite({
        [`GET ${WEBSITE_API_URL}`]: { status: 200, body: buildWebsiteRecord({ loginUrl: null }) },
        [`GET ${CREDENTIALS_API_URL}`]: {
          status: 200,
          body: [buildCredentialRecord({ id: "credential-1", loginUrl: null })],
        },
        [`POST ${CRAWL_RUNS_API_URL}`]: { status: 201, body: runningCrawlRun },
      });
      renderWebsiteDetailPage(OPENED_FROM_LIST);
      const crawlsPanel = await screen.findByRole("tabpanel", { name: "Crawls" });
      await waitFor(() => {
        expect(countRequests(fetchStub, "GET", CREDENTIALS_API_URL)).toBe(1);
      });

      expect(within(crawlsPanel).queryByRole("combobox", { name: "Crawl as" })).not.toBeInTheDocument();
      expect(within(crawlsPanel).getByRole("combobox", { name: "Buttons" })).toBeInTheDocument();
      await user.click(within(crawlsPanel).getByRole("button", { name: "Crawl website" }));

      await readProbeAfterLanding("/websites/website-1/crawl-runs/crawl-run-2");
      expect(fetchStub).toHaveBeenCalledWith(CRAWL_RUNS_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credentialId: null, buttonMode: "linksOnly" }),
      });
    });

    it("disables the button and says so while the crawl is being started", async () => {
      const user = userEvent.setup();
      const pendingStart = createDeferred<Response>();
      stubLoadedWebsite({ [`POST ${CRAWL_RUNS_API_URL}`]: () => pendingStart.promise });
      renderWebsiteDetailPage(OPENED_FROM_LIST);

      await user.click(await screen.findByRole("button", { name: "Crawl website" }));

      expect(screen.getByRole("button", { name: "Starting crawl…" })).toBeDisabled();
      await act(async () => {
        pendingStart.resolve(buildJsonResponse(201, runningCrawlRun));
        await pendingStart.promise;
      });
      await readProbeAfterLanding("/websites/website-1/crawl-runs/crawl-run-2");
    });

    it("shows the server's reason and stays on the page when the crawl cannot start", async () => {
      const user = userEvent.setup();
      stubLoadedWebsite({
        [`POST ${CRAWL_RUNS_API_URL}`]: {
          status: 409,
          body: { error: "A crawl is already running for this website" },
        },
      });
      renderWebsiteDetailPage(OPENED_FROM_LIST);
      const crawlsPanel = await screen.findByRole("tabpanel", { name: "Crawls" });

      await user.click(within(crawlsPanel).getByRole("button", { name: "Crawl website" }));

      expect(await within(crawlsPanel).findByRole("alert")).toHaveTextContent(
        "Could not start a crawl: A crawl is already running for this website",
      );
      expect(within(crawlsPanel).getByRole("button", { name: "Crawl website" })).toBeEnabled();
      expect(screen.getByRole("heading", { level: 1, name: "Example" })).toBeInTheDocument();
    });

    it("shows a crawl list failure in the tab", async () => {
      stubLoadedWebsite({
        [`GET ${CRAWL_RUNS_API_URL}`]: { status: 500, body: { error: "Database unavailable" } },
      });
      renderWebsiteDetailPage(OPENED_FROM_LIST);
      const crawlsPanel = await screen.findByRole("tabpanel", { name: "Crawls" });

      expect(await within(crawlsPanel).findByRole("alert")).toHaveTextContent("Database unavailable");
      expect(within(crawlsPanel).queryByText("No crawls yet.")).not.toBeInTheDocument();
    });

    it("counts the website's crawl runs in the delete dialog", async () => {
      const user = userEvent.setup();
      stubLoadedWebsite({
        [`GET ${CRAWL_RUNS_API_URL}`]: { status: 200, body: [finishedCrawlRun] },
      });
      renderWebsiteDetailPage(OPENED_FROM_LIST);
      await screen.findByRole("list", { name: "History" });

      const dialog = await openDeleteDialog(user);

      expect(dialog).toHaveTextContent(
        "1 use case, 2 actions, 0 screenshot runs, 1 crawl run, and 0 credentials.",
      );
    });
  });

  describe("credentials", () => {
    it("lists the website's credentials, each linking to its edit page, with a New credential link", async () => {
      const user = userEvent.setup();
      stubLoadedWebsite({
        [`GET ${CREDENTIALS_API_URL}`]: {
          status: 200,
          body: [
            buildCredentialRecord({ id: "credential-1", name: "Admin" }),
            buildCredentialRecord({
              id: "credential-2",
              name: "Viewer",
              username: "viewer@example.com",
              description: null,
            }),
          ],
        },
      });
      renderWebsiteDetailPage(OPENED_FROM_LIST);

      const credentialsPanel = await openTab(user, "Credentials · 2");
      const credentialList = within(credentialsPanel).getByRole("list", { name: "Credentials" });
      const credentialLinks = within(credentialList).getAllByRole("link");
      expect(credentialLinks).toHaveLength(2);
      expect(credentialLinks[0]).toHaveTextContent("Admin");
      expect(credentialLinks[0]).toHaveTextContent("admin@example.com · The admin account");
      expect(credentialLinks[0]).toHaveAttribute(
        "href",
        "/websites/website-1/credentials/credential-1/edit",
      );
      expect(credentialLinks[1]).toHaveTextContent("viewer@example.com");
      const newCredentialLink = within(credentialsPanel).getByRole("link", { name: "New credential" });
      expect(newCredentialLink).toHaveAttribute("href", "/websites/website-1/credentials/new");
      expect(within(newCredentialLink).getByTestId("AddIcon")).toBeInTheDocument();
    });

    it("shows the empty state when the website has no credentials", async () => {
      const user = userEvent.setup();
      stubLoadedWebsite();
      renderWebsiteDetailPage(OPENED_FROM_LIST);

      const credentialsPanel = await openTab(user, "Credentials · 0");

      expect(await within(credentialsPanel).findByText("No credentials yet.")).toBeInTheDocument();
    });

    it("opens the new credential form with this page as its return state", async () => {
      stubLoadedWebsite();
      const user = userEvent.setup();
      renderWebsiteDetailPage(openedFromListOnTab("credentials"));

      await user.click(await screen.findByRole("link", { name: "New credential" }));

      const landing = await readProbeAfterLanding("/websites/website-1/credentials/new");
      expect(landing.state).toBe(JSON.stringify({ returnTo: DETAIL_PATH }));
    });

    it("hides the tab when neither the website nor any credential has a login page, still counting the credentials in the delete dialog", async () => {
      const user = userEvent.setup();
      stubLoadedWebsite({
        [`GET ${WEBSITE_API_URL}`]: { status: 200, body: buildWebsiteRecord({ loginUrl: null }) },
        [`GET ${CREDENTIALS_API_URL}`]: {
          status: 200,
          body: [
            buildCredentialRecord({ id: "credential-1", loginUrl: null }),
            buildCredentialRecord({ id: "credential-2", loginUrl: null }),
          ],
        },
      });
      renderWebsiteDetailPage(OPENED_FROM_LIST);

      const dialog = await openDeleteDialog(user);

      expect(dialog).toHaveTextContent("0 crawl runs, and 2 credentials.");
      expect(screen.queryByRole("tab", { name: /Credentials/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "New credential" })).not.toBeInTheDocument();
    });

    it("hides the tab for a website without a login page and no credentials", async () => {
      stubLoadedWebsite({
        [`GET ${WEBSITE_API_URL}`]: { status: 200, body: buildWebsiteRecord({ loginUrl: null }) },
      });
      renderWebsiteDetailPage(OPENED_FROM_LIST);

      await screen.findByRole("tabpanel", { name: "Crawls" });
      await screen.findByRole("list", { name: "Actions" });

      expect(screen.queryByRole("tab", { name: /Credentials/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("combobox", { name: "Crawl as" })).not.toBeInTheDocument();
    });

    it("shows the tab and Crawl as when only a credential has its own login page", async () => {
      const user = userEvent.setup();
      const fetchStub = stubLoadedWebsite({
        [`GET ${WEBSITE_API_URL}`]: { status: 200, body: buildWebsiteRecord({ loginUrl: null }) },
        [`GET ${CREDENTIALS_API_URL}`]: {
          status: 200,
          body: [
            buildCredentialRecord({
              id: "credential-1",
              name: "Gym teacher",
              loginUrl: "https://example.com/sign-in",
            }),
          ],
        },
        [`POST ${CRAWL_RUNS_API_URL}`]: {
          status: 201,
          body: buildCrawlRunRecord({ id: "crawl-run-3", status: "running" }),
        },
      });
      renderWebsiteDetailPage(OPENED_FROM_LIST);

      expect(await screen.findByRole("tab", { name: "Credentials · 1" })).toBeInTheDocument();
      expect(screen.getByText("Doesn't require login")).toBeInTheDocument();
      await user.click(screen.getByRole("combobox", { name: "Crawl as" }));
      await user.click(await screen.findByRole("option", { name: "Gym teacher" }));
      await user.click(screen.getByRole("button", { name: "Crawl website" }));

      await readProbeAfterLanding("/websites/website-1/crawl-runs/crawl-run-3");
      expect(fetchStub).toHaveBeenCalledWith(CRAWL_RUNS_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credentialId: "credential-1", buttonMode: "linksOnly" }),
      });
    });

    it("shows a credential list failure in the tab, which then shows no count", async () => {
      stubLoadedWebsite({
        [`GET ${CREDENTIALS_API_URL}`]: { status: 500, body: { error: "Database unavailable" } },
      });
      renderWebsiteDetailPage(openedFromListOnTab("credentials"));
      const credentialsPanel = await screen.findByRole("tabpanel", { name: "Credentials" });

      expect(await within(credentialsPanel).findByRole("alert")).toHaveTextContent("Database unavailable");
    });

    it("counts the website's credentials in the delete dialog", async () => {
      const user = userEvent.setup();
      stubLoadedWebsite({
        [`GET ${CREDENTIALS_API_URL}`]: {
          status: 200,
          body: [
            buildCredentialRecord({ id: "credential-1" }),
            buildCredentialRecord({ id: "credential-2" }),
          ],
        },
      });
      renderWebsiteDetailPage(OPENED_FROM_LIST);
      await screen.findByRole("tab", { name: "Credentials · 2" });

      const dialog = await openDeleteDialog(user);

      expect(dialog).toHaveTextContent("0 crawl runs, and 2 credentials.");
    });
  });

  describe("on a phone", () => {
    let removeWidthStub: (() => void) | null = null;

    beforeEach(() => {
      removeWidthStub = stubWindowWidth(390);
    });

    afterEach(() => {
      removeWidthStub?.();
      removeWidthStub = null;
    });

    it("puts every section in one row of tabs, Actions open, with only the URL under the name", async () => {
      stubLoadedWebsite();

      renderWebsiteDetailPage(OPENED_FROM_LIST);

      const tabList = await screen.findByRole("tablist", { name: "Website sections" });
      await waitFor(() => {
        expect(within(tabList).getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
          "Actions",
          "Crawls",
          "Objects",
          "Use cases",
          "Screenshots",
          "Credentials · 0",
        ]);
      });
      const actionsPanel = screen.getByRole("tabpanel", { name: "Actions" });
      expect(within(actionsPanel).getByRole("list", { name: "Actions" })).toBeInTheDocument();
      expect(screen.queryByRole("list", { name: "Use cases" })).not.toBeInTheDocument();
      expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
      expect(screen.getByRole("link", { name: "https://example.com" })).toBeInTheDocument();
      expect(screen.queryByText(/^Login page/)).not.toBeInTheDocument();
      expect(screen.queryByText(/^Updated /)).not.toBeInTheDocument();
    });

    it("opens the use cases from their tab, and from the query string", async () => {
      const user = userEvent.setup();
      stubLoadedWebsite();
      renderWebsiteDetailPage(OPENED_FROM_LIST);

      const useCasesPanel = await openTab(user, "Use cases");

      expect(within(useCasesPanel).getByRole("list", { name: "Use cases" })).toBeInTheDocument();
      expect(screen.getByTestId("page-search").textContent).toBe("?tab=use-cases");
    });

    it("marks the Crawls tab while a crawl runs", async () => {
      stubLoadedWebsite({
        [`GET ${CRAWL_RUNS_API_URL}`]: {
          status: 200,
          body: [buildCrawlRunRecord({ id: "crawl-run-2", status: "running", durationMs: null, finishedAt: null })],
        },
      });
      renderWebsiteDetailPage(OPENED_FROM_LIST);

      const crawlsTab = await screen.findByRole("tab", { name: "Crawls" });

      await waitFor(() => {
        expect(crawlsTab.querySelector('[aria-hidden="true"]')).not.toBeNull();
      });
    });

    it("keeps Edit and Delete behind the More actions menu", async () => {
      const user = userEvent.setup();
      stubLoadedWebsite();
      renderWebsiteDetailPage(OPENED_FROM_LIST);
      await screen.findByRole("heading", { level: 1, name: "Example" });
      expect(screen.queryByRole("link", { name: "Edit" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "More actions" }));
      await user.click(screen.getByRole("menuitem", { name: "Delete" }));

      const dialog = await screen.findByRole("dialog", { name: "Delete website?" });
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });
      await user.click(screen.getByRole("button", { name: "More actions" }));
      await user.click(screen.getByRole("menuitem", { name: "Edit" }));

      const landing = await readProbeAfterLanding("/websites/website-1/edit");
      expect(landing.state).toBe(JSON.stringify({ returnTo: DETAIL_PATH }));
    });
  });
});
