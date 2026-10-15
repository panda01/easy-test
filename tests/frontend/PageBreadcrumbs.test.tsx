import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { Route } from "react-router-dom";
import PageBreadcrumbs from "../../src/components/PageBreadcrumbs";
import {
  readBreadcrumbTrail,
  readProbeAfterLanding,
  renderPageRoutes,
  stubWindowWidth,
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

describe("PageBreadcrumbs on a phone", () => {
  let removeWidthStub: (() => void) | null = null;

  beforeEach(() => {
    removeWidthStub = stubWindowWidth(390);
  });

  afterEach(() => {
    removeWidthStub?.();
    removeWidthStub = null;
  });

  it("shrinks to one back link to the level above", async () => {
    const user = userEvent.setup();
    renderPageRoutes(
      <Route
        path="/websites/:websiteId/actions/:itemId"
        element={
          <PageBreadcrumbs
            crumbs={[
              { label: "Websites", to: "/" },
              { label: "Example", to: "/websites/website-1" },
              { label: "Log in" },
            ]}
          />
        }
      />,
      { initialEntries: ["/websites/website-1/actions/item-1"] },
    );

    const breadcrumbNav = screen.getByRole("navigation", { name: "Breadcrumb" });
    const links = within(breadcrumbNav).getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveTextContent("Example");
    expect(screen.queryByText("Log in")).not.toBeInTheDocument();

    await user.click(links[0]);
    await readProbeAfterLanding("/websites/website-1");
  });

  it("shows nothing when no crumb links anywhere", () => {
    const { container } = renderPageRoutes(
      <Route path="/" element={<PageBreadcrumbs crumbs={[{ label: "Websites" }]} />} />,
      { initialEntries: ["/"] },
    );

    expect(container).toBeEmptyDOMElement();
  });
});
