import { describe, it, expect, vi } from "vitest";
import { render, screen, within, type RenderResult } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import CrawlSiteMap, { type CrawlSiteMapProps } from "../../src/components/CrawlSiteMap";
import { buildCrawledPageSummaryRecord } from "./support/frontendTestHelpers";

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
      "/Succeeded · HTTP 200 · Home",
      "/aboutSucceeded · HTTP 200",
      "/about/missingFailed · HTTP 404",
      "/blogSucceeded · HTTP 200 · Blog",
    ]);
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
      "/sessions/yogaSucceeded · HTTP 200 · Yoga · via “Open Yoga”",
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
    expect(screen.getByRole("button", { name: /^\/about Succeeded/ })).not.toHaveAttribute(
      "aria-current",
    );
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
});
