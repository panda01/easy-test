import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, within, type RenderResult } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import CrawlWebObjectMap, { type CrawlWebObjectMapProps } from "../../src/components/CrawlWebObjectMap";
import {
  buildCrawledPageSummaryRecord,
  buildCrawlPageGroupingWebObjectRecord,
} from "./support/frontendTestHelpers";

const homePage = buildCrawledPageSummaryRecord({ id: "home", url: "https://example.com/" });
const websitePageA = buildCrawledPageSummaryRecord({ id: "website-a", url: "https://example.com/websites/41", visitOrder: 1 });
const websitePageB = buildCrawledPageSummaryRecord({
  id: "website-b",
  url: "https://example.com/websites/42",
  visitOrder: 2,
  succeeded: false,
  httpStatus: 500,
});
const newWebsitePage = buildCrawledPageSummaryRecord({ id: "website-new", url: "https://example.com/websites/new", visitOrder: 3 });
const actionPage = buildCrawledPageSummaryRecord({ id: "action-a", url: "https://example.com/websites/41/actions/7", visitOrder: 4 });

const websiteObject = buildCrawlPageGroupingWebObjectRecord({
  instanceValues: ["41", "42"],
  skippedLinkCount: 1,
  patterns: [
    { key: "/websites/{website}", role: "instance", viewName: null, detectedBy: "idShape", pageIds: ["website-a", "website-b"] },
    { key: "/websites/new", role: "create", viewName: null, detectedBy: "idShape", pageIds: ["website-new", "unknown-page"] },
  ],
});
const actionObject = buildCrawlPageGroupingWebObjectRecord({
  webObjectId: null,
  instancePatternKey: "/websites/{website}/actions/{action}",
  displayName: "Action",
  detectedName: "Action",
  parentInstancePatternKey: "/websites/{website}",
  instanceValues: ["7"],
  patterns: [
    {
      key: "/websites/{website}/actions/{action}",
      role: "instance",
      viewName: null,
      detectedBy: "idShape",
      pageIds: ["action-a"],
    },
  ],
});

/**
 * Renders the Objects view with sensible defaults, overridden per test.
 * @param overrides - Props to replace
 * @returns The Testing Library render result
 */
function renderObjectMap(overrides: Partial<CrawlWebObjectMapProps> = {}): RenderResult {
  const props: CrawlWebObjectMapProps = {
    pageGrouping: { webObjects: [websiteObject, actionObject], standalonePageIds: ["home"] },
    pages: [homePage, websitePageA, websitePageB, newWebsitePage, actionPage],
    selectedPageId: null,
    onSelectPage: vi.fn(),
    isPhoneLayout: false,
    onRenameWebObject: vi.fn(),
    ...overrides,
  };
  return render(<CrawlWebObjectMap {...props} />);
}

describe("CrawlWebObjectMap", () => {
  it("lists each web object with its counts and pattern, then each pattern's label and pages, and the other pages last", () => {
    renderObjectMap();

    expect(screen.getByRole("heading", { name: "Website" })).toBeInTheDocument();
    expect(screen.getByText("2 instances · 1 more skipped")).toBeInTheDocument();
    expect(screen.getByText("/websites/{website}")).toBeInTheDocument();
    expect(screen.getAllByText("Instance page")).toHaveLength(2);
    expect(screen.getByText("Create page")).toBeInTheDocument();
    const websiteInstances = screen.getByRole("list", { name: "Website: /websites/{website}" });
    expect(within(websiteInstances).getAllByRole("button").map((row) => row.textContent)).toEqual([
      "/websites/41",
      "/websites/42HTTP 500",
    ]);
    // A page id the page list does not have is skipped.
    const createPages = screen.getByRole("list", { name: "Website: /websites/new" });
    expect(within(createPages).getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Action" })).toBeInTheDocument();
    expect(screen.getByText("1 instance")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Other pages" })).toBeInTheDocument();
    expect(screen.getByText("1 page")).toBeInTheDocument();
    const otherPages = screen.getByRole("list", { name: "Other pages" });
    expect(within(otherPages).getByRole("button", { name: "/" })).toBeInTheDocument();
  });

  it("selects a page picked from a group, and highlights the selected page", async () => {
    const onSelectPage = vi.fn();
    renderObjectMap({ onSelectPage, selectedPageId: "action-a" });

    await userEvent.click(screen.getByRole("button", { name: "/websites/41" }));

    expect(onSelectPage).toHaveBeenCalledWith("website-a");
    expect(screen.getByRole("button", { name: "/websites/41/actions/7" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: "/websites/41" })).not.toHaveAttribute("aria-current");
  });

  it("indents a child object under its parent", () => {
    renderObjectMap();

    const actionHeading = screen.getByRole("heading", { name: "Action" });
    const websiteHeading = screen.getByRole("heading", { name: "Website" });
    const actionHeader = actionHeading.closest("li")?.firstElementChild;
    const websiteHeader = websiteHeading.closest("li")?.firstElementChild;
    expect(websiteHeader).toHaveStyle({ paddingLeft: "0px" });
    expect(actionHeader).toHaveStyle({ paddingLeft: "18px" });
  });

  it("collapses and expands a group's pages", async () => {
    renderObjectMap();

    await userEvent.click(screen.getByRole("button", { name: "Collapse Website" }));

    // The collapse animates first, then unmounts the rows.
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "/websites/41" })).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Expand Website" })).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(screen.getByRole("button", { name: "Expand Website" }));

    expect(screen.getByRole("button", { name: "/websites/41" })).toBeInTheDocument();
  });

  it("collapses and expands the other pages", async () => {
    renderObjectMap();

    await userEvent.click(screen.getByRole("button", { name: "Collapse Other pages" }));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "/" })).not.toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: "Expand Other pages" }));
    expect(screen.getByRole("button", { name: "/" })).toBeInTheDocument();
  });

  it("offers a rename only for a saved object, and hands that object back", async () => {
    const onRenameWebObject = vi.fn();
    renderObjectMap({ onRenameWebObject });

    expect(screen.queryByRole("button", { name: "Rename Action" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rename Other pages" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Rename Website" }));

    expect(onRenameWebObject).toHaveBeenCalledWith(websiteObject);
  });

  it("shows no Other pages group when every page belongs to an object", () => {
    renderObjectMap({ pageGrouping: { webObjects: [websiteObject], standalonePageIds: [] }, isPhoneLayout: true });

    expect(screen.queryByRole("heading", { name: "Other pages" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "/websites/41" })).toHaveStyle({ minHeight: "44px" });
  });
});
