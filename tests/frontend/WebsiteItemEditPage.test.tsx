import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor, type RenderResult } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { Route } from "react-router-dom";
import WebsiteItemEditPage from "../../src/pages/WebsiteItemEditPage";
import { ACTION_KIND, USE_CASE_KIND } from "../../src/utils/websiteItemKinds";
import {
  ITEM_KIND_TEST_CASES,
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
 * Renders the edit page on both of its real routes, keyed per kind exactly as
 * App.tsx declares them.
 * @param routerStart - The history stack to start from
 * @returns The Testing Library render result
 */
function renderWebsiteItemEditPage(routerStart: RouterStart): RenderResult {
  return renderPageRoutes(
    <>
      <Route
        path="/websites/:websiteId/use-cases/:itemId/edit"
        element={<WebsiteItemEditPage key="use-case-edit" itemKind={USE_CASE_KIND} />}
      />
      <Route
        path="/websites/:websiteId/actions/:itemId/edit"
        element={<WebsiteItemEditPage key="action-edit" itemKind={ACTION_KIND} />}
      />
    </>,
    routerStart,
  );
}

describe.each(ITEM_KIND_TEST_CASES)(
  "WebsiteItemEditPage ($segment)",
  ({ segment, singularLabel, singularTitle, notFoundText }) => {
    const itemPath = `${WEBSITE_PATH}/${segment}/item-1`;
    const editPath = `${itemPath}/edit`;
    const itemApiUrl = `${WEBSITE_API_URL}/${segment}/item-1`;

    /** History as it is after clicking Edit on the item's page. */
    const openedFromItem: RouterStart = {
      initialEntries: [
        WEBSITE_PATH,
        { pathname: itemPath, state: { returnTo: WEBSITE_PATH } },
        { pathname: editPath, state: { returnTo: itemPath } },
      ],
    };

    /** History after opening the form directly (deep link or reload): no state. */
    const openedByDeepLink: RouterStart = { initialEntries: [WEBSITE_PATH, editPath] };

    /**
     * Stubs successful loads of the website and the item, plus any extra or
     * replacement routes.
     * @param extraRoutes - More replies, e.g. for the PUT, or replacements for the GETs
     * @returns The installed fetch stub
     */
    const stubLoadedItem = (extraRoutes: StubbedRouteTable = {}): FetchStub =>
      stubFetchRoutes({
        [`GET ${WEBSITE_API_URL}`]: { status: 200, body: buildWebsiteRecord() },
        [`GET ${itemApiUrl}`]: { status: 200, body: buildWebsiteItemRecord() },
        ...extraRoutes,
      });

    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("shows the heading, a spinner, placeholder breadcrumbs, and no form while the item loads", () => {
      const pendingWebsite = createDeferred<Response>();
      const pendingItem = createDeferred<Response>();
      stubFetchRoutes({
        [`GET ${WEBSITE_API_URL}`]: () => pendingWebsite.promise,
        [`GET ${itemApiUrl}`]: () => pendingItem.promise,
      });

      renderWebsiteItemEditPage(openedFromItem);

      expect(
        screen.getByRole("heading", { level: 1, name: `Edit ${singularLabel}` }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("progressbar", { name: `Loading ${singularLabel}` }),
      ).toBeInTheDocument();
      expect(readBreadcrumbTrail()).toEqual([
        { label: "Websites", href: LIST_PATH },
        { label: "Website", href: WEBSITE_PATH },
        { label: singularTitle, href: itemPath },
        { label: "Edit", href: null },
      ]);
      expect(screen.queryByRole("textbox", { name: "Title" })).not.toBeInTheDocument();
    });

    it("shows the server's not-found text and no form for an unknown item", async () => {
      stubLoadedItem({ [`GET ${itemApiUrl}`]: { status: 404, body: { error: notFoundText } } });

      renderWebsiteItemEditPage(openedFromItem);

      expect(await screen.findByRole("alert")).toHaveTextContent(notFoundText);
      expect(screen.queryByRole("textbox", { name: "Title" })).not.toBeInTheDocument();
    });

    it("pre-fills the form with the saved item and names both records in the breadcrumbs", async () => {
      stubLoadedItem();

      renderWebsiteItemEditPage(openedFromItem);

      expect(await screen.findByRole("textbox", { name: "Title" })).toHaveValue("Log in");
      expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue(
        "Sign in with a valid account",
      );
      expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
      await waitFor(() => {
        expect(readBreadcrumbTrail()).toEqual([
          { label: "Websites", href: LIST_PATH },
          { label: "Example", href: WEBSITE_PATH },
          { label: "Log in", href: itemPath },
          { label: "Edit", href: null },
        ]);
      });
    });

    it("disables Save while the title is cleared to whitespace", async () => {
      const user = userEvent.setup();
      stubLoadedItem();
      renderWebsiteItemEditPage(openedFromItem);

      const titleField = await screen.findByRole("textbox", { name: "Title" });
      await user.clear(titleField);
      await user.type(titleField, "  ");

      expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    });

    it("PUTs the edited values and goes back to the item's page when it opened the form", async () => {
      const user = userEvent.setup();
      const fetchStub = stubLoadedItem({
        [`PUT ${itemApiUrl}`]: { status: 200, body: buildWebsiteItemRecord({ title: "Sign in" }) },
      });
      renderWebsiteItemEditPage(openedFromItem);

      const titleField = await screen.findByRole("textbox", { name: "Title" });
      await user.clear(titleField);
      await user.type(titleField, "Sign in");
      await user.click(screen.getByRole("button", { name: "Save changes" }));

      const landing = await readProbeAfterLanding(itemPath);
      expect(landing.navigationType).toBe("POP");
      expect(fetchStub).toHaveBeenCalledWith(itemApiUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Sign in", description: "Sign in with a valid account" }),
      });

      // History is [website, item], not [website, item, item].
      await user.click(screen.getByRole("button", { name: "Probe: go back" }));
      await readProbeAfterLanding(WEBSITE_PATH);
    });

    it("replaces the form with the item's page on Save after a deep link", async () => {
      const user = userEvent.setup();
      stubLoadedItem({ [`PUT ${itemApiUrl}`]: { status: 200, body: buildWebsiteItemRecord() } });
      renderWebsiteItemEditPage(openedByDeepLink);

      await user.click(await screen.findByRole("button", { name: "Save changes" }));

      const landing = await readProbeAfterLanding(itemPath);
      expect(landing.navigationType).toBe("REPLACE");

      await user.click(screen.getByRole("button", { name: "Probe: go back" }));
      await readProbeAfterLanding(WEBSITE_PATH);
    });

    it("shows the server's error and stays on the form when the save is rejected", async () => {
      const user = userEvent.setup();
      stubLoadedItem({ [`PUT ${itemApiUrl}`]: { status: 404, body: { error: notFoundText } } });
      renderWebsiteItemEditPage(openedFromItem);

      await user.click(await screen.findByRole("button", { name: "Save changes" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(notFoundText);
      expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue("Log in");
      expect(screen.queryByTestId("probe-pathname")).not.toBeInTheDocument();
    });

    it("goes back to the item's page on Cancel without saving, when it opened the form", async () => {
      const user = userEvent.setup();
      const fetchStub = stubLoadedItem();
      renderWebsiteItemEditPage(openedFromItem);

      await user.click(await screen.findByRole("button", { name: "Cancel" }));

      const landing = await readProbeAfterLanding(itemPath);
      expect(landing.navigationType).toBe("POP");
      expect(countRequests(fetchStub, "PUT", itemApiUrl)).toBe(0);
    });

    it("replaces the form with the item's page on Cancel after a deep link", async () => {
      const user = userEvent.setup();
      stubLoadedItem();
      renderWebsiteItemEditPage(openedByDeepLink);

      await user.click(await screen.findByRole("button", { name: "Cancel" }));

      const landing = await readProbeAfterLanding(itemPath);
      expect(landing.navigationType).toBe("REPLACE");
    });
  },
);
