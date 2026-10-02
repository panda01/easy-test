import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, screen, waitFor, within, type RenderResult } from "@testing-library/react";
import { userEvent, type UserEvent } from "@testing-library/user-event";
import { Route } from "react-router-dom";
import WebsiteDetailPage from "../../src/pages/WebsiteDetailPage";
import {
  buildJsonResponse,
  buildScreenshotRunRecord,
  buildWebsiteItemRecord,
  buildWebsiteRecord,
  countRequests,
  createDeferred,
  readBreadcrumbTrail,
  readProbeAfterLanding,
  renderPageRoutes,
  stubFetchRoutes,
  type FetchStub,
  type RouterStart,
  type StubbedRouteTable,
} from "./support/frontendTestHelpers";

const LIST_PATH = "/websites";
const DETAIL_PATH = "/websites/website-1";
const WEBSITE_API_URL = "/api/websites/website-1";
const USE_CASES_API_URL = "/api/websites/website-1/use-cases";
const ACTIONS_API_URL = "/api/websites/website-1/actions";
const SCREENSHOT_RUNS_API_URL = "/api/websites/website-1/screenshot-runs";

/** History as it is after clicking the website on the list. */
const OPENED_FROM_LIST: RouterStart = {
  initialEntries: [LIST_PATH, { pathname: DETAIL_PATH, state: { returnTo: LIST_PATH } }],
};

/** History after opening the page directly (deep link or reload): no state. */
const OPENED_BY_DEEP_LINK: RouterStart = { initialEntries: [DETAIL_PATH] };

/**
 * Renders the website page on its real route (`/websites/:websiteId`).
 * @param routerStart - The history stack to start from
 * @returns The Testing Library render result
 */
function renderWebsiteDetailPage(routerStart: RouterStart): RenderResult {
  return renderPageRoutes(
    <Route path="/websites/:websiteId" element={<WebsiteDetailPage />} />,
    routerStart,
  );
}

/**
 * Stubs a successful load of the website with one use case, two actions, and
 * no screenshot runs, plus any extra or replacement routes.
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
        buildWebsiteItemRecord({ id: "action-1", title: "Open the login page" }),
        buildWebsiteItemRecord({ id: "action-2", title: "Submit credentials" }),
      ],
    },
    [`GET ${SCREENSHOT_RUNS_API_URL}`]: { status: 200, body: [] },
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
    expect(screen.queryByRole("button", { name: "Take screenshot" })).not.toBeInTheDocument();
  });

  it("shows the server's not-found text and nothing else for an unknown website", async () => {
    stubLoadedWebsite({
      [`GET ${WEBSITE_API_URL}`]: { status: 404, body: { error: "Website not found" } },
    });

    renderWebsiteDetailPage(OPENED_FROM_LIST);

    expect(await screen.findByRole("alert")).toHaveTextContent("Website not found");
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Use cases" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Screenshots" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Take screenshot" })).not.toBeInTheDocument();
  });

  it("shows the website's name, URL link, description, timestamps, and breadcrumbs", async () => {
    stubLoadedWebsite();

    renderWebsiteDetailPage(OPENED_FROM_LIST);

    expect(await screen.findByRole("heading", { level: 1, name: "Example" })).toBeInTheDocument();
    const urlLink = screen.getByRole("link", { name: "https://example.com" });
    expect(urlLink).toHaveAttribute("href", "https://example.com");
    expect(urlLink).toHaveAttribute("target", "_blank");
    expect(urlLink).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText("The example site")).toBeInTheDocument();
    expect(screen.getByText(/Created .+ · Updated .+/)).toBeInTheDocument();
    expect(readBreadcrumbTrail()).toEqual([
      { label: "Websites", href: LIST_PATH },
      { label: "Example", href: null },
    ]);
  });

  it("says so when the website has no description", async () => {
    stubLoadedWebsite({
      [`GET ${WEBSITE_API_URL}`]: { status: 200, body: buildWebsiteRecord({ description: null }) },
    });

    renderWebsiteDetailPage(OPENED_FROM_LIST);

    expect(await screen.findByText("No description.")).toBeInTheDocument();
  });

  it("shows the use case and action sections with their items", async () => {
    stubLoadedWebsite();

    renderWebsiteDetailPage(OPENED_FROM_LIST);

    const useCaseList = await screen.findByRole("list", { name: "Use cases" });
    expect(within(useCaseList).getByRole("link", { name: /Log in/ })).toHaveAttribute(
      "href",
      "/websites/website-1/use-cases/use-case-1",
    );
    const actionList = await screen.findByRole("list", { name: "Actions" });
    expect(within(actionList).getAllByRole("link")).toHaveLength(2);
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

  it("names the use case, action, and screenshot run counts in the delete dialog", async () => {
    const user = userEvent.setup();
    stubLoadedWebsite();
    renderWebsiteDetailPage(OPENED_FROM_LIST);

    const dialog = await openDeleteDialog(user);

    expect(dialog).toHaveTextContent(
      '"Example" will be deleted, along with its 1 use case, 2 actions, and 0 screenshot runs.',
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
    renderWebsiteDetailPage(OPENED_FROM_LIST);
    await screen.findByRole("list", { name: "Run history" });

    const dialog = await openDeleteDialog(user);

    expect(dialog).toHaveTextContent("1 use case, 2 actions, and 1 screenshot run.");
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
      "along with its 0 use cases, 0 actions, and 0 screenshot runs.",
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

  it("sends DELETE and goes back to the list when the list opened the page", async () => {
    const user = userEvent.setup();
    const fetchStub = stubLoadedWebsite({ [`DELETE ${WEBSITE_API_URL}`]: { status: 204 } });
    renderWebsiteDetailPage(OPENED_FROM_LIST);
    const dialog = await openDeleteDialog(user);

    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    const landing = await readProbeAfterLanding(LIST_PATH);
    expect(landing.navigationType).toBe("POP");
    expect(fetchStub).toHaveBeenCalledWith(WEBSITE_API_URL, { method: "DELETE" });
  });

  it("replaces the deleted website's page with the list after a deep link", async () => {
    const user = userEvent.setup();
    stubLoadedWebsite({ [`DELETE ${WEBSITE_API_URL}`]: { status: 204 } });
    renderWebsiteDetailPage(OPENED_BY_DEEP_LINK);
    const dialog = await openDeleteDialog(user);

    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    const landing = await readProbeAfterLanding(LIST_PATH);
    expect(landing.navigationType).toBe("REPLACE");
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

    it("shows the empty state when the website has no screenshot runs", async () => {
      stubLoadedWebsite();

      renderWebsiteDetailPage(OPENED_FROM_LIST);

      const section = await screen.findByRole("region", { name: "Screenshots" });
      expect(await within(section).findByText("No screenshots yet.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Take screenshot" })).toBeEnabled();
    });

    it("shows the website's own screenshot timing settings", async () => {
      stubLoadedWebsite({
        [`GET ${WEBSITE_API_URL}`]: {
          status: 200,
          body: buildWebsiteRecord({ networkIdleTimeoutMs: 8000, screenshotMinimumWaitMs: 1500 }),
        },
      });

      renderWebsiteDetailPage(OPENED_FROM_LIST);

      const section = await screen.findByRole("region", { name: "Screenshots" });
      expect(section).toHaveTextContent("waits up to 8000 ms for network requests to finish");
      expect(section).toHaveTextContent("at least 1500 ms after the page loads");
    });

    it("shows the newest run's status and screenshot, and every run in the history", async () => {
      stubLoadedWebsite({
        [`GET ${SCREENSHOT_RUNS_API_URL}`]: { status: 200, body: [newerRun, olderRun] },
      });

      renderWebsiteDetailPage(OPENED_FROM_LIST);

      expect(await screen.findByRole("status")).toHaveTextContent("Failed · HTTP 404");
      expect(screen.getByRole("img")).toHaveAttribute(
        "src",
        `${SCREENSHOT_RUNS_API_URL}/run-2/screenshot`,
      );
      const runHistory = screen.getByRole("list", { name: "Run history" });
      expect(within(runHistory).getAllByRole("button")).toHaveLength(2);
    });

    it("switches the status and screenshot when an older run is clicked", async () => {
      const user = userEvent.setup();
      stubLoadedWebsite({
        [`GET ${SCREENSHOT_RUNS_API_URL}`]: { status: 200, body: [newerRun, olderRun] },
      });
      renderWebsiteDetailPage(OPENED_FROM_LIST);
      const runHistory = await screen.findByRole("list", { name: "Run history" });

      await user.click(within(runHistory).getByRole("button", { name: /Succeeded · HTTP 200/ }));

      expect(screen.getByRole("status")).toHaveTextContent("Succeeded · HTTP 200");
      expect(screen.getByRole("img")).toHaveAttribute(
        "src",
        `${SCREENSHOT_RUNS_API_URL}/run-1/screenshot`,
      );
    });

    it("disables the button and shows progress while the screenshot is being taken", async () => {
      const user = userEvent.setup();
      const pendingScreenshot = createDeferred<Response>();
      stubLoadedWebsite({ [`POST ${SCREENSHOT_RUNS_API_URL}`]: () => pendingScreenshot.promise });
      renderWebsiteDetailPage(OPENED_FROM_LIST);

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
      renderWebsiteDetailPage(OPENED_FROM_LIST);
      const runHistory = await screen.findByRole("list", { name: "Run history" });
      // Pick an older run first, to prove the new run takes over the selection.
      await user.click(within(runHistory).getByRole("button", { name: /Succeeded · HTTP 200/ }));

      await user.click(screen.getByRole("button", { name: "Take screenshot" }));

      await waitFor(() => {
        expect(within(runHistory).getAllByRole("button")).toHaveLength(3);
      });
      const historyItems = within(runHistory).getAllByRole("button");
      expect(historyItems[0]).toHaveAttribute("aria-current", "true");
      expect(screen.getByRole("status")).toHaveTextContent("Succeeded · HTTP 200 · 2.1 s");
      expect(screen.getByRole("img")).toHaveAttribute(
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
      renderWebsiteDetailPage(OPENED_FROM_LIST);

      await user.click(await screen.findByRole("button", { name: "Take screenshot" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Could not take a screenshot: browserType.launch: Executable doesn't exist",
      );
      expect(screen.getByRole("button", { name: "Take screenshot" })).toBeEnabled();
      expect(screen.getByText("No screenshots yet.")).toBeInTheDocument();
    });

    it("shows a run list failure in the section, and still shows a newly taken run", async () => {
      const user = userEvent.setup();
      stubLoadedWebsite({
        [`GET ${SCREENSHOT_RUNS_API_URL}`]: { status: 500, body: { error: "Database unavailable" } },
        [`POST ${SCREENSHOT_RUNS_API_URL}`]: { status: 201, body: takenRun },
      });
      renderWebsiteDetailPage(OPENED_FROM_LIST);
      const section = await screen.findByRole("region", { name: "Screenshots" });
      expect(await within(section).findByRole("alert")).toHaveTextContent("Database unavailable");

      await user.click(screen.getByRole("button", { name: "Take screenshot" }));

      expect(await within(section).findByRole("status")).toHaveTextContent("Succeeded · HTTP 200");
    });
  });
});
