import { describe, it, expect, vi } from "vitest";
import { render, screen, within, type RenderResult } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import CrawledPageDetails, {
  type CrawledPageDetailsProps,
} from "../../src/components/CrawledPageDetails";
import { type CrawledPageRecord } from "../../src/hooks/useCrawledPage";
import { type JsonResourceState } from "../../src/hooks/useJsonResource";
import {
  buildCrawledPageRecord,
  buildCrawledPageSummaryRecord,
} from "./support/frontendTestHelpers";

const homePage = buildCrawledPageSummaryRecord({ id: "home", url: "https://example.com/" });
const aboutPage = buildCrawledPageSummaryRecord({
  id: "about",
  parentPageId: "home",
  url: "https://example.com/about",
  requestedUrl: "https://example.com/about?ref=nav",
  finalUrl: "https://example.com/about-us",
  title: "About us",
  depth: 1,
  durationMs: 1250,
});
const visitedPages = [homePage, aboutPage];

/**
 * Builds a loaded full-page resource.
 * @param overrides - Fields to replace in the default full page
 * @returns The resource state
 */
function loadedPage(overrides: Partial<CrawledPageRecord> = {}): JsonResourceState<CrawledPageRecord> {
  return { data: buildCrawledPageRecord(overrides), isLoading: false, errorMessage: null };
}

/**
 * Renders the details of the about page by default, overridden per test.
 * @param overrides - Props to replace
 * @returns The Testing Library render result
 */
function renderDetails(overrides: Partial<CrawledPageDetailsProps> = {}): RenderResult {
  const props: CrawledPageDetailsProps = {
    page: aboutPage,
    pageResource: loadedPage({
      ...aboutPage,
      ariaSnapshot: '- heading "About us" [level=1]',
      linkedUrls: ["https://example.com/", "https://example.com/careers"],
    }),
    visitedPagesByUrl: new Map(visitedPages.map((page) => [page.url, page])),
    visitedPagesById: new Map(visitedPages.map((page) => [page.id, page])),
    onSelectPage: vi.fn(),
    ...overrides,
  };
  return render(<CrawledPageDetails {...props} />);
}

describe("CrawledPageDetails", () => {
  it("names the page by its path and shows its outcome, URLs, title, and depth", () => {
    renderDetails();

    const section = screen.getByRole("region", { name: "/about" });
    expect(section).toHaveTextContent("Succeeded · HTTP 200 · 1.3 s");
    expect(section).toHaveTextContent("Loaded: https://example.com/about?ref=nav");
    expect(section).toHaveTextContent("Ended up at: https://example.com/about-us");
    expect(section).toHaveTextContent("Title: About us");
    expect(section).toHaveTextContent("Links followed to get here: 1");
  });

  it("shows the aria snapshot exactly as recorded", () => {
    renderDetails();

    const snapshot = screen.getByLabelText("Aria snapshot");
    expect(snapshot.tagName).toBe("PRE");
    expect(snapshot).toHaveTextContent('- heading "About us" [level=1]');
  });

  it("links the page it was found on, and selects it when clicked", async () => {
    const user = userEvent.setup();
    const onSelectPage = vi.fn();
    renderDetails({ onSelectPage });

    const foundOnRow = screen.getByText("Found on:").parentElement;
    if (foundOnRow === null) throw new Error("The Found on row is missing");
    await user.click(within(foundOnRow).getByRole("button", { name: "/" }));

    expect(onSelectPage).toHaveBeenCalledWith("home");
  });

  it("lists the page's links: visited ones select their page, the others are marked not visited", async () => {
    const user = userEvent.setup();
    const onSelectPage = vi.fn();
    renderDetails({ onSelectPage });

    const links = screen.getByRole("list", { name: "Links on this page" });
    expect(screen.getByText("2 same-site links")).toBeInTheDocument();
    expect(within(links).getByText("/careers (not visited)")).toBeInTheDocument();
    await user.click(within(links).getByRole("button", { name: "/" }));

    expect(onSelectPage).toHaveBeenCalledWith("home");
  });

  it("says which button on the page it was found on led here", async () => {
    const user = userEvent.setup();
    const onSelectPage = vi.fn();
    const yogaPage = buildCrawledPageSummaryRecord({
      id: "yoga",
      parentPageId: "about",
      url: "https://example.com/sessions/yoga",
      foundByButtonText: "Open Yoga",
      depth: 2,
    });
    renderDetails({
      page: yogaPage,
      pageResource: loadedPage({ ...yogaPage, linkedUrls: [] }),
      onSelectPage,
    });

    const foundOnRow = screen.getByText("Found on:").parentElement;
    if (foundOnRow === null) throw new Error("The Found on row is missing");
    expect(foundOnRow).toHaveTextContent("Found on: /about, by clicking “Open Yoga”");
    await user.click(within(foundOnRow).getByRole("button", { name: "/about" }));

    expect(onSelectPage).toHaveBeenCalledWith("about");
  });

  it("says which button led here even when the page it was found on is no longer listed", () => {
    const yogaPage = buildCrawledPageSummaryRecord({
      id: "yoga",
      parentPageId: "gone",
      url: "https://example.com/sessions/yoga",
      foundByButtonText: "Open Yoga",
    });

    renderDetails({ page: yogaPage, pageResource: loadedPage({ ...yogaPage, linkedUrls: [] }) });

    expect(screen.getByRole("region", { name: "/sessions/yoga" })).toHaveTextContent(
      "Found on: a page no longer listed, by clicking “Open Yoga”",
    );
  });

  it("lists the pages its buttons led to: visited ones select their page, the others are marked not visited", async () => {
    const user = userEvent.setup();
    const onSelectPage = vi.fn();
    renderDetails({
      pageResource: loadedPage({
        ...aboutPage,
        linkedUrls: [],
        buttonUrls: ["https://example.com/", "https://example.com/sessions/pilates"],
      }),
      onSelectPage,
    });

    expect(
      screen.getByRole("heading", { level: 3, name: "Pages its buttons led to" }),
    ).toBeInTheDocument();
    expect(screen.getByText("2 same-site pages")).toBeInTheDocument();
    const buttonTargets = screen.getByRole("list", { name: "Pages its buttons led to" });
    expect(within(buttonTargets).getByText("/sessions/pilates (not visited)")).toBeInTheDocument();
    await user.click(within(buttonTargets).getByRole("button", { name: "/" }));

    expect(onSelectPage).toHaveBeenCalledWith("home");
  });

  it("leaves out the button list and the found-by text for a page reached by links only", () => {
    renderDetails();

    expect(
      screen.queryByRole("heading", { name: "Pages its buttons led to" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Pages its buttons led to" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "/about" })).not.toHaveTextContent("by clicking");
  });

  it("says where the crawl started for the start page, and leaves out an unchanged final URL", () => {
    renderDetails({
      page: homePage,
      pageResource: loadedPage({ ...homePage, linkedUrls: [] }),
    });

    const section = screen.getByRole("region", { name: "/" });
    expect(section).toHaveTextContent("Found on: this is where the crawl started");
    expect(section).not.toHaveTextContent("Ended up at");
    expect(screen.getByText("0 same-site links")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Links on this page" })).not.toBeInTheDocument();
  });

  it("says so when the parent page is not in the run's list", () => {
    renderDetails({ visitedPagesById: new Map() });

    expect(screen.getByRole("region", { name: "/about" })).toHaveTextContent(
      "Found on: a page no longer listed",
    );
  });

  it("shows a failed page's outcome, reason, and missing title and snapshot", () => {
    const failedPage = buildCrawledPageSummaryRecord({
      id: "broken",
      parentPageId: "home",
      url: "https://example.com/broken",
      succeeded: false,
      httpStatus: null,
      errorMessage: "page.goto: net::ERR_CONNECTION_REFUSED",
      title: null,
    });

    renderDetails({
      page: failedPage,
      pageResource: loadedPage({ ...failedPage, ariaSnapshot: null, linkedUrls: [] }),
    });

    const section = screen.getByRole("region", { name: "/broken" });
    expect(section).toHaveTextContent("Failed · No response");
    expect(section).toHaveTextContent("page.goto: net::ERR_CONNECTION_REFUSED");
    expect(section).toHaveTextContent("Title: none");
    expect(screen.getByText("No aria snapshot was taken for this page.")).toBeInTheDocument();
  });

  it("shows a spinner while the full page loads, and its failure when it cannot", () => {
    const { rerender } = renderDetails({
      pageResource: { data: null, isLoading: true, errorMessage: null },
    });
    expect(screen.getByRole("progressbar", { name: "Loading page" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Aria snapshot")).not.toBeInTheDocument();

    rerender(
      <CrawledPageDetails
        page={aboutPage}
        pageResource={{ data: null, isLoading: false, errorMessage: "Crawled page not found" }}
        visitedPagesByUrl={new Map()}
        visitedPagesById={new Map()}
        onSelectPage={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Crawled page not found");
  });
});
