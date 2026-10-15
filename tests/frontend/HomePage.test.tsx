import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, within, type RenderResult } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { Route } from "react-router-dom";
import HomePage from "../../src/pages/HomePage";
import {
  buildWebsiteWithSummaryRecord,
  createDeferred,
  readProbeAfterLanding,
  renderPageRoutes,
  stubFetchRoutes,
  stubWindowWidth,
} from "./support/frontendTestHelpers";

const HOME_PATH = "/";

/** "Now" for every spec, so the relative times read the same on every run. */
const NOW = new Date("2026-10-13T14:30:00.000Z");

/** A website with seven actions, a run twelve minutes ago, and a crawl running now. */
const forgeGym = buildWebsiteWithSummaryRecord(
  { id: "website-1", name: "Forge Gym management", url: "https://staging.forgegym.app" },
  {
    actionCount: 7,
    passedActionCount: 4,
    failedActionCount: 2,
    notRunActionCount: 1,
    latestRunAt: "2026-10-13T14:18:00.000Z",
    latestCrawlRun: {
      id: "crawl-run-1",
      status: "running",
      visitedPageCount: 12,
      pageLimit: 50,
      createdAt: "2026-10-13T14:28:00.000Z",
      finishedAt: null,
    },
  },
);

/** A website with no actions that finished a crawl of 46 pages two hours ago. */
const lanternDocs = buildWebsiteWithSummaryRecord(
  { id: "website-2", name: "Lantern Docs", url: "https://docs.lantern.dev/getting-started" },
  {
    latestCrawlRun: {
      id: "crawl-run-2",
      status: "finished",
      visitedPageCount: 46,
      pageLimit: 50,
      createdAt: "2026-10-13T12:20:00.000Z",
      finishedAt: "2026-10-13T12:25:00.000Z",
    },
  },
);

/** A website that has never been crawled or run. */
const internalAdmin = buildWebsiteWithSummaryRecord({
  id: "website-3",
  name: "Internal admin",
  url: "http://localhost:4100",
});

/**
 * Renders the dashboard on its real route (`/`); every link out lands on the
 * location probe.
 * @returns The Testing Library render result
 */
function renderHomePage(): RenderResult {
  return renderPageRoutes(<Route path={HOME_PATH} element={<HomePage />} />, {
    initialEntries: [HOME_PATH],
  });
}

/**
 * Finds the dashboard row of a website by its name.
 * @param websiteName - The website's name
 * @returns The row (its list item)
 */
async function findWebsiteRow(websiteName: string): Promise<HTMLElement> {
  const websiteLink = await screen.findByRole("link", { name: websiteName });
  const websiteRow = websiteLink.closest("li");
  if (websiteRow === null) throw new Error(`No dashboard row for ${websiteName}`);
  return websiteRow;
}

describe("HomePage (the websites dashboard)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Only the clock is faked: timers stay real, so Testing Library still waits.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the Websites heading, a New website link, and a spinner while the list loads", () => {
    const pendingList = createDeferred<Response>();
    stubFetchRoutes({ "GET /api/websites": () => pendingList.promise });

    renderHomePage();

    expect(screen.getByRole("heading", { level: 1, name: "Websites" })).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Loading websites" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "New website" })).toHaveAttribute("href", "/websites/new");
    expect(screen.queryByRole("list", { name: "Websites" })).not.toBeInTheDocument();
  });

  it("shows the server's error text when the list fails to load", async () => {
    stubFetchRoutes({
      "GET /api/websites": { status: 500, body: { error: "Database unavailable" } },
    });

    renderHomePage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Database unavailable");
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Websites" })).not.toBeInTheDocument();
  });

  it("shows the empty state and zero totals when there are no websites", async () => {
    stubFetchRoutes({ "GET /api/websites": { status: 200, body: [] } });

    renderHomePage();

    expect(
      await screen.findByText("No websites yet. Add one to start describing what to test."),
    ).toBeInTheDocument();
    expect(screen.getByText("0 sites · 0 actions")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Websites" })).not.toBeInTheDocument();
  });

  it("lists every website as a row, in the order the API returns them, under the column headings", async () => {
    stubFetchRoutes({
      "GET /api/websites": { status: 200, body: [forgeGym, lanternDocs, internalAdmin] },
    });

    renderHomePage();

    const websiteList = await screen.findByRole("list", { name: "Websites" });
    const websiteRows = within(websiteList).getAllByRole("listitem");
    expect(websiteRows).toHaveLength(3);
    expect(within(websiteRows[0]).getByRole("link", { name: "Forge Gym management" })).toHaveAttribute(
      "href",
      "/websites/website-1",
    );
    expect(websiteRows[0]).toHaveTextContent("https://staging.forgegym.app");
    expect(within(websiteRows[1]).getByRole("link", { name: "Lantern Docs" })).toHaveAttribute(
      "href",
      "/websites/website-2",
    );
    expect(within(websiteRows[2]).getByRole("link", { name: "Internal admin" })).toHaveAttribute(
      "href",
      "/websites/website-3",
    );
    expect(screen.getByText("Last crawl")).toBeInTheDocument();
    expect(
      screen.queryByText("No websites yet. Add one to start describing what to test."),
    ).not.toBeInTheDocument();
  });

  it("totals the sites and actions and says when a script last ran", async () => {
    stubFetchRoutes({
      "GET /api/websites": { status: 200, body: [forgeGym, lanternDocs, internalAdmin] },
    });

    renderHomePage();

    expect(await screen.findByText("3 sites · 7 actions · last run 12 min ago")).toBeInTheDocument();
  });

  it("leaves the last run out of the totals when no script has run", async () => {
    stubFetchRoutes({ "GET /api/websites": { status: 200, body: [lanternDocs] } });

    renderHomePage();

    expect(await screen.findByText("1 site · 0 actions")).toBeInTheDocument();
  });

  it("shows a website's actions as passed, failed, and not run counts", async () => {
    stubFetchRoutes({ "GET /api/websites": { status: 200, body: [forgeGym] } });

    renderHomePage();

    const forgeGymRow = await findWebsiteRow("Forge Gym management");
    expect(within(forgeGymRow).getByText("4 passed")).toBeInTheDocument();
    expect(within(forgeGymRow).getByText("2 failed")).toBeInTheDocument();
    expect(within(forgeGymRow).getByText("1 not run")).toBeInTheDocument();
    expect(within(forgeGymRow).queryByText(/No actions yet/)).not.toBeInTheDocument();
  });

  it("says each website's last crawl: running with its progress, finished with its pages and when, or never", async () => {
    stubFetchRoutes({
      "GET /api/websites": { status: 200, body: [forgeGym, lanternDocs, internalAdmin] },
    });

    renderHomePage();

    expect(within(await findWebsiteRow("Forge Gym management")).getByText("Crawl running · 12 of 50")).toBeInTheDocument();
    expect(within(await findWebsiteRow("Lantern Docs")).getByText("46 pages · 2 h ago")).toBeInTheDocument();
    expect(within(await findWebsiteRow("Internal admin")).getByText("Never crawled")).toBeInTheDocument();
  });

  it("offers to add the first action to a website with none, linking to its new-action form", async () => {
    const user = userEvent.setup();
    stubFetchRoutes({ "GET /api/websites": { status: 200, body: [lanternDocs] } });
    renderHomePage();
    const lanternDocsRow = await findWebsiteRow("Lantern Docs");
    expect(lanternDocsRow).toHaveTextContent("No actions yet — add the first one");
    expect(within(lanternDocsRow).queryByText(/passed/)).not.toBeInTheDocument();

    await user.click(within(lanternDocsRow).getByRole("link", { name: "add the first one" }));

    const landing = await readProbeAfterLanding("/websites/website-2/actions/new");
    expect(landing.navigationType).toBe("PUSH");
    expect(landing.state).toBe(JSON.stringify({ returnTo: HOME_PATH }));
  });

  it("opens a website's page from its row, with the dashboard as its return state", async () => {
    const user = userEvent.setup();
    stubFetchRoutes({ "GET /api/websites": { status: 200, body: [forgeGym] } });
    renderHomePage();

    await user.click(await screen.findByRole("link", { name: "Forge Gym management" }));

    const landing = await readProbeAfterLanding("/websites/website-1");
    expect(landing.navigationType).toBe("PUSH");
    expect(landing.state).toBe(JSON.stringify({ returnTo: HOME_PATH }));
  });

  it("opens the create form with the dashboard as its return state", async () => {
    const user = userEvent.setup();
    stubFetchRoutes({ "GET /api/websites": { status: 200, body: [] } });
    renderHomePage();
    await screen.findByText("No websites yet. Add one to start describing what to test.");

    await user.click(screen.getByRole("link", { name: "New website" }));

    const landing = await readProbeAfterLanding("/websites/new");
    expect(landing.navigationType).toBe("PUSH");
    expect(landing.state).toBe(JSON.stringify({ returnTo: HOME_PATH }));
  });

  describe("on a phone", () => {
    let removeWidthStub: (() => void) | null = null;

    beforeEach(() => {
      removeWidthStub = stubWindowWidth(390);
    });

    afterEach(() => {
      removeWidthStub?.();
      removeWidthStub = null;
    });

    it("stacks each website as a card, without the column headings or the last run, behind a short New button", async () => {
      stubFetchRoutes({
        "GET /api/websites": { status: 200, body: [forgeGym, lanternDocs] },
      });

      renderHomePage();

      const websiteList = await screen.findByRole("list", { name: "Websites" });
      expect(within(websiteList).getAllByRole("listitem")).toHaveLength(2);
      expect(screen.getByText("2 sites · 7 actions")).toBeInTheDocument();
      expect(screen.queryByText(/last run/)).not.toBeInTheDocument();
      expect(screen.queryByText("Last crawl")).not.toBeInTheDocument();
      expect(screen.getByRole("link", { name: "New" })).toHaveAttribute("href", "/websites/new");
      const forgeGymRow = await findWebsiteRow("Forge Gym management");
      expect(within(forgeGymRow).getByText("4 passed")).toBeInTheDocument();
      expect(within(forgeGymRow).getByText("Crawl running · 12 of 50")).toBeInTheDocument();
    });
  });
});
