import { describe, it, expect } from "vitest";
import { screen, type RenderResult } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { Route } from "react-router-dom";
import AppHeader from "../../src/components/AppHeader";
import { readProbeAfterLanding, renderPageRoutes } from "./support/frontendTestHelpers";

/**
 * Renders the header on a websites page whose route also shows the header, so
 * any navigation away from it lands on the location probe.
 * @param currentPath - The url the router starts on
 * @returns The Testing Library render result
 */
function renderHeaderAt(currentPath: string): RenderResult {
  return renderPageRoutes(<Route path="/websites/:websiteId" element={<AppHeader />} />, {
    initialEntries: [currentPath],
  });
}

describe("AppHeader", () => {
  it("links the app name home and the Websites button to the list", () => {
    renderHeaderAt("/websites/website-1");
    expect(screen.getByRole("link", { name: "easy-test" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Websites" })).toHaveAttribute("href", "/websites");
  });

  it("navigates to the website list when Websites is clicked", async () => {
    const user = userEvent.setup();
    renderHeaderAt("/websites/website-1");

    await user.click(screen.getByRole("link", { name: "Websites" }));

    await readProbeAfterLanding("/websites");
  });

  it("navigates home when the app name is clicked", async () => {
    const user = userEvent.setup();
    renderHeaderAt("/websites/website-1");

    await user.click(screen.getByRole("link", { name: "easy-test" }));

    await readProbeAfterLanding("/");
  });
});
