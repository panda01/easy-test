import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, screen, waitFor, within, type RenderResult } from "@testing-library/react";
import { userEvent, type UserEvent } from "@testing-library/user-event";
import { Route } from "react-router-dom";
import WebsiteDetailPage from "../../src/pages/WebsiteDetailPage";
import {
  buildJsonResponse,
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
 * Stubs a successful load of the website with one use case and two actions,
 * plus any extra or replacement routes.
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
  });

  it("shows the server's not-found text and nothing else for an unknown website", async () => {
    stubLoadedWebsite({
      [`GET ${WEBSITE_API_URL}`]: { status: 404, body: { error: "Website not found" } },
    });

    renderWebsiteDetailPage(OPENED_FROM_LIST);

    expect(await screen.findByRole("alert")).toHaveTextContent("Website not found");
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Use cases" })).not.toBeInTheDocument();
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

  it("names the use case and action counts in the delete dialog", async () => {
    const user = userEvent.setup();
    stubLoadedWebsite();
    renderWebsiteDetailPage(OPENED_FROM_LIST);

    const dialog = await openDeleteDialog(user);

    expect(dialog).toHaveTextContent(
      '"Example" will be deleted, along with its 1 use case and 2 actions.',
    );
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
      "along with its 0 use cases and 0 actions.",
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
});
