import { describe, it, expect, vi } from "vitest";
import { render, screen, within, type RenderResult } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import CrawledPageDetails, {
  type CrawledPageDetailsProps,
} from "../../src/components/CrawledPageDetails";
import { type CrawledPageRecord } from "../../src/hooks/useCrawledPage";
import { type JsonResourceState } from "../../src/hooks/useJsonResource";
import { statusColors } from "../../src/theme/nocturneTheme";
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

/**
 * Finds one of the page's two URL cards ("Links · N" or "Buttons led to · N").
 * @param cardName - The card's kicker with its count, e.g. "Links · 2"
 * @returns The card's region
 */
function getUrlCard(cardName: string): HTMLElement {
  return screen.getByRole("region", { name: cardName });
}

describe("CrawledPageDetails", () => {
  it("names the page by its path and shows its HTTP status in green, its title, and where it was found", () => {
    renderDetails();

    const section = screen.getByRole("region", { name: "/about" });
    expect(screen.getByRole("heading", { level: 2, name: "/about" })).toBeInTheDocument();
    expect(within(section).getByText("HTTP 200")).toHaveStyle({ color: statusColors.httpOk });
    expect(section).toHaveTextContent("About us");
    expect(section).toHaveTextContent("Found on /");
    expect(section).not.toHaveTextContent("Redirected");
  });

  it("shows the aria snapshot exactly as recorded, with its line count", () => {
    renderDetails({
      pageResource: loadedPage({
        ...aboutPage,
        ariaSnapshot: '- heading "About us" [level=1]\n- link "Home"',
        linkedUrls: [],
      }),
    });

    expect(screen.getByRole("heading", { level: 3, name: "Aria snapshot" })).toBeInTheDocument();
    expect(screen.getByText("2 lines")).toBeInTheDocument();
    const snapshot = screen.getByLabelText("Aria snapshot");
    expect(snapshot.tagName).toBe("PRE");
    expect(snapshot).toHaveTextContent('- heading "About us" [level=1] - link "Home"');
  });

  it("counts a one-line snapshot as 1 line", () => {
    renderDetails();

    expect(screen.getByText("1 line")).toBeInTheDocument();
  });

  it("links the page it was found on, and selects it when clicked", async () => {
    const user = userEvent.setup();
    const onSelectPage = vi.fn();
    renderDetails({ onSelectPage });

    const foundOnFact = screen.getByText(/^Found on/);
    await user.click(within(foundOnFact).getByRole("button", { name: "/" }));

    expect(onSelectPage).toHaveBeenCalledWith("home");
  });

  it("lists the page's links in a card: visited ones select their page, the others are marked not visited", async () => {
    const user = userEvent.setup();
    const onSelectPage = vi.fn();
    renderDetails({ onSelectPage });

    const linksCard = getUrlCard("Links · 2");
    expect(within(linksCard).getByRole("heading", { level: 3, name: "Links · 2" })).toBeInTheDocument();
    expect(within(linksCard).getByText("/careers (not visited)")).toBeInTheDocument();
    await user.click(within(linksCard).getByRole("button", { name: "/" }));

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

    const foundOnFact = screen.getByText(/^Found on/);
    expect(foundOnFact).toHaveTextContent("Found on /about via “Open Yoga”");
    await user.click(within(foundOnFact).getByRole("button", { name: "/about" }));

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
      "Found on a page no longer listed",
    );
    expect(screen.getByRole("region", { name: "/sessions/yoga" })).not.toHaveTextContent("via");
  });

  it("lists the pages its buttons led to in a card, naming the button that led to each visited one", async () => {
    const user = userEvent.setup();
    const onSelectPage = vi.fn();
    const yogaPage = buildCrawledPageSummaryRecord({
      id: "yoga",
      parentPageId: "about",
      url: "https://example.com/sessions/yoga",
      foundByButtonText: "Open Yoga",
      depth: 2,
    });
    const pagesWithYoga = [...visitedPages, yogaPage];
    renderDetails({
      pageResource: loadedPage({
        ...aboutPage,
        linkedUrls: [],
        buttonUrls: [
          "https://example.com/",
          "https://example.com/sessions/yoga",
          "https://example.com/sessions/pilates",
        ],
      }),
      visitedPagesByUrl: new Map(pagesWithYoga.map((page) => [page.url, page])),
      visitedPagesById: new Map(pagesWithYoga.map((page) => [page.id, page])),
      onSelectPage,
    });

    const buttonsCard = getUrlCard("Buttons led to · 3");
    expect(within(buttonsCard).getByText("/sessions/pilates (not visited)")).toBeInTheDocument();
    expect(within(buttonsCard).getByRole("button", { name: "/" })).toBeInTheDocument();
    await user.click(within(buttonsCard).getByRole("button", { name: "“Open Yoga” → /sessions/yoga" }));

    expect(onSelectPage).toHaveBeenCalledWith("yoga");
  });

  it("says None in a card with nothing to list, and never names a button for a page reached by links only", () => {
    renderDetails();

    expect(getUrlCard("Buttons led to · 0")).toHaveTextContent("None");
    expect(screen.getByRole("region", { name: "/about" })).not.toHaveTextContent("via");
  });

  it("calls the first page the start page, and shows its empty links card", () => {
    renderDetails({
      page: homePage,
      pageResource: loadedPage({ ...homePage, linkedUrls: [] }),
    });

    const section = screen.getByRole("region", { name: "/" });
    expect(section).toHaveTextContent("Start page");
    expect(section).not.toHaveTextContent("Found on");
    expect(getUrlCard("Links · 0")).toHaveTextContent("None");
  });

  it("says so when the parent page is not in the run's list", () => {
    renderDetails({ visitedPagesById: new Map() });

    expect(screen.getByRole("region", { name: "/about" })).toHaveTextContent(
      "Found on a page no longer listed",
    );
  });

  it("states a redirect: where a page recorded where it landed came from", () => {
    const calendarPage = buildCrawledPageSummaryRecord({
      id: "calendar",
      url: "https://example.com/calendar",
      requestedUrl: "https://example.com/",
      finalUrl: "https://example.com/calendar",
      wasRedirected: true,
    });

    renderDetails({ page: calendarPage, pageResource: loadedPage({ ...calendarPage, linkedUrls: [] }) });

    expect(screen.getByRole("region", { name: "/calendar" })).toHaveTextContent("Redirected from /");
  });

  it("shows a failed page's status in red, its reason, and no title or snapshot", () => {
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
    expect(within(section).getByText("No response")).toHaveStyle({ color: statusColors.failed });
    expect(section).toHaveTextContent("page.goto: net::ERR_CONNECTION_REFUSED");
    expect(screen.getByText("No aria snapshot was taken for this page.")).toBeInTheDocument();
    expect(screen.queryByText(/\d+ lines?$/)).not.toBeInTheDocument();
  });

  it("shows a failed page's HTTP status when it answered", () => {
    const notFoundPage = buildCrawledPageSummaryRecord({
      id: "missing",
      url: "https://example.com/missing",
      succeeded: false,
      httpStatus: 404,
    });

    renderDetails({ page: notFoundPage, pageResource: loadedPage({ ...notFoundPage, linkedUrls: [] }) });

    expect(within(screen.getByRole("region", { name: "/missing" })).getByText("HTTP 404")).toHaveStyle({
      color: statusColors.failed,
    });
  });

  it("shows a spinner while the full page loads, and its failure when it cannot", () => {
    const { rerender } = renderDetails({
      pageResource: { data: null, isLoading: true, errorMessage: null },
    });
    expect(screen.getByRole("progressbar", { name: "Loading page" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Aria snapshot")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /^Links/ })).not.toBeInTheDocument();

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
