import { describe, it, expect } from "vitest";
import { screen, type RenderResult } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { Route } from "react-router-dom";
import AppHeader from "../../src/components/AppHeader";
import { readProbeAfterLanding, renderPageRoutes } from "./support/frontendTestHelpers";

/**
 * Renders the header on the route matching `currentPath`; every other url
 * lands on the location probe, so a navigation away from it can be read.
 * @param routePattern - The route that shows the header, e.g. "/websites/:websiteId"
 * @param currentPath - The url the router starts on
 * @returns The Testing Library render result
 */
function renderHeaderAt(routePattern: string, currentPath: string): RenderResult {
  return renderPageRoutes(<Route path={routePattern} element={<AppHeader />} />, {
    initialEntries: [currentPath],
  });
}

describe("AppHeader", () => {
  it("links the Easy Test name and the Websites link to the dashboard", () => {
    renderHeaderAt("/websites/:websiteId", "/websites/website-1");
    expect(screen.getByRole("link", { name: "Easy Test" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Websites" })).toHaveAttribute("href", "/");
  });

  it("marks Websites as the current page only while the dashboard is open", () => {
    const { unmount } = renderHeaderAt("/websites/:websiteId", "/websites/website-1");
    expect(screen.getByRole("link", { name: "Websites" })).not.toHaveAttribute("aria-current");
    unmount();

    renderHeaderAt("/", "/");
    expect(screen.getByRole("link", { name: "Websites" })).toHaveAttribute("aria-current", "page");
  });

  it("navigates to the dashboard when Websites is clicked", async () => {
    const user = userEvent.setup();
    renderHeaderAt("/websites/:websiteId", "/websites/website-1");

    await user.click(screen.getByRole("link", { name: "Websites" }));

    await readProbeAfterLanding("/");
  });

  it("navigates home when the Easy Test name is clicked", async () => {
    const user = userEvent.setup();
    renderHeaderAt("/websites/:websiteId", "/websites/website-1");

    await user.click(screen.getByRole("link", { name: "Easy Test" }));

    await readProbeAfterLanding("/");
  });
});
