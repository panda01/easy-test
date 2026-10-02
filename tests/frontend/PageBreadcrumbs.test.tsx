import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { Route } from "react-router-dom";
import PageBreadcrumbs from "../../src/components/PageBreadcrumbs";
import {
  readBreadcrumbTrail,
  readProbeAfterLanding,
  renderPageRoutes,
} from "./support/frontendTestHelpers";

describe("PageBreadcrumbs", () => {
  it("renders linked crumbs and a plain-text last crumb, in order", () => {
    renderPageRoutes(
      <Route
        path="/websites/:websiteId/edit"
        element={
          <PageBreadcrumbs
            crumbs={[
              { label: "Websites", to: "/websites" },
              { label: "Example", to: "/websites/website-1" },
              { label: "Edit" },
            ]}
          />
        }
      />,
      { initialEntries: ["/websites/website-1/edit"] },
    );

    expect(readBreadcrumbTrail()).toEqual([
      { label: "Websites", href: "/websites" },
      { label: "Example", href: "/websites/website-1" },
      { label: "Edit", href: null },
    ]);
  });

  it("keeps crumbs with the same label apart", () => {
    renderPageRoutes(
      <Route
        path="/websites"
        element={
          <PageBreadcrumbs
            crumbs={[{ label: "Same", to: "/websites" }, { label: "Same" }]}
          />
        }
      />,
      { initialEntries: ["/websites"] },
    );

    expect(readBreadcrumbTrail()).toEqual([
      { label: "Same", href: "/websites" },
      { label: "Same", href: null },
    ]);
  });

  it("navigates when a linked crumb is clicked", async () => {
    const user = userEvent.setup();
    renderPageRoutes(
      <Route
        path="/websites/:websiteId"
        element={<PageBreadcrumbs crumbs={[{ label: "Websites", to: "/websites" }, { label: "Example" }]} />}
      />,
      { initialEntries: ["/websites/website-1"] },
    );

    await user.click(screen.getByRole("link", { name: "Websites" }));

    const landing = await readProbeAfterLanding("/websites");
    expect(landing.navigationType).toBe("PUSH");
  });
});
