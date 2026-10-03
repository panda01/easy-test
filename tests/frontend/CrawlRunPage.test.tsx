import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, screen, within, type RenderResult } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { type ReactElement } from "react";
import { Route, useLocation, useNavigationType } from "react-router-dom";
import CrawlRunPage from "../../src/pages/CrawlRunPage";
import {
  buildCrawledPageRecord,
  buildCrawledPageSummaryRecord,
  buildCrawlRunWithPagesRecord,
  buildJsonResponse,
  buildWebsiteRecord,
  countRequests,
  createDeferred,
  readBreadcrumbTrail,
  renderPageRoutes,
  stubFetchRoutes,
  type FetchStub,
  type StubbedRouteTable,
} from "./support/frontendTestHelpers";

const RUN_PATH = "/websites/website-1/crawl-runs/crawl-run-1";
const WEBSITE_API_URL = "/api/websites/website-1";
const RUN_API_URL = "/api/websites/website-1/crawl-runs/crawl-run-1";
const HOME_PAGE_API_URL = `${RUN_API_URL}/pages/home`;
const ABOUT_PAGE_API_URL = `${RUN_API_URL}/pages/about`;

const homePage = buildCrawledPageSummaryRecord({
  id: "home",
  url: "https://example.com/",
  title: "Home",
});
const aboutPage = buildCrawledPageSummaryRecord({
  id: "about",
  parentPageId: "home",
  url: "https://example.com/about",
  title: "About",
  visitOrder: 1,
  depth: 1,
});
const finishedRun = buildCrawlRunWithPagesRecord({
  status: "finished",
  visitedPageCount: 2,
  durationMs: 6400,
  createdAt: "2026-03-04T05:06:07.000Z",
  pages: [homePage, aboutPage],
});

/**
 * Shows the current query string and how the router got there, next to the
 * page, so a test can see `?page=` change.
 * @returns The probe's readouts
 */
function SearchProbe(): ReactElement {
  const location = useLocation();
  const navigationType = useNavigationType();
  return (
    <>
      <span data-testid="probe-search">{location.search}</span>
      <span data-testid="probe-navigation-type">{navigationType}</span>
    </>
  );
}

/**
 * Renders the crawl run page on its real route, starting at the given URL.
 * @param startUrl - The path (and query string) to open
 * @returns The Testing Library render result
 */
function renderCrawlRunPage(startUrl = RUN_PATH): RenderResult {
  return renderPageRoutes(
    <Route
      path="/websites/:websiteId/crawl-runs/:crawlRunId"
      element={
        <>
          <CrawlRunPage />
          <SearchProbe />
        </>
      }
    />,
    { initialEntries: [startUrl] },
  );
}

/**
 * Stubs the website, a finished two-page run, and both pages in full, plus
 * any extra or replacement routes.
 * @param extraRoutes - More replies, or replacements
 * @returns The installed fetch stub
 */
function stubFinishedRun(extraRoutes: StubbedRouteTable = {}): FetchStub {
  return stubFetchRoutes({
    [`GET ${WEBSITE_API_URL}`]: { status: 200, body: buildWebsiteRecord() },
    [`GET ${RUN_API_URL}`]: { status: 200, body: finishedRun },
    [`GET ${HOME_PAGE_API_URL}`]: {
      status: 200,
      body: buildCrawledPageRecord({
        ...homePage,
        ariaSnapshot: '- heading "Home" [level=1]',
        linkedUrls: ["https://example.com/about"],
      }),
    },
    [`GET ${ABOUT_PAGE_API_URL}`]: {
      status: 200,
      body: buildCrawledPageRecord({
        ...aboutPage,
        ariaSnapshot: '- heading "About" [level=1]',
        linkedUrls: [],
      }),
    },
    ...extraRoutes,
  });
}

describe("CrawlRunPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a spinner and a placeholder breadcrumb while the crawl loads", () => {
    const pendingRun = createDeferred<Response>();
    stubFinishedRun({ [`GET ${RUN_API_URL}`]: () => pendingRun.promise });

    renderCrawlRunPage();

    expect(screen.getByRole("progressbar", { name: "Loading crawl" })).toBeInTheDocument();
    expect(readBreadcrumbTrail().at(-1)).toEqual({ label: "Crawl", href: null });
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
  });

  it("shows the server's not-found text for an unknown crawl", async () => {
    stubFinishedRun({
      [`GET ${RUN_API_URL}`]: { status: 404, body: { error: "Crawl run not found" } },
    });

    renderCrawlRunPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Crawl run not found");
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
  });

  it("shows the finished crawl's outcome, breadcrumbs, site map, and the start page in full", async () => {
    const fetchStub = stubFinishedRun();

    renderCrawlRunPage();

    expect(await screen.findByRole("heading", { level: 1, name: "Site crawl" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Finished · 2 pages · 6.4 s");
    const startedAtText = new Date(finishedRun.createdAt).toLocaleString();
    expect(screen.getByText(`Started ${startedAtText} at https://example.com/`)).toBeInTheDocument();
    expect(await screen.findByText("Example")).toBeInTheDocument();
    expect(readBreadcrumbTrail()).toEqual([
      { label: "Websites", href: "/websites" },
      { label: "Example", href: "/websites/website-1" },
      { label: `Crawl ${startedAtText}`, href: null },
    ]);
    const siteMap = screen.getByRole("list", { name: "Site map" });
    expect(within(siteMap).getAllByRole("button")).toHaveLength(2);
    expect(within(siteMap).getByRole("button", { name: /^\/ Succeeded/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(await screen.findByLabelText("Aria snapshot")).toHaveTextContent(
      '- heading "Home" [level=1]',
    );
    expect(screen.queryByRole("progressbar", { name: "Crawling" })).not.toBeInTheDocument();
    expect(countRequests(fetchStub, "GET", ABOUT_PAGE_API_URL)).toBe(0);
  });

  it("shows a page picked from the site map, and keeps the choice in the query string (replaced)", async () => {
    const user = userEvent.setup();
    const fetchStub = stubFinishedRun();
    renderCrawlRunPage();
    const siteMap = await screen.findByRole("list", { name: "Site map" });

    await user.click(within(siteMap).getByRole("button", { name: /^\/about/ }));

    expect(await screen.findByLabelText("Aria snapshot")).toHaveTextContent(
      '- heading "About" [level=1]',
    );
    expect(within(siteMap).getByRole("button", { name: /^\/about/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByTestId("probe-search").textContent).toBe("?page=about");
    expect(screen.getByTestId("probe-navigation-type").textContent).toBe("REPLACE");
    expect(countRequests(fetchStub, "GET", ABOUT_PAGE_API_URL)).toBe(1);
  });

  it("follows a link listed on the shown page to that page", async () => {
    const user = userEvent.setup();
    stubFinishedRun();
    renderCrawlRunPage();
    const links = await screen.findByRole("list", { name: "Links on this page" });

    await user.click(within(links).getByRole("button", { name: "/about" }));

    expect(await screen.findByLabelText("Aria snapshot")).toHaveTextContent(
      '- heading "About" [level=1]',
    );
  });

  it("opens the page named in ?page= (e.g. after a reload)", async () => {
    stubFinishedRun();

    renderCrawlRunPage(`${RUN_PATH}?page=about`);

    expect(await screen.findByLabelText("Aria snapshot")).toHaveTextContent(
      '- heading "About" [level=1]',
    );
  });

  it("falls back to the start page when ?page= names no page of this crawl", async () => {
    stubFinishedRun();

    renderCrawlRunPage(`${RUN_PATH}?page=gone`);

    expect(await screen.findByLabelText("Aria snapshot")).toHaveTextContent(
      '- heading "Home" [level=1]',
    );
  });

  it("shows a failed crawl's reason", async () => {
    stubFinishedRun({
      [`GET ${RUN_API_URL}`]: {
        status: 200,
        body: buildCrawlRunWithPagesRecord({
          status: "failed",
          visitedPageCount: 0,
          durationMs: 120,
          errorMessage: "browserType.launch: Executable doesn't exist",
          pages: [],
        }),
      },
    });

    renderCrawlRunPage();

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Failed · 0 pages · 0.1 s");
    expect(status).toHaveTextContent("browserType.launch: Executable doesn't exist");
    expect(screen.getByText("No pages yet.")).toBeInTheDocument();
  });

  it("shows a crawl interrupted at boot without a duration", async () => {
    stubFinishedRun({
      [`GET ${RUN_API_URL}`]: {
        status: 200,
        body: buildCrawlRunWithPagesRecord({
          status: "interrupted",
          visitedPageCount: 2,
          durationMs: null,
          pages: [homePage, aboutPage],
        }),
      },
    });

    renderCrawlRunPage();

    expect(await screen.findByRole("status")).toHaveTextContent(
      /^Interrupted \(the server restarted or the browser closed\) · 2 pages$/,
    );
  });
});

describe("CrawlRunPage while the crawl runs", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Moves the fake clock forward and lets whatever it triggered settle.
   * @param milliseconds - How far to move the clock
   * @returns Resolves once the triggered work has settled
   */
  async function advanceClock(milliseconds: number): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(milliseconds);
    });
  }

  it("shows live progress, grows the site map as pages arrive, and stops polling when the crawl ends", async () => {
    const runningRun = buildCrawlRunWithPagesRecord({
      status: "running",
      visitedPageCount: 1,
      waitingUrlCount: 1,
      durationMs: null,
      finishedAt: null,
      pages: [homePage],
    });
    let runRequestCount = 0;
    const fetchStub = stubFinishedRun({
      [`GET ${RUN_API_URL}`]: () => {
        runRequestCount += 1;
        const body = runRequestCount === 1 ? runningRun : finishedRun;
        return Promise.resolve(buildJsonResponse(200, body));
      },
    });

    renderCrawlRunPage();
    await advanceClock(0);

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Running · 1 page so far");
    expect(status).toHaveTextContent("Visited 1 of up to 50 pages · 1 link waiting");
    expect(within(status).getByRole("progressbar", { name: "Crawling" })).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Site map" })).getAllByRole("button")).toHaveLength(1);

    await advanceClock(2000);

    expect(screen.getByRole("status")).toHaveTextContent("Finished · 2 pages · 6.4 s");
    expect(within(screen.getByRole("list", { name: "Site map" })).getAllByRole("button")).toHaveLength(2);
    expect(screen.queryByRole("progressbar", { name: "Crawling" })).not.toBeInTheDocument();
    await advanceClock(10_000);
    expect(countRequests(fetchStub, "GET", RUN_API_URL)).toBe(2);
  });

  it("keeps showing the last progress, with a warning, while the server cannot be reached", async () => {
    const runningRun = buildCrawlRunWithPagesRecord({
      status: "running",
      visitedPageCount: 1,
      durationMs: null,
      pages: [homePage],
    });
    let runRequestCount = 0;
    stubFinishedRun({
      [`GET ${RUN_API_URL}`]: () => {
        runRequestCount += 1;
        const firstRequest = runRequestCount === 1;
        return Promise.resolve(
          firstRequest
            ? buildJsonResponse(200, runningRun)
            : buildJsonResponse(502, { error: "Bad gateway" }),
        );
      },
    });

    renderCrawlRunPage();
    await advanceClock(0);
    await advanceClock(2000);

    expect(screen.getByRole("status")).toHaveTextContent("Running · 1 page so far");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not refresh the crawl (Bad gateway); still trying.",
    );
  });
});
