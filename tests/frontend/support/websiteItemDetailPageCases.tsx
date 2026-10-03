import { act, screen, waitFor, within, type RenderResult } from "@testing-library/react";
import { userEvent, type UserEvent } from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import {
  buildJsonResponse,
  buildWebsiteItemRecord,
  buildWebsiteRecord,
  countRequests,
  createDeferred,
  readBreadcrumbTrail,
  readProbeAfterLanding,
  stubFetchRoutes,
  type FetchStub,
  type ItemKindTestCase,
  type RouterStart,
  type StubbedRouteTable,
} from "./frontendTestHelpers";

/*
 * The cases every website item detail page must pass - the summary at the top
 * of the page and the whole delete flow. `UseCaseDetailPage` and
 * `ActionDetailPage` share this behavior (through `WebsiteItemSummary` and
 * `useWebsiteItemDeletion`), so both specs run these same cases. This file is
 * not a spec (it does not end in `.test.tsx`).
 */

const LIST_PATH = "/websites";
const WEBSITE_PATH = "/websites/website-1";
const WEBSITE_API_URL = "/api/websites/website-1";

/** How one page's spec plugs into the shared cases. */
export interface WebsiteItemDetailPageCaseOptions {
  /** The item kind's expected texts and URL segment. */
  kindCase: ItemKindTestCase;
  /** Renders the page on its real route (as App.tsx declares it). */
  renderPage: (routerStart: RouterStart) => RenderResult;
  /**
   * Replies for any other requests the page makes when the item loads (the
   * action page also lists the action's scripts).
   */
  buildPageLoadRoutes: (itemApiUrl: string) => StubbedRouteTable;
}

/**
 * Declares the shared detail page cases inside the calling `describe`.
 * @param options - The kind, how to render the page, and its extra load routes
 */
export function defineWebsiteItemDetailPageCases(options: WebsiteItemDetailPageCaseOptions): void {
  const { kindCase, renderPage, buildPageLoadRoutes } = options;
  const { segment, singularLabel, singularTitle, notFoundText } = kindCase;
  const itemPath = `${WEBSITE_PATH}/${segment}/item-1`;
  const itemApiUrl = `${WEBSITE_API_URL}/${segment}/item-1`;

  /** History as it is after clicking the item on the website's page. */
  const openedFromWebsite: RouterStart = {
    initialEntries: [LIST_PATH, WEBSITE_PATH, { pathname: itemPath, state: { returnTo: WEBSITE_PATH } }],
  };

  /** History after opening the page directly (deep link or reload): no state. */
  const openedByDeepLink: RouterStart = { initialEntries: [itemPath] };

  /**
   * Stubs successful loads of the website, the item, and whatever else the
   * page loads, plus any extra or replacement routes.
   * @param extraRoutes - More replies, e.g. for the DELETE, or replacements for the GETs
   * @returns The installed fetch stub
   */
  const stubLoadedItem = (extraRoutes: StubbedRouteTable = {}): FetchStub =>
    stubFetchRoutes({
      [`GET ${WEBSITE_API_URL}`]: { status: 200, body: buildWebsiteRecord() },
      [`GET ${itemApiUrl}`]: { status: 200, body: buildWebsiteItemRecord() },
      ...buildPageLoadRoutes(itemApiUrl),
      ...extraRoutes,
    });

  /**
   * Waits for the item to load, then opens the delete dialog.
   * @param user - The user-event session to click with
   * @returns The open dialog element
   */
  const openDeleteDialog = async (user: UserEvent): Promise<HTMLElement> => {
    await screen.findByRole("heading", { level: 1, name: "Log in" });
    await user.click(screen.getByRole("button", { name: "Delete" }));
    return screen.findByRole("dialog", { name: `Delete ${singularLabel}?` });
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a spinner and placeholder breadcrumbs while the item loads", () => {
    const pendingWebsite = createDeferred<Response>();
    const pendingItem = createDeferred<Response>();
    stubFetchRoutes({
      [`GET ${WEBSITE_API_URL}`]: () => pendingWebsite.promise,
      [`GET ${itemApiUrl}`]: () => pendingItem.promise,
      ...buildPageLoadRoutes(itemApiUrl),
    });

    renderPage(openedFromWebsite);

    expect(screen.getByRole("progressbar", { name: `Loading ${singularLabel}` })).toBeInTheDocument();
    expect(readBreadcrumbTrail()).toEqual([
      { label: "Websites", href: LIST_PATH },
      { label: "Website", href: WEBSITE_PATH },
      { label: singularTitle, href: null },
    ]);
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("shows the server's not-found text and nothing else for an unknown item", async () => {
    stubLoadedItem({ [`GET ${itemApiUrl}`]: { status: 404, body: { error: notFoundText } } });

    renderPage(openedFromWebsite);

    expect(await screen.findByRole("alert")).toHaveTextContent(notFoundText);
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("shows the kind, title, description, timestamps, and named breadcrumbs", async () => {
    stubLoadedItem();

    renderPage(openedFromWebsite);

    expect(await screen.findByRole("heading", { level: 1, name: "Log in" })).toBeInTheDocument();
    expect(screen.getByText(singularTitle)).toBeInTheDocument();
    expect(screen.getByText("Sign in with a valid account")).toBeInTheDocument();
    expect(screen.getByText(/Created .+ · Updated .+/)).toBeInTheDocument();
    await waitFor(() => {
      expect(readBreadcrumbTrail()).toEqual([
        { label: "Websites", href: LIST_PATH },
        { label: "Example", href: WEBSITE_PATH },
        { label: "Log in", href: null },
      ]);
    });
  });

  it("still shows the item when only the website (used for the breadcrumb) fails", async () => {
    stubLoadedItem({
      [`GET ${WEBSITE_API_URL}`]: { status: 500, body: { error: "Database unavailable" } },
    });

    renderPage(openedFromWebsite);

    expect(await screen.findByRole("heading", { level: 1, name: "Log in" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(readBreadcrumbTrail()[1]).toEqual({ label: "Website", href: WEBSITE_PATH });
  });

  it("opens the edit form with this page as its return state", async () => {
    const user = userEvent.setup();
    stubLoadedItem();
    renderPage(openedFromWebsite);

    await user.click(await screen.findByRole("link", { name: "Edit" }));

    const landing = await readProbeAfterLanding(`${itemPath}/edit`);
    expect(landing.navigationType).toBe("PUSH");
    expect(landing.state).toBe(JSON.stringify({ returnTo: itemPath }));
  });

  it("names the item in the delete dialog", async () => {
    const user = userEvent.setup();
    stubLoadedItem();
    renderPage(openedFromWebsite);

    const dialog = await openDeleteDialog(user);

    expect(dialog).toHaveTextContent('"Log in" will be deleted.');
  });

  it("closes the delete dialog on Cancel without sending a request", async () => {
    const user = userEvent.setup();
    const fetchStub = stubLoadedItem();
    renderPage(openedFromWebsite);
    const dialog = await openDeleteDialog(user);

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(countRequests(fetchStub, "DELETE", itemApiUrl)).toBe(0);
  });

  it("keeps the dialog open with the server's reason when the delete fails", async () => {
    const user = userEvent.setup();
    stubLoadedItem({ [`DELETE ${itemApiUrl}`]: { status: 404, body: { error: notFoundText } } });
    renderPage(openedFromWebsite);
    const dialog = await openDeleteDialog(user);

    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(notFoundText);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByTestId("probe-pathname")).not.toBeInTheDocument();
  });

  it("disables the dialog's buttons while the delete is in flight", async () => {
    const user = userEvent.setup();
    const pendingDelete = createDeferred<Response>();
    stubLoadedItem({ [`DELETE ${itemApiUrl}`]: () => pendingDelete.promise });
    renderPage(openedFromWebsite);
    const dialog = await openDeleteDialog(user);

    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(within(dialog).getByRole("button", { name: "Delete" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();

    await act(async () => {
      pendingDelete.resolve(buildJsonResponse(204));
      await pendingDelete.promise;
    });
    await readProbeAfterLanding(WEBSITE_PATH);
  });

  it("sends DELETE and goes back to the website when the website opened the page", async () => {
    const user = userEvent.setup();
    const fetchStub = stubLoadedItem({ [`DELETE ${itemApiUrl}`]: { status: 204 } });
    renderPage(openedFromWebsite);
    const dialog = await openDeleteDialog(user);

    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    const landing = await readProbeAfterLanding(WEBSITE_PATH);
    expect(landing.navigationType).toBe("POP");
    expect(fetchStub).toHaveBeenCalledWith(itemApiUrl, { method: "DELETE" });

    await user.click(screen.getByRole("button", { name: "Probe: go back" }));
    await readProbeAfterLanding(LIST_PATH);
  });

  it("replaces the deleted item's page with the website after a deep link", async () => {
    const user = userEvent.setup();
    stubLoadedItem({ [`DELETE ${itemApiUrl}`]: { status: 204 } });
    renderPage(openedByDeepLink);
    const dialog = await openDeleteDialog(user);

    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    const landing = await readProbeAfterLanding(WEBSITE_PATH);
    expect(landing.navigationType).toBe("REPLACE");
  });
}
