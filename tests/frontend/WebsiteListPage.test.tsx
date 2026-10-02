import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, within, type RenderResult } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { Route } from "react-router-dom";
import WebsiteListPage from "../../src/pages/WebsiteListPage";
import {
  buildWebsiteRecord,
  createDeferred,
  readBreadcrumbTrail,
  readProbeAfterLanding,
  renderPageRoutes,
  stubFetchRoutes,
} from "./support/frontendTestHelpers";

/**
 * Renders the website list on its real route (`/websites`).
 * @returns The Testing Library render result
 */
function renderWebsiteListPage(): RenderResult {
  return renderPageRoutes(<Route path="/websites" element={<WebsiteListPage />} />, {
    initialEntries: ["/websites"],
  });
}

describe("WebsiteListPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the heading, a plain-text breadcrumb, and a spinner while loading", () => {
    const pendingList = createDeferred<Response>();
    stubFetchRoutes({ "GET /api/websites": () => pendingList.promise });

    renderWebsiteListPage();

    expect(screen.getByRole("heading", { level: 1, name: "Websites" })).toBeInTheDocument();
    expect(readBreadcrumbTrail()).toEqual([{ label: "Websites", href: null }]);
    expect(screen.getByRole("progressbar", { name: "Loading websites" })).toBeInTheDocument();
  });

  it("shows the server's error text when the list fails to load", async () => {
    stubFetchRoutes({
      "GET /api/websites": { status: 500, body: { error: "Database unavailable" } },
    });

    renderWebsiteListPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Database unavailable");
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Websites" })).not.toBeInTheDocument();
  });

  it("shows the empty state when there are no websites", async () => {
    stubFetchRoutes({ "GET /api/websites": { status: 200, body: [] } });

    renderWebsiteListPage();

    expect(
      await screen.findByText("No websites yet. Add one to start describing what to test."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Websites" })).not.toBeInTheDocument();
  });

  it("lists every website, in the order the API returns them, as links to their pages", async () => {
    stubFetchRoutes({
      "GET /api/websites": {
        status: 200,
        body: [
          buildWebsiteRecord({ id: "website-2", name: "Newer", url: "https://newer.example" }),
          buildWebsiteRecord({ id: "website-1", name: "Older", url: "https://older.example" }),
        ],
      },
    });

    renderWebsiteListPage();

    const websiteList = await screen.findByRole("list", { name: "Websites" });
    const websiteLinks = within(websiteList).getAllByRole("link");
    expect(websiteLinks).toHaveLength(2);
    expect(websiteLinks[0]).toHaveTextContent("Newer");
    expect(websiteLinks[0]).toHaveTextContent("https://newer.example");
    expect(websiteLinks[0]).toHaveAttribute("href", "/websites/website-2");
    expect(websiteLinks[1]).toHaveTextContent("Older");
    expect(websiteLinks[1]).toHaveAttribute("href", "/websites/website-1");
    expect(
      screen.queryByText("No websites yet. Add one to start describing what to test."),
    ).not.toBeInTheDocument();
  });

  it("opens a website's page with the list as its return state", async () => {
    const user = userEvent.setup();
    stubFetchRoutes({ "GET /api/websites": { status: 200, body: [buildWebsiteRecord()] } });
    renderWebsiteListPage();

    await user.click(await screen.findByRole("link", { name: /Example/ }));

    const landing = await readProbeAfterLanding("/websites/website-1");
    expect(landing.navigationType).toBe("PUSH");
    expect(landing.state).toBe(JSON.stringify({ returnTo: "/websites" }));
  });

  it("opens the create form with the list as its return state", async () => {
    const user = userEvent.setup();
    stubFetchRoutes({ "GET /api/websites": { status: 200, body: [] } });
    renderWebsiteListPage();
    await screen.findByText("No websites yet. Add one to start describing what to test.");

    await user.click(screen.getByRole("link", { name: "New website" }));

    const landing = await readProbeAfterLanding("/websites/new");
    expect(landing.navigationType).toBe("PUSH");
    expect(landing.state).toBe(JSON.stringify({ returnTo: "/websites" }));
  });
});
