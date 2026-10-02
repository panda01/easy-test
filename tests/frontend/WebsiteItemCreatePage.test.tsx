import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, screen, type RenderResult } from "@testing-library/react";
import { userEvent, type UserEvent } from "@testing-library/user-event";
import { Route } from "react-router-dom";
import WebsiteItemCreatePage from "../../src/pages/WebsiteItemCreatePage";
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
 * Renders the create page on both of its real routes, keyed per kind exactly
 * as App.tsx declares them.
 * @param routerStart - The history stack to start from
 * @returns The Testing Library render result
 */
function renderWebsiteItemCreatePage(routerStart: RouterStart): RenderResult {
  return renderPageRoutes(
    <>
      <Route
        path="/websites/:websiteId/use-cases/new"
        element={<WebsiteItemCreatePage key="use-case-create" itemKind={USE_CASE_KIND} />}
      />
      <Route
        path="/websites/:websiteId/actions/new"
        element={<WebsiteItemCreatePage key="action-create" itemKind={ACTION_KIND} />}
      />
    </>,
    routerStart,
  );
}

/**
 * Stubs a successful load of the owning website, plus any extra routes.
 * @param extraRoutes - More replies, e.g. for the POST
 * @returns The installed fetch stub
 */
function stubLoadedWebsite(extraRoutes: StubbedRouteTable = {}): FetchStub {
  return stubFetchRoutes({
    [`GET ${WEBSITE_API_URL}`]: { status: 200, body: buildWebsiteRecord() },
    ...extraRoutes,
  });
}

/**
 * Waits for the form, then types a title and a description into it.
 * @param user - The user-event session to type with
 * @returns Resolves once both fields are filled
 */
async function fillForm(user: UserEvent): Promise<void> {
  await user.type(await screen.findByRole("textbox", { name: "Title" }), "Log in");
  await user.type(screen.getByRole("textbox", { name: "Description" }), "Sign in");
}

describe.each(ITEM_KIND_TEST_CASES)(
  "WebsiteItemCreatePage ($segment)",
  ({ segment, singularLabel }) => {
    const createPath = `${WEBSITE_PATH}/${segment}/new`;
    const itemsApiUrl = `${WEBSITE_API_URL}/${segment}`;
    const submitLabel = `Create ${singularLabel}`;

    /** History as it is after clicking "New ..." on the website's page. */
    const openedFromWebsite: RouterStart = {
      initialEntries: [
        LIST_PATH,
        WEBSITE_PATH,
        { pathname: createPath, state: { returnTo: WEBSITE_PATH } },
      ],
    };

    /** History after opening the form directly (deep link or reload): no state. */
    const openedByDeepLink: RouterStart = { initialEntries: [LIST_PATH, createPath] };

    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("shows the heading, a spinner, placeholder breadcrumbs, and no form while the website loads", () => {
      const pendingWebsite = createDeferred<Response>();
      stubFetchRoutes({ [`GET ${WEBSITE_API_URL}`]: () => pendingWebsite.promise });

      renderWebsiteItemCreatePage(openedFromWebsite);

      expect(
        screen.getByRole("heading", { level: 1, name: `New ${singularLabel}` }),
      ).toBeInTheDocument();
      expect(screen.getByRole("progressbar", { name: "Loading website" })).toBeInTheDocument();
      expect(readBreadcrumbTrail()).toEqual([
        { label: "Websites", href: LIST_PATH },
        { label: "Website", href: WEBSITE_PATH },
        { label: `New ${singularLabel}`, href: null },
      ]);
      expect(screen.queryByRole("textbox", { name: "Title" })).not.toBeInTheDocument();
    });

    it("shows the server's not-found text and no form for an unknown website", async () => {
      stubFetchRoutes({
        [`GET ${WEBSITE_API_URL}`]: { status: 404, body: { error: "Website not found" } },
      });

      renderWebsiteItemCreatePage(openedFromWebsite);

      expect(await screen.findByRole("alert")).toHaveTextContent("Website not found");
      expect(screen.queryByRole("textbox", { name: "Title" })).not.toBeInTheDocument();
    });

    it("shows a blank form with submit disabled, and the website's name in the breadcrumbs", async () => {
      stubLoadedWebsite();

      renderWebsiteItemCreatePage(openedFromWebsite);

      expect(await screen.findByRole("textbox", { name: "Title" })).toHaveValue("");
      expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue("");
      expect(screen.getByRole("button", { name: submitLabel })).toBeDisabled();
      expect(readBreadcrumbTrail()).toEqual([
        { label: "Websites", href: LIST_PATH },
        { label: "Example", href: WEBSITE_PATH },
        { label: `New ${singularLabel}`, href: null },
      ]);
    });

    it("keeps submit disabled while the description is whitespace-only", async () => {
      const user = userEvent.setup();
      stubLoadedWebsite();
      renderWebsiteItemCreatePage(openedFromWebsite);

      await user.type(await screen.findByRole("textbox", { name: "Title" }), "Log in");
      await user.type(screen.getByRole("textbox", { name: "Description" }), "   ");

      expect(screen.getByRole("button", { name: submitLabel })).toBeDisabled();
    });

    it("POSTs the form and replaces it with the new item's page, keeping the return state", async () => {
      const user = userEvent.setup();
      const fetchStub = stubLoadedWebsite({
        [`POST ${itemsApiUrl}`]: { status: 201, body: buildWebsiteItemRecord({ id: "item-9" }) },
      });
      renderWebsiteItemCreatePage(openedFromWebsite);

      await fillForm(user);
      await user.click(screen.getByRole("button", { name: submitLabel }));

      const landing = await readProbeAfterLanding(`${WEBSITE_PATH}/${segment}/item-9`);
      expect(landing.navigationType).toBe("REPLACE");
      expect(landing.state).toBe(JSON.stringify({ returnTo: WEBSITE_PATH }));
      expect(fetchStub).toHaveBeenCalledWith(itemsApiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Log in", description: "Sign in" }),
      });

      // The form's entry is gone, so Back goes straight to the website.
      await user.click(screen.getByRole("button", { name: "Probe: go back" }));
      await readProbeAfterLanding(WEBSITE_PATH);
    });

    it("disables submit while the create request is in flight", async () => {
      const user = userEvent.setup();
      const pendingCreate = createDeferred<Response>();
      stubLoadedWebsite({ [`POST ${itemsApiUrl}`]: () => pendingCreate.promise });
      renderWebsiteItemCreatePage(openedFromWebsite);

      await fillForm(user);
      await user.click(screen.getByRole("button", { name: submitLabel }));
      expect(screen.getByRole("button", { name: submitLabel })).toBeDisabled();

      await act(async () => {
        pendingCreate.resolve(buildJsonResponse(201, buildWebsiteItemRecord({ id: "item-9" })));
        await pendingCreate.promise;
      });
      await readProbeAfterLanding(`${WEBSITE_PATH}/${segment}/item-9`);
    });

    it("shows the server's error and stays on the form when the create is rejected", async () => {
      const user = userEvent.setup();
      const fetchStub = stubLoadedWebsite({
        [`POST ${itemsApiUrl}`]: { status: 400, body: { error: "title is required" } },
      });
      renderWebsiteItemCreatePage(openedFromWebsite);

      await fillForm(user);
      await user.click(screen.getByRole("button", { name: submitLabel }));

      expect(await screen.findByRole("alert")).toHaveTextContent("title is required");
      expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue("Log in");
      expect(screen.queryByTestId("probe-pathname")).not.toBeInTheDocument();
      expect(countRequests(fetchStub, "POST", itemsApiUrl)).toBe(1);
    });

    it("goes back to the website on Cancel when the website opened the form", async () => {
      const user = userEvent.setup();
      const fetchStub = stubLoadedWebsite();
      renderWebsiteItemCreatePage(openedFromWebsite);

      await user.click(await screen.findByRole("button", { name: "Cancel" }));

      const landing = await readProbeAfterLanding(WEBSITE_PATH);
      expect(landing.navigationType).toBe("POP");
      expect(countRequests(fetchStub, "POST", itemsApiUrl)).toBe(0);
    });

    it("replaces the form with the website on Cancel after a deep link", async () => {
      const user = userEvent.setup();
      stubLoadedWebsite();
      renderWebsiteItemCreatePage(openedByDeepLink);

      await user.click(await screen.findByRole("button", { name: "Cancel" }));

      const landing = await readProbeAfterLanding(WEBSITE_PATH);
      expect(landing.navigationType).toBe("REPLACE");

      await user.click(screen.getByRole("button", { name: "Probe: go back" }));
      await readProbeAfterLanding(LIST_PATH);
    });
  },
);
