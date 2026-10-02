import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, screen, waitFor, within, type RenderResult } from "@testing-library/react";
import { userEvent, type UserEvent } from "@testing-library/user-event";
import { Route } from "react-router-dom";
import WebsiteItemDetailPage from "../../src/pages/WebsiteItemDetailPage";
import { ACTION_KIND, USE_CASE_KIND } from "../../src/utils/websiteItemKinds";
import {
  ITEM_KIND_TEST_CASES,
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
const WEBSITE_PATH = "/websites/website-1";
const WEBSITE_API_URL = "/api/websites/website-1";

/**
 * Renders the item page on both of its real routes, keyed per kind exactly as
 * App.tsx declares them.
 * @param routerStart - The history stack to start from
 * @returns The Testing Library render result
 */
function renderWebsiteItemDetailPage(routerStart: RouterStart): RenderResult {
  return renderPageRoutes(
    <>
      <Route
        path="/websites/:websiteId/use-cases/:itemId"
        element={<WebsiteItemDetailPage key="use-case-detail" itemKind={USE_CASE_KIND} />}
      />
      <Route
        path="/websites/:websiteId/actions/:itemId"
        element={<WebsiteItemDetailPage key="action-detail" itemKind={ACTION_KIND} />}
      />
    </>,
    routerStart,
  );
}

describe.each(ITEM_KIND_TEST_CASES)(
  "WebsiteItemDetailPage ($segment)",
  ({ segment, singularLabel, singularTitle, notFoundText }) => {
    const itemPath = `${WEBSITE_PATH}/${segment}/item-1`;
    const itemApiUrl = `${WEBSITE_API_URL}/${segment}/item-1`;

    /** History as it is after clicking the item on the website's page. */
    const openedFromWebsite: RouterStart = {
      initialEntries: [
        LIST_PATH,
        WEBSITE_PATH,
        { pathname: itemPath, state: { returnTo: WEBSITE_PATH } },
      ],
    };

    /** History after opening the page directly (deep link or reload): no state. */
    const openedByDeepLink: RouterStart = { initialEntries: [itemPath] };

    /**
     * Stubs successful loads of the website and the item, plus any extra or
     * replacement routes.
     * @param extraRoutes - More replies, e.g. for the DELETE, or replacements for the GETs
     * @returns The installed fetch stub
     */
    const stubLoadedItem = (extraRoutes: StubbedRouteTable = {}): FetchStub =>
      stubFetchRoutes({
        [`GET ${WEBSITE_API_URL}`]: { status: 200, body: buildWebsiteRecord() },
        [`GET ${itemApiUrl}`]: { status: 200, body: buildWebsiteItemRecord() },
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
      });

      renderWebsiteItemDetailPage(openedFromWebsite);

      expect(
        screen.getByRole("progressbar", { name: `Loading ${singularLabel}` }),
      ).toBeInTheDocument();
      expect(readBreadcrumbTrail()).toEqual([
        { label: "Websites", href: LIST_PATH },
        { label: "Website", href: WEBSITE_PATH },
        { label: singularTitle, href: null },
      ]);
      expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    });

    it("shows the server's not-found text and nothing else for an unknown item", async () => {
      stubLoadedItem({ [`GET ${itemApiUrl}`]: { status: 404, body: { error: notFoundText } } });

      renderWebsiteItemDetailPage(openedFromWebsite);

      expect(await screen.findByRole("alert")).toHaveTextContent(notFoundText);
      expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    });

    it("shows the kind, title, description, timestamps, and named breadcrumbs", async () => {
      stubLoadedItem();

      renderWebsiteItemDetailPage(openedFromWebsite);

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

      renderWebsiteItemDetailPage(openedFromWebsite);

      expect(await screen.findByRole("heading", { level: 1, name: "Log in" })).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(readBreadcrumbTrail()[1]).toEqual({ label: "Website", href: WEBSITE_PATH });
    });

    it("opens the edit form with this page as its return state", async () => {
      const user = userEvent.setup();
      stubLoadedItem();
      renderWebsiteItemDetailPage(openedFromWebsite);

      await user.click(await screen.findByRole("link", { name: "Edit" }));

      const landing = await readProbeAfterLanding(`${itemPath}/edit`);
      expect(landing.navigationType).toBe("PUSH");
      expect(landing.state).toBe(JSON.stringify({ returnTo: itemPath }));
    });

    it("names the item in the delete dialog", async () => {
      const user = userEvent.setup();
      stubLoadedItem();
      renderWebsiteItemDetailPage(openedFromWebsite);

      const dialog = await openDeleteDialog(user);

      expect(dialog).toHaveTextContent('"Log in" will be deleted.');
    });

    it("closes the delete dialog on Cancel without sending a request", async () => {
      const user = userEvent.setup();
      const fetchStub = stubLoadedItem();
      renderWebsiteItemDetailPage(openedFromWebsite);
      const dialog = await openDeleteDialog(user);

      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });
      expect(countRequests(fetchStub, "DELETE", itemApiUrl)).toBe(0);
    });

    it("keeps the dialog open with the server's reason when the delete fails", async () => {
      const user = userEvent.setup();
      stubLoadedItem({
        [`DELETE ${itemApiUrl}`]: { status: 404, body: { error: notFoundText } },
      });
      renderWebsiteItemDetailPage(openedFromWebsite);
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
      renderWebsiteItemDetailPage(openedFromWebsite);
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
      renderWebsiteItemDetailPage(openedFromWebsite);
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
      renderWebsiteItemDetailPage(openedByDeepLink);
      const dialog = await openDeleteDialog(user);

      await user.click(within(dialog).getByRole("button", { name: "Delete" }));

      const landing = await readProbeAfterLanding(WEBSITE_PATH);
      expect(landing.navigationType).toBe("REPLACE");
    });
  },
);
