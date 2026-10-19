import { describe, it, expect, vi } from "vitest";
import { render, screen, within, type RenderResult } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import CrawlRunsSection, {
  CRAWL_LOGGED_OUT_VALUE,
  DEFAULT_CRAWL_BUTTON_MODE,
  type CrawlRunsSectionProps,
} from "../../src/components/CrawlRunsSection";
import { buildCrawlRunRecord, buildCredentialRecord } from "./support/frontendTestHelpers";

const adminCredential = buildCredentialRecord({ id: "credential-1", name: "Admin" });
const editorCredential = buildCredentialRecord({ id: "credential-2", name: "Editor" });

/** "Now" for every spec: the relative times and the elapsed time count from here. */
const NOW = new Date("2026-03-05T05:08:21.000Z");

const newestRun = buildCrawlRunRecord({
  id: "crawl-run-2",
  status: "stoppedAtPageLimit",
  visitedPageCount: 50,
  createdAt: "2026-03-05T02:06:07.000Z",
});
const olderRun = buildCrawlRunRecord({
  id: "crawl-run-1",
  status: "failed",
  visitedPageCount: 0,
  createdAt: "2026-03-04T05:06:07.000Z",
});
/** A crawl started 2 minutes 14 seconds before `NOW`, 12 pages in with 8 waiting. */
const runningRun = buildCrawlRunRecord({
  id: "crawl-run-3",
  status: "running",
  visitedPageCount: 12,
  waitingUrlCount: 8,
  durationMs: null,
  finishedAt: null,
  createdAt: "2026-03-05T05:06:07.000Z",
});

/**
 * Renders the section inside a router (its rows are links) with sensible
 * defaults, overridden per test.
 * @param overrides - Props to replace
 * @returns The Testing Library render result
 */
function renderSection(overrides: Partial<CrawlRunsSectionProps> = {}): RenderResult {
  const props: CrawlRunsSectionProps = {
    websiteId: "website-1",
    runs: [newestRun, olderRun],
    isLoading: false,
    errorMessage: null,
    isStartingCrawl: false,
    startCrawlErrorMessage: null,
    onCrawlClick: vi.fn(),
    crawlAsPickerIsShown: true,
    credentials: [adminCredential, editorCredential],
    selectedCredentialId: CRAWL_LOGGED_OUT_VALUE,
    onSelectedCredentialChange: vi.fn(),
    selectedButtonMode: DEFAULT_CRAWL_BUTTON_MODE,
    onSelectedButtonModeChange: vi.fn(),
    now: NOW,
    ...overrides,
  };
  return render(
    <MemoryRouter>
      <CrawlRunsSection {...props} />
    </MemoryRouter>,
  );
}

/**
 * Reads the links of the crawl history.
 * @returns The history rows' links, in order
 */
function getHistoryLinks(): HTMLElement[] {
  return within(screen.getByRole("list", { name: "History" })).getAllByRole("link");
}

describe("CrawlRunsSection", () => {
  it("has no heading or intro of its own: its tab names it", () => {
    renderSection();

    expect(screen.queryByRole("heading", { level: 2 })).not.toBeInTheDocument();
    expect(screen.queryByText(/follows every link/)).not.toBeInTheDocument();
  });

  it("hides the Crawl as picker, keeping the Buttons picker and the Crawl website button, when told to", () => {
    renderSection({ crawlAsPickerIsShown: false });

    expect(screen.queryByRole("combobox", { name: "Crawl as" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("combobox")).toEqual([screen.getByRole("combobox", { name: "Buttons" })]);
    expect(screen.getByRole("button", { name: "Crawl website" })).toBeEnabled();
  });

  it("puts Crawl as first, then Buttons, with the Crawl website button below them", () => {
    renderSection();

    const crawlAsPicker = screen.getByRole("combobox", { name: "Crawl as" });
    const buttonModePicker = screen.getByRole("combobox", { name: "Buttons" });
    const crawlButton = screen.getByRole("button", { name: "Crawl website" });
    const buttonModePickerFollowsCrawlAs =
      crawlAsPicker.compareDocumentPosition(buttonModePicker) & Node.DOCUMENT_POSITION_FOLLOWING;
    const crawlButtonFollowsButtonModePicker =
      buttonModePicker.compareDocumentPosition(crawlButton) & Node.DOCUMENT_POSITION_FOLLOWING;
    expect(buttonModePickerFollowsCrawlAs).toBeTruthy();
    expect(crawlButtonFollowsButtonModePicker).toBeTruthy();
    // Each picker and the button sit in their own row of the column, not side by side.
    expect(crawlAsPicker.closest(".MuiInputBase-root")?.parentElement).toBe(
      crawlButton.parentElement?.parentElement,
    );
    expect(buttonModePicker.closest(".MuiInputBase-root")?.parentElement).toBe(
      crawlButton.parentElement?.parentElement,
    );
  });

  it("shows the Buttons picker reading Links only by default, offering every mode", async () => {
    const user = userEvent.setup();
    renderSection();

    const buttonModePicker = screen.getByRole("combobox", { name: "Buttons" });
    expect(buttonModePicker).toHaveTextContent("Links only (no buttons)");
    await user.click(buttonModePicker);
    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "Links only (no buttons)",
      "Buttons, except risky ones",
      "Only “Open” buttons",
    ]);
  });

  it.each([
    { optionName: "Buttons, except risky ones", buttonMode: "allButRisky" },
    { optionName: "Only “Open” buttons", buttonMode: "openOnly" },
  ])("hands the $buttonMode mode to the page when $optionName is picked", async ({ optionName, buttonMode }) => {
    const user = userEvent.setup();
    const onSelectedButtonModeChange = vi.fn();
    renderSection({ onSelectedButtonModeChange });

    await user.click(screen.getByRole("combobox", { name: "Buttons" }));
    await user.click(await screen.findByRole("option", { name: optionName }));

    expect(onSelectedButtonModeChange).toHaveBeenCalledWith(buttonMode);
  });

  it("shows the picked mode and hands back Links only when it is picked again", async () => {
    const user = userEvent.setup();
    const onSelectedButtonModeChange = vi.fn();
    renderSection({ selectedButtonMode: "openOnly", onSelectedButtonModeChange });

    const buttonModePicker = screen.getByRole("combobox", { name: "Buttons" });
    expect(buttonModePicker).toHaveTextContent("Only “Open” buttons");
    await user.click(buttonModePicker);
    await user.click(await screen.findByRole("option", { name: "Links only (no buttons)" }));

    expect(onSelectedButtonModeChange).toHaveBeenCalledWith("linksOnly");
  });

  it("lists every ended run, newest first, each linking to its own page with how long ago it ran", () => {
    renderSection();

    const runLinks = getHistoryLinks();
    expect(runLinks).toHaveLength(2);
    expect(runLinks[0]).toHaveTextContent("Stopped at the 50-page limit · 50 pages");
    expect(runLinks[0]).toHaveTextContent("3 h ago");
    expect(within(runLinks[0]).getByTitle(new Date(newestRun.createdAt).toLocaleString())).toBeInTheDocument();
    expect(runLinks[0]).toHaveAttribute("href", "/websites/website-1/crawl-runs/crawl-run-2");
    expect(runLinks[1]).toHaveTextContent("Failed · 0 pages");
    expect(runLinks[1]).toHaveTextContent("yesterday");
  });

  it("words a history row by how its crawl went, or by its failed login", () => {
    renderSection({
      // Without the picker the History is unfiltered, so runs made as
      // different credentials can be listed side by side.
      crawlAsPickerIsShown: false,
      runs: [
        buildCrawlRunRecord({
          id: "logged-in-run",
          credentialId: "credential-1",
          isLoggedIn: true,
          credential: { id: "credential-1", name: "Admin" },
        }),
        buildCrawlRunRecord({
          id: "failed-login-run",
          status: "failed",
          visitedPageCount: 0,
          credentialId: "credential-2",
          credential: { id: "credential-2", name: "Editor" },
        }),
        buildCrawlRunRecord({ id: "logged-out-run" }),
      ],
    });

    const runLinks = getHistoryLinks();
    expect(runLinks[0]).toHaveTextContent("Finished · 3 pages");
    expect(runLinks[1]).toHaveTextContent("Not logged in — login as “Editor” failed");
    expect(runLinks[2]).toHaveTextContent("Finished · 3 pages");
    expect(screen.queryByText(/clicked/)).not.toBeInTheDocument();
  });

  it("shows the Crawl as picker reading Logged out by default, offering every credential", async () => {
    const user = userEvent.setup();
    renderSection();

    const crawlAsPicker = screen.getByRole("combobox", { name: "Crawl as" });
    expect(crawlAsPicker).toHaveTextContent("Logged out");
    await user.click(crawlAsPicker);
    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["Logged out", "Admin", "Editor"]);
  });

  it("shows the picked credential and hands a newly picked one's id to the page", async () => {
    const user = userEvent.setup();
    const onSelectedCredentialChange = vi.fn();
    renderSection({ selectedCredentialId: "credential-1", onSelectedCredentialChange });

    const crawlAsPicker = screen.getByRole("combobox", { name: "Crawl as" });
    expect(crawlAsPicker).toHaveTextContent("Admin");
    await user.click(crawlAsPicker);
    await user.click(await screen.findByRole("option", { name: "Editor" }));

    expect(onSelectedCredentialChange).toHaveBeenCalledWith("credential-2");
  });

  it("hands back the logged-out value when Logged out is picked again", async () => {
    const user = userEvent.setup();
    const onSelectedCredentialChange = vi.fn();
    renderSection({ selectedCredentialId: "credential-1", onSelectedCredentialChange });

    await user.click(screen.getByRole("combobox", { name: "Crawl as" }));
    await user.click(await screen.findByRole("option", { name: "Logged out" }));

    expect(onSelectedCredentialChange).toHaveBeenCalledWith(CRAWL_LOGGED_OUT_VALUE);
  });

  it("calls onCrawlClick when Crawl website is clicked", async () => {
    const user = userEvent.setup();
    const onCrawlClick = vi.fn();
    renderSection({ onCrawlClick });

    await user.click(screen.getByRole("button", { name: "Crawl website" }));

    expect(onCrawlClick).toHaveBeenCalledTimes(1);
  });

  it("disables the button while a crawl is being started", () => {
    renderSection({ isStartingCrawl: true });

    expect(screen.getByRole("button", { name: "Starting crawl…" })).toBeDisabled();
  });

  it("disables the button and says why while one of the runs is still running", () => {
    renderSection({ runs: [runningRun, olderRun] });

    expect(screen.getByRole("button", { name: "Crawl website" })).toBeDisabled();
    expect(screen.getByText("One crawl at a time — wait for the current one to finish.")).toBeInTheDocument();
  });

  it("shows the running crawl's live progress with a Watch link to its page, leaving it out of the history", () => {
    renderSection({ runs: [runningRun, olderRun] });

    const progressCard = screen.getByRole("status");
    expect(within(progressCard).getByText("Crawl running")).toBeInTheDocument();
    expect(within(progressCard).getByText("2:14")).toBeInTheDocument();
    expect(within(progressCard).getByText("12 of up to 50 pages · 8 waiting")).toBeInTheDocument();
    expect(within(progressCard).getByRole("link", { name: "Watch" })).toHaveAttribute(
      "href",
      "/websites/website-1/crawl-runs/crawl-run-3",
    );
    const runLinks = getHistoryLinks();
    expect(runLinks).toHaveLength(1);
    expect(runLinks[0]).toHaveAttribute("href", "/websites/website-1/crawl-runs/crawl-run-1");
  });

  it("shows no history list while the only crawl is still running", () => {
    renderSection({ runs: [runningRun] });

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "History" })).not.toBeInTheDocument();
    expect(screen.queryByText("No crawls yet.")).not.toBeInTheDocument();
  });

  it("shows why the last start failed", () => {
    renderSection({ startCrawlErrorMessage: "A crawl is already running for this website" });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not start a crawl: A crawl is already running for this website",
    );
  });

  it("shows a spinner, and no empty state, while the runs load", () => {
    renderSection({ runs: [], isLoading: true });

    expect(screen.getByRole("progressbar", { name: "Loading crawl runs" })).toBeInTheDocument();
    expect(screen.queryByText("No crawls yet.")).not.toBeInTheDocument();
  });

  it("shows the empty state, and no history, when the website has no crawls", () => {
    renderSection({ runs: [] });

    expect(screen.getByText("No crawls yet.")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "History" })).not.toBeInTheDocument();
  });

  it("shows the list's failure instead of the empty state", () => {
    renderSection({ runs: [], errorMessage: "Database unavailable" });

    expect(screen.getByRole("alert")).toHaveTextContent("Database unavailable");
    expect(screen.queryByText("No crawls yet.")).not.toBeInTheDocument();
  });

  it("renders no status region while nothing runs (an ended run's outcome lives on its own page)", () => {
    renderSection();

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByText(/One crawl at a time/)).not.toBeInTheDocument();
  });

  describe("History filtered by Crawl as", () => {
    const loggedOutRun = buildCrawlRunRecord({
      id: "logged-out-run",
      createdAt: "2026-03-05T04:06:07.000Z",
    });
    const adminRun = buildCrawlRunRecord({
      id: "admin-run",
      credentialId: "credential-1",
      isLoggedIn: true,
      credential: { id: "credential-1", name: "Admin" },
      createdAt: "2026-03-05T03:06:07.000Z",
    });
    const editorRun = buildCrawlRunRecord({
      id: "editor-run",
      credentialId: "credential-2",
      isLoggedIn: true,
      credential: { id: "credential-2", name: "Editor" },
      createdAt: "2026-03-05T02:06:07.000Z",
    });
    const deletedCredentialRun = buildCrawlRunRecord({
      id: "deleted-credential-run",
      credentialId: "credential-deleted",
      isLoggedIn: true,
      credential: { id: "credential-deleted", name: "Old login" },
      createdAt: "2026-03-05T01:06:07.000Z",
    });
    const mixedRuns = [loggedOutRun, adminRun, editorRun, deletedCredentialRun];

    /**
     * Reads where each History row links to, which names its run.
     * @returns The hrefs of the History rows, in order
     */
    function getHistoryHrefs(): (string | null)[] {
      return getHistoryLinks().map((link) => link.getAttribute("href"));
    }

    it("lists only the logged-out crawls while Logged out is picked", () => {
      renderSection({ runs: mixedRuns, selectedCredentialId: CRAWL_LOGGED_OUT_VALUE });

      expect(getHistoryHrefs()).toEqual(["/websites/website-1/crawl-runs/logged-out-run"]);
    });

    it("lists only the picked credential's crawls while a credential is picked", () => {
      renderSection({ runs: mixedRuns, selectedCredentialId: "credential-1" });

      expect(getHistoryHrefs()).toEqual(["/websites/website-1/crawl-runs/admin-run"]);
    });

    it("lists every ended crawl, a deleted credential's included, while the picker is hidden", () => {
      renderSection({ runs: mixedRuns, crawlAsPickerIsShown: false });

      expect(getHistoryHrefs()).toEqual([
        "/websites/website-1/crawl-runs/logged-out-run",
        "/websites/website-1/crawl-runs/admin-run",
        "/websites/website-1/crawl-runs/editor-run",
        "/websites/website-1/crawl-runs/deleted-credential-run",
      ]);
    });

    it("never lists a crawl made as a since-deleted credential while the picker is shown", () => {
      renderSection({ runs: mixedRuns, selectedCredentialId: "credential-2" });

      expect(getHistoryHrefs()).toEqual(["/websites/website-1/crawl-runs/editor-run"]);
      expect(screen.queryByRole("link", { name: /Old login/ })).not.toBeInTheDocument();
    });

    it("says there are no logged-out crawls, with no History list, when none of the ended crawls was logged out", () => {
      renderSection({ runs: [adminRun, editorRun], selectedCredentialId: CRAWL_LOGGED_OUT_VALUE });

      expect(screen.getByText("No logged-out crawls with links only yet.")).toBeInTheDocument();
      expect(screen.queryByRole("list", { name: "History" })).not.toBeInTheDocument();
      expect(screen.queryByText("No crawls yet.")).not.toBeInTheDocument();
    });

    it("names the picked credential when none of the ended crawls was made as it", () => {
      renderSection({ runs: [loggedOutRun, editorRun], selectedCredentialId: "credential-1" });

      expect(screen.getByText("No crawls as “Admin” with links only yet.")).toBeInTheDocument();
      expect(screen.queryByRole("list", { name: "History" })).not.toBeInTheDocument();
    });

    it("falls back to the picked credential when it is no longer among the credentials", () => {
      renderSection({ runs: [loggedOutRun], selectedCredentialId: "credential-gone" });

      expect(screen.getByText("No crawls as the picked credential with links only yet.")).toBeInTheDocument();
    });

    it("says nothing about the pick while the only crawl is still running", () => {
      renderSection({ runs: [runningRun], selectedCredentialId: "credential-1" });

      expect(screen.queryByText(/No crawls as/)).not.toBeInTheDocument();
      expect(screen.queryByText("No crawls yet.")).not.toBeInTheDocument();
    });

    it("still shows the running crawl made as someone other than the picked person", () => {
      const adminRunningRun = buildCrawlRunRecord({
        ...runningRun,
        credentialId: "credential-1",
        isLoggedIn: true,
        credential: { id: "credential-1", name: "Admin" },
      });
      renderSection({ runs: [adminRunningRun, loggedOutRun], selectedCredentialId: CRAWL_LOGGED_OUT_VALUE });

      const progressCard = screen.getByRole("status");
      expect(within(progressCard).getByText("Crawl running")).toBeInTheDocument();
      expect(within(progressCard).getByRole("link", { name: "Watch" })).toHaveAttribute(
        "href",
        "/websites/website-1/crawl-runs/crawl-run-3",
      );
      expect(screen.getByRole("button", { name: "Crawl website" })).toBeDisabled();
      expect(getHistoryHrefs()).toEqual(["/websites/website-1/crawl-runs/logged-out-run"]);
    });
  });

  describe("History filtered by Buttons", () => {
    const loggedOutLinksOnlyRun = buildCrawlRunRecord({
      id: "logged-out-links-only-run",
      createdAt: "2026-03-05T04:06:07.000Z",
    });
    const loggedOutOpenOnlyRun = buildCrawlRunRecord({
      id: "logged-out-open-only-run",
      buttonMode: "openOnly",
      createdAt: "2026-03-05T03:06:07.000Z",
    });
    const adminAllButRiskyRun = buildCrawlRunRecord({
      id: "admin-all-but-risky-run",
      credentialId: "credential-1",
      isLoggedIn: true,
      credential: { id: "credential-1", name: "Admin" },
      buttonMode: "allButRisky",
      createdAt: "2026-03-05T02:06:07.000Z",
    });
    const adminOpenOnlyRun = buildCrawlRunRecord({
      id: "admin-open-only-run",
      credentialId: "credential-1",
      isLoggedIn: true,
      credential: { id: "credential-1", name: "Admin" },
      buttonMode: "openOnly",
      createdAt: "2026-03-05T01:06:07.000Z",
    });
    const mixedRuns = [loggedOutLinksOnlyRun, loggedOutOpenOnlyRun, adminAllButRiskyRun, adminOpenOnlyRun];

    /**
     * Reads where each History row links to, which names its run.
     * @returns The hrefs of the History rows, in order
     */
    function getHistoryHrefs(): (string | null)[] {
      return getHistoryLinks().map((link) => link.getAttribute("href"));
    }

    it("lists only the crawls made with the picked mode as the picked person", () => {
      renderSection({ runs: mixedRuns, selectedCredentialId: CRAWL_LOGGED_OUT_VALUE, selectedButtonMode: "openOnly" });

      expect(getHistoryHrefs()).toEqual(["/websites/website-1/crawl-runs/logged-out-open-only-run"]);
    });

    it("needs both picks to match: a credential's crawls in another mode stay hidden", () => {
      renderSection({ runs: mixedRuns, selectedCredentialId: "credential-1", selectedButtonMode: "allButRisky" });

      expect(getHistoryHrefs()).toEqual(["/websites/website-1/crawl-runs/admin-all-but-risky-run"]);
    });

    it("filters by the mode alone while the Crawl as picker is hidden", () => {
      renderSection({ runs: mixedRuns, crawlAsPickerIsShown: false, selectedButtonMode: "openOnly" });

      expect(getHistoryHrefs()).toEqual([
        "/websites/website-1/crawl-runs/logged-out-open-only-run",
        "/websites/website-1/crawl-runs/admin-open-only-run",
      ]);
    });

    it.each([
      {
        label: "Logged out with buttons except risky ones",
        selectedCredentialId: CRAWL_LOGGED_OUT_VALUE,
        selectedButtonMode: "allButRisky" as const,
        runs: [loggedOutLinksOnlyRun, adminAllButRiskyRun],
        expectedText: "No logged-out crawls with buttons except risky ones yet.",
      },
      {
        label: "Admin with links only",
        selectedCredentialId: "credential-1",
        selectedButtonMode: "linksOnly" as const,
        runs: [loggedOutLinksOnlyRun, adminOpenOnlyRun],
        expectedText: "No crawls as “Admin” with links only yet.",
      },
      {
        label: "a credential no longer listed with only Open buttons",
        selectedCredentialId: "credential-gone",
        selectedButtonMode: "openOnly" as const,
        runs: [loggedOutOpenOnlyRun],
        expectedText: "No crawls as the picked credential with only “Open” buttons yet.",
      },
    ])("names both picks when none of the ended crawls matches $label", ({ selectedCredentialId, selectedButtonMode, runs, expectedText }) => {
      renderSection({ runs, selectedCredentialId, selectedButtonMode });

      expect(screen.getByText(expectedText)).toBeInTheDocument();
      expect(screen.queryByRole("list", { name: "History" })).not.toBeInTheDocument();
      expect(screen.queryByText("No crawls yet.")).not.toBeInTheDocument();
    });

    it("names only the mode when no ended crawl matches it while the Crawl as picker is hidden", () => {
      renderSection({ runs: [loggedOutLinksOnlyRun], crawlAsPickerIsShown: false, selectedButtonMode: "allButRisky" });

      expect(screen.getByText("No crawls with buttons except risky ones yet.")).toBeInTheDocument();
      expect(screen.queryByRole("list", { name: "History" })).not.toBeInTheDocument();
    });

    it("still shows the running crawl made in a mode other than the picked one", () => {
      const openOnlyRunningRun = buildCrawlRunRecord({ ...runningRun, buttonMode: "openOnly" });
      renderSection({ runs: [openOnlyRunningRun, loggedOutLinksOnlyRun], selectedButtonMode: "linksOnly" });

      const progressCard = screen.getByRole("status");
      expect(within(progressCard).getByText("Crawl running")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Crawl website" })).toBeDisabled();
      expect(getHistoryHrefs()).toEqual(["/websites/website-1/crawl-runs/logged-out-links-only-run"]);
    });
  });
});
