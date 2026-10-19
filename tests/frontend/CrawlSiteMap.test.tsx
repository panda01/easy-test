import { describe, it, expect, vi } from "vitest";
import { render, screen, within, type RenderResult } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import CrawlSiteMap, { type CrawlSiteMapProps } from "../../src/components/CrawlSiteMap";
import { statusColors } from "../../src/theme/nocturneTheme";
import {
  buildCrawledPageSummaryRecord,
  buildCrawlPageGroupingWebObjectRecord,
} from "./support/frontendTestHelpers";

const homePage = buildCrawledPageSummaryRecord({
  id: "home",
  url: "https://example.com/",
  title: "Home",
});
const aboutPage = buildCrawledPageSummaryRecord({
  id: "about",
  parentPageId: "home",
  url: "https://example.com/about",
  title: null,
  visitOrder: 1,
  depth: 1,
});
const blogPage = buildCrawledPageSummaryRecord({
  id: "blog",
  parentPageId: "home",
  url: "https://example.com/blog",
  title: "Blog",
  visitOrder: 2,
  depth: 1,
});
const missingPage = buildCrawledPageSummaryRecord({
  id: "missing",
  parentPageId: "about",
  url: "https://example.com/about/missing",
  succeeded: false,
  httpStatus: 404,
  title: null,
  visitOrder: 3,
  depth: 2,
});

/**
 * Renders the site map with sensible defaults, overridden per test.
 * @param overrides - Props to replace
 * @returns The Testing Library render result
 */
function renderSiteMap(overrides: Partial<CrawlSiteMapProps> = {}): RenderResult {
  const props: CrawlSiteMapProps = {
    pages: [homePage, aboutPage, blogPage, missingPage],
    selectedPageId: null,
    onSelectPage: vi.fn(),
    isPhoneLayout: false,
    ...overrides,
  };
  return render(<CrawlSiteMap {...props} />);
}

describe("CrawlSiteMap", () => {
  it("lists the pages as a tree in reading order: each page followed by the pages found on it", () => {
    renderSiteMap();

    const siteMap = screen.getByRole("list", { name: "Site map" });
    const rows = within(siteMap).getAllByRole("button");
    expect(rows.map((row) => row.textContent)).toEqual([
      "/",
      "/about",
      "/about/missingHTTP 404",
      "/blog",
    ]);
  });

  it("puts a green dot before a page that loaded and a red one before a page that failed", () => {
    renderSiteMap();

    const homeDot = screen.getByRole("button", { name: "/" }).querySelector('[aria-hidden="true"]');
    const missingDot = screen
      .getByRole("button", { name: /^\/about\/missing/ })
      .querySelector('[aria-hidden="true"]');
    expect(homeDot).toHaveStyle({ backgroundColor: statusColors.passed });
    expect(missingDot).toHaveStyle({ backgroundColor: statusColors.failed });
  });

  it("notes a redirect: where a page recorded where it landed was requested, or where one recorded where it was requested landed", () => {
    const calendarPage = buildCrawledPageSummaryRecord({
      id: "calendar",
      url: "https://example.com/calendar",
      requestedUrl: "https://example.com/",
      finalUrl: "https://example.com/calendar",
      wasRedirected: true,
    });
    const oldAccountPage = buildCrawledPageSummaryRecord({
      id: "old-account",
      parentPageId: "calendar",
      url: "https://example.com/old-account",
      requestedUrl: "https://example.com/old-account",
      finalUrl: "https://example.com/account",
      wasRedirected: true,
      visitOrder: 1,
      depth: 1,
    });
    renderSiteMap({ pages: [calendarPage, oldAccountPage] });

    expect(screen.getByRole("button", { name: /^\/calendar/ })).toHaveTextContent("/calendarfrom /");
    expect(screen.getByRole("button", { name: /^\/old-account/ })).toHaveTextContent(
      "/old-account→ /account",
    );
  });

  it("notes a failed page that never answered", () => {
    const unreachablePage = buildCrawledPageSummaryRecord({
      id: "unreachable",
      url: "https://example.com/down",
      succeeded: false,
      httpStatus: null,
    });
    renderSiteMap({ pages: [unreachablePage] });

    expect(screen.getByRole("button", { name: /^\/down/ })).toHaveTextContent("/downNo response");
  });

  it("names the button that led to a page found by a click", () => {
    const yogaPage = buildCrawledPageSummaryRecord({
      id: "yoga",
      parentPageId: "blog",
      url: "https://example.com/sessions/yoga",
      foundByButtonText: "Open Yoga",
      title: "Yoga",
      visitOrder: 4,
      depth: 2,
    });
    renderSiteMap({ pages: [homePage, blogPage, yogaPage] });

    expect(screen.getByRole("button", { name: /^\/sessions\/yoga/ })).toHaveTextContent(
      "/sessions/yogavia “Open Yoga”",
    );
    expect(screen.getByRole("button", { name: /^\/blog/ })).not.toHaveTextContent("via");
  });

  it("indents each row by its depth in the tree", () => {
    renderSiteMap();

    const siteMap = screen.getByRole("list", { name: "Site map" });
    const [homeRow, aboutRow, missingRow] = within(siteMap).getAllByRole("button");
    const homeIndent = Number.parseFloat(getComputedStyle(homeRow).paddingLeft);
    const aboutIndent = Number.parseFloat(getComputedStyle(aboutRow).paddingLeft);
    const missingIndent = Number.parseFloat(getComputedStyle(missingRow).paddingLeft);
    expect(aboutIndent).toBeGreaterThan(homeIndent);
    expect(missingIndent).toBeGreaterThan(aboutIndent);
  });

  it("marks the selected page", () => {
    renderSiteMap({ selectedPageId: "blog" });

    expect(screen.getByRole("button", { name: /^\/blog/ })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: "/about" })).not.toHaveAttribute("aria-current");
  });

  it("calls onSelectPage with the picked page's id", async () => {
    const user = userEvent.setup();
    const onSelectPage = vi.fn();
    renderSiteMap({ onSelectPage });

    await user.click(screen.getByRole("button", { name: /^\/about\/missing/ }));

    expect(onSelectPage).toHaveBeenCalledWith("missing");
  });

  it("says so when the crawl has no pages yet", () => {
    renderSiteMap({ pages: [] });

    expect(screen.getByText("No pages yet.")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("draws taller rows straight on the page ground in the phone layout, and a panel on desktop", () => {
    const { container, unmount } = renderSiteMap({ isPhoneLayout: true });

    const phoneRows = within(screen.getByRole("list", { name: "Site map" })).getAllByRole("button");
    expect(phoneRows[0]).toHaveStyle({ minHeight: "44px" });
    expect(container.querySelector("section")).not.toHaveStyle({ padding: "10px" });
    unmount();

    renderSiteMap({ isPhoneLayout: false });
    const desktopRows = within(screen.getByRole("list", { name: "Site map" })).getAllByRole("button");
    expect(desktopRows[0]).toHaveStyle({ minHeight: "34px" });
    expect(screen.getByRole("list", { name: "Site map" })).toHaveStyle({ maxHeight: "640px" });
  });

  it("draws only the tree, with no view switch, when no Objects view is given", () => {
    renderSiteMap();

    expect(screen.queryByRole("group", { name: "Site map view" })).not.toBeInTheDocument();
  });
});

describe("CrawlSiteMap with its Objects view", () => {
  const blogObject = buildCrawlPageGroupingWebObjectRecord({
    instancePatternKey: "/blog/{blog}",
    displayName: "Blog post",
    detectedName: "Blog",
    patterns: [{ key: "/blog/{blog}", role: "instance", viewName: null, detectedBy: "siblingStructure", pageIds: ["blog"] }],
  });

  /**
   * Renders the site map with its Objects view in the given view.
   * @param siteMapView - Which view is shown
   * @param overrides - Props to replace
   * @returns The Testing Library render result and the view change handler
   */
  function renderSiteMapWithObjects(
    siteMapView: "tree" | "objects",
    overrides: Partial<CrawlSiteMapProps> = {},
  ): { onSiteMapViewChange: ReturnType<typeof vi.fn>; onRenameWebObject: ReturnType<typeof vi.fn> } {
    const onSiteMapViewChange = vi.fn();
    const onRenameWebObject = vi.fn();
    renderSiteMap({
      objectsView: {
        siteMapView,
        onSiteMapViewChange,
        pageGrouping: { webObjects: [blogObject], standalonePageIds: ["home", "about", "missing"] },
        onRenameWebObject,
      },
      ...overrides,
    });
    return { onSiteMapViewChange, onRenameWebObject };
  }

  it("shows a Tree / Objects switch with the shown view pressed", () => {
    renderSiteMapWithObjects("tree");

    const viewSwitch = screen.getByRole("group", { name: "Site map view" });
    expect(within(viewSwitch).getByRole("button", { name: "Tree" })).toHaveAttribute("aria-pressed", "true");
    expect(within(viewSwitch).getByRole("button", { name: "Objects" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("list", { name: "Site map" })).toBeInTheDocument();
  });

  it("asks for the view picked, and ignores a click on the view already shown", async () => {
    const { onSiteMapViewChange } = renderSiteMapWithObjects("tree");

    await userEvent.click(screen.getByRole("button", { name: "Tree" }));
    expect(onSiteMapViewChange).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Objects" }));
    expect(onSiteMapViewChange).toHaveBeenCalledWith("objects");
  });

  it("draws the pages grouped into web objects in the Objects view, scrolling inside its panel on desktop", async () => {
    const onSelectPage = vi.fn();
    const { onRenameWebObject } = renderSiteMapWithObjects("objects", { onSelectPage });

    expect(screen.queryByRole("list", { name: "Site map" })).not.toBeInTheDocument();
    const webObjectList = screen.getByRole("list", { name: "Web objects" });
    expect(within(webObjectList).getByRole("heading", { name: "Blog post" })).toBeInTheDocument();
    expect(webObjectList.parentElement).toHaveStyle({ maxHeight: "640px" });

    await userEvent.click(screen.getByRole("button", { name: "/blog" }));
    await userEvent.click(screen.getByRole("button", { name: "Rename Blog post" }));

    expect(onSelectPage).toHaveBeenCalledWith("blog");
    expect(onRenameWebObject).toHaveBeenCalledWith(blogObject);
  });

  it("says so when the crawl has no pages yet, in either view", () => {
    renderSiteMapWithObjects("objects", { pages: [] });

    expect(screen.getByText("No pages yet.")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Web objects" })).not.toBeInTheDocument();
  });
});
