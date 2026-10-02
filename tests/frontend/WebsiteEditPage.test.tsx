import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, type RenderResult } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { Route } from "react-router-dom";
import WebsiteEditPage from "../../src/pages/WebsiteEditPage";
import {
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
const EDIT_PATH = "/websites/website-1/edit";
const WEBSITE_API_URL = "/api/websites/website-1";

/** History as it is after clicking Edit on the website's page (opened from the list). */
const OPENED_FROM_DETAIL: RouterStart = {
  initialEntries: [
    LIST_PATH,
    { pathname: DETAIL_PATH, state: { returnTo: LIST_PATH } },
    { pathname: EDIT_PATH, state: { returnTo: DETAIL_PATH } },
  ],
};

/** History after opening the form directly (deep link or reload): no state. */
const OPENED_BY_DEEP_LINK: RouterStart = { initialEntries: [LIST_PATH, EDIT_PATH] };

/**
 * Renders the edit page on its real route (`/websites/:websiteId/edit`).
 * @param routerStart - The history stack to start from
 * @returns The Testing Library render result
 */
function renderWebsiteEditPage(routerStart: RouterStart): RenderResult {
  return renderPageRoutes(
    <Route path="/websites/:websiteId/edit" element={<WebsiteEditPage />} />,
    routerStart,
  );
}

/**
 * Stubs a successful load of the website being edited, plus any extra routes.
 * @param extraRoutes - More replies, e.g. for the PUT
 * @returns The installed fetch stub
 */
function stubLoadedWebsite(extraRoutes: StubbedRouteTable = {}): FetchStub {
  return stubFetchRoutes({
    [`GET ${WEBSITE_API_URL}`]: { status: 200, body: buildWebsiteRecord() },
    ...extraRoutes,
  });
}

describe("WebsiteEditPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a spinner, a placeholder breadcrumb, and no form while the website loads", () => {
    const pendingWebsite = createDeferred<Response>();
    stubFetchRoutes({ [`GET ${WEBSITE_API_URL}`]: () => pendingWebsite.promise });

    renderWebsiteEditPage(OPENED_FROM_DETAIL);

    expect(screen.getByRole("heading", { level: 1, name: "Edit website" })).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Loading website" })).toBeInTheDocument();
    expect(readBreadcrumbTrail()).toEqual([
      { label: "Websites", href: LIST_PATH },
      { label: "Website", href: DETAIL_PATH },
      { label: "Edit", href: null },
    ]);
    expect(screen.queryByRole("textbox", { name: "URL" })).not.toBeInTheDocument();
  });

  it("shows the server's not-found text and no form for an unknown website", async () => {
    stubFetchRoutes({
      [`GET ${WEBSITE_API_URL}`]: { status: 404, body: { error: "Website not found" } },
    });

    renderWebsiteEditPage(OPENED_FROM_DETAIL);

    expect(await screen.findByRole("alert")).toHaveTextContent("Website not found");
    expect(screen.queryByRole("textbox", { name: "URL" })).not.toBeInTheDocument();
  });

  it("pre-fills the form with the saved website and names it in the breadcrumbs", async () => {
    stubLoadedWebsite();

    renderWebsiteEditPage(OPENED_FROM_DETAIL);

    expect(await screen.findByRole("textbox", { name: "URL" })).toHaveValue("https://example.com");
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Example");
    expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue("The example site");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
    expect(readBreadcrumbTrail()).toEqual([
      { label: "Websites", href: LIST_PATH },
      { label: "Example", href: DETAIL_PATH },
      { label: "Edit", href: null },
    ]);
  });

  it("pre-fills a blank description when the saved website has none", async () => {
    stubFetchRoutes({
      [`GET ${WEBSITE_API_URL}`]: { status: 200, body: buildWebsiteRecord({ description: null }) },
    });

    renderWebsiteEditPage(OPENED_FROM_DETAIL);

    expect(await screen.findByRole("textbox", { name: "Description" })).toHaveValue("");
  });

  it("disables Save while the name is cleared to whitespace", async () => {
    const user = userEvent.setup();
    stubLoadedWebsite();
    renderWebsiteEditPage(OPENED_FROM_DETAIL);

    const nameField = await screen.findByRole("textbox", { name: "Name" });
    await user.clear(nameField);
    await user.type(nameField, "   ");

    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  it("PUTs the edited values and goes back to the website's page when it opened the form", async () => {
    const user = userEvent.setup();
    const fetchStub = stubLoadedWebsite({
      [`PUT ${WEBSITE_API_URL}`]: { status: 200, body: buildWebsiteRecord({ name: "Renamed" }) },
    });
    renderWebsiteEditPage(OPENED_FROM_DETAIL);

    const nameField = await screen.findByRole("textbox", { name: "Name" });
    await user.clear(nameField);
    await user.type(nameField, "Renamed");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    const landing = await readProbeAfterLanding(DETAIL_PATH);
    expect(landing.navigationType).toBe("POP");
    expect(fetchStub).toHaveBeenCalledWith(WEBSITE_API_URL, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: "https://example.com",
        name: "Renamed",
        description: "The example site",
      }),
    });

    // History is [list, detail], not [list, detail, detail].
    await user.click(screen.getByRole("button", { name: "Probe: go back" }));
    await readProbeAfterLanding(LIST_PATH);
  });

  it("replaces the form with the website's page on Save after a deep link", async () => {
    const user = userEvent.setup();
    stubLoadedWebsite({ [`PUT ${WEBSITE_API_URL}`]: { status: 200, body: buildWebsiteRecord() } });
    renderWebsiteEditPage(OPENED_BY_DEEP_LINK);

    await user.click(await screen.findByRole("button", { name: "Save changes" }));

    const landing = await readProbeAfterLanding(DETAIL_PATH);
    expect(landing.navigationType).toBe("REPLACE");

    await user.click(screen.getByRole("button", { name: "Probe: go back" }));
    await readProbeAfterLanding(LIST_PATH);
  });

  it("shows the server's error and stays on the form when the save is rejected", async () => {
    const user = userEvent.setup();
    stubLoadedWebsite({
      [`PUT ${WEBSITE_API_URL}`]: { status: 400, body: { error: "url must be a valid http(s) URL" } },
    });
    renderWebsiteEditPage(OPENED_FROM_DETAIL);

    const urlField = await screen.findByRole("textbox", { name: "URL" });
    await user.clear(urlField);
    await user.type(urlField, "not a url");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("url must be a valid http(s) URL");
    expect(screen.getByRole("textbox", { name: "URL" })).toHaveValue("not a url");
    expect(screen.queryByTestId("probe-pathname")).not.toBeInTheDocument();
  });

  it("goes back to the website's page on Cancel without saving, when it opened the form", async () => {
    const user = userEvent.setup();
    const fetchStub = stubLoadedWebsite();
    renderWebsiteEditPage(OPENED_FROM_DETAIL);

    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    const landing = await readProbeAfterLanding(DETAIL_PATH);
    expect(landing.navigationType).toBe("POP");
    expect(countRequests(fetchStub, "PUT", WEBSITE_API_URL)).toBe(0);
  });

  it("replaces the form with the website's page on Cancel after a deep link", async () => {
    const user = userEvent.setup();
    stubLoadedWebsite();
    renderWebsiteEditPage(OPENED_BY_DEEP_LINK);

    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    const landing = await readProbeAfterLanding(DETAIL_PATH);
    expect(landing.navigationType).toBe("REPLACE");
  });
});
