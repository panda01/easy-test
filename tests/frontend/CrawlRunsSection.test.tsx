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

const newestRun = buildCrawlRunRecord({
  id: "crawl-run-2",
  status: "stoppedAtPageLimit",
  visitedPageCount: 50,
  createdAt: "2026-03-05T05:06:07.000Z",
});
const olderRun = buildCrawlRunRecord({
  id: "crawl-run-1",
  status: "failed",
  visitedPageCount: 0,
  createdAt: "2026-03-04T05:06:07.000Z",
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
    ...overrides,
  };
  return render(
    <MemoryRouter>
      <CrawlRunsSection {...props} />
    </MemoryRouter>,
  );
}

describe("CrawlRunsSection", () => {
  it("is a region named Crawls that explains what a crawl does", () => {
    renderSection();

    const section = screen.getByRole("region", { name: "Crawls" });
    expect(section).toHaveTextContent("follows every link to another page on the same site");
    expect(section).toHaveTextContent("up to 50 pages or 10 minutes");
    expect(section).toHaveTextContent(
      "With buttons on, it also clicks buttons and follows the ones that open another page on the site; risky ones (create, delete, update, log out, pay, confirm, ...) are never clicked.",
    );
    expect(section).toHaveTextContent("Crawling as a credential logs in first");
  });

  it("hides the Crawl as picker and its login sentence, keeping the Buttons picker, when told to", () => {
    renderSection({ crawlAsPickerIsShown: false });

    const section = screen.getByRole("region", { name: "Crawls" });
    expect(screen.queryByRole("combobox", { name: /^Crawl as/ })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /^Buttons/ })).toBeInTheDocument();
    expect(section).not.toHaveTextContent("Crawling as a credential");
    expect(screen.getByRole("button", { name: "Crawl website" })).toBeEnabled();
  });

  it("shows the Buttons picker reading Links only by default, offering every mode", async () => {
    const user = userEvent.setup();
    renderSection();

    const buttonsPicker = screen.getByRole("combobox", { name: /^Buttons/ });
    expect(buttonsPicker).toHaveTextContent("Links only (no buttons)");
    await user.click(buttonsPicker);
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

    await user.click(screen.getByRole("combobox", { name: /^Buttons/ }));
    await user.click(await screen.findByRole("option", { name: optionName }));

    expect(onSelectedButtonModeChange).toHaveBeenCalledWith(buttonMode);
  });

  it("shows the picked button mode", () => {
    renderSection({ selectedButtonMode: "openOnly" });

    expect(screen.getByRole("combobox", { name: /^Buttons/ })).toHaveTextContent(
      "Only “Open” buttons",
    );
  });

  it("lists every run, newest first, each linking to its own page with its date", () => {
    renderSection();

    const history = screen.getByRole("list", { name: "Crawl history" });
    const runLinks = within(history).getAllByRole("link");
    expect(runLinks).toHaveLength(2);
    expect(runLinks[0]).toHaveTextContent("Stopped at the 50-page limit · 50 pages");
    expect(runLinks[0]).toHaveTextContent(new Date(newestRun.createdAt).toLocaleString());
    expect(runLinks[0]).toHaveAttribute("href", "/websites/website-1/crawl-runs/crawl-run-2");
    expect(runLinks[1]).toHaveTextContent("Failed · 0 pages");
  });

  it("says in each history row who the crawl viewed the site as", () => {
    renderSection({
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
          credentialId: "credential-2",
          credential: { id: "credential-2", name: "Editor" },
        }),
        buildCrawlRunRecord({ id: "logged-out-run" }),
      ],
    });

    const runLinks = within(screen.getByRole("list", { name: "Crawl history" })).getAllByRole(
      "link",
    );
    expect(runLinks[0]).toHaveTextContent('Logged in as "Admin"');
    expect(runLinks[1]).toHaveTextContent('Not logged in - the login as "Editor" did not succeed');
    expect(runLinks[2]).toHaveTextContent("Crawled logged out (no credential)");
  });

  it("adds which buttons a run clicked to its history row, unless it only followed links", () => {
    renderSection({
      runs: [
        buildCrawlRunRecord({ id: "risky-run", buttonMode: "allButRisky" }),
        buildCrawlRunRecord({ id: "open-run", buttonMode: "openOnly" }),
        buildCrawlRunRecord({ id: "links-run", buttonMode: "linksOnly" }),
      ],
    });

    const runLinks = within(screen.getByRole("list", { name: "Crawl history" })).getAllByRole(
      "link",
    );
    expect(runLinks[0]).toHaveTextContent(
      /Crawled logged out \(no credential\) · clicked buttons except risky ones$/,
    );
    expect(runLinks[1]).toHaveTextContent(
      /Crawled logged out \(no credential\) · clicked only “Open” buttons$/,
    );
    expect(runLinks[2]).toHaveTextContent(/Crawled logged out \(no credential\)$/);
  });

  it("shows the Crawl as picker reading Logged out by default, offering every credential", async () => {
    const user = userEvent.setup();
    renderSection();

    const crawlAsPicker = screen.getByRole("combobox", { name: /^Crawl as/ });
    expect(crawlAsPicker).toHaveTextContent("Logged out (no credential)");
    await user.click(crawlAsPicker);
    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "Logged out (no credential)",
      "Admin",
      "Editor",
    ]);
  });

  it("shows the picked credential and hands a newly picked one's id to the page", async () => {
    const user = userEvent.setup();
    const onSelectedCredentialChange = vi.fn();
    renderSection({ selectedCredentialId: "credential-1", onSelectedCredentialChange });

    const crawlAsPicker = screen.getByRole("combobox", { name: /^Crawl as/ });
    expect(crawlAsPicker).toHaveTextContent("Admin");
    await user.click(crawlAsPicker);
    await user.click(await screen.findByRole("option", { name: "Editor" }));

    expect(onSelectedCredentialChange).toHaveBeenCalledWith("credential-2");
  });

  it("hands back the logged-out value when Logged out is picked again", async () => {
    const user = userEvent.setup();
    const onSelectedCredentialChange = vi.fn();
    renderSection({ selectedCredentialId: "credential-1", onSelectedCredentialChange });

    await user.click(screen.getByRole("combobox", { name: /^Crawl as/ }));
    await user.click(await screen.findByRole("option", { name: "Logged out (no credential)" }));

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

  it("disables the button while one of the runs is still running", () => {
    renderSection({ runs: [buildCrawlRunRecord({ status: "running" }), olderRun] });

    expect(screen.getByRole("button", { name: "Crawl running…" })).toBeDisabled();
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
    expect(screen.queryByRole("list", { name: "Crawl history" })).not.toBeInTheDocument();
  });

  it("shows the list's failure instead of the empty state", () => {
    renderSection({ runs: [], errorMessage: "Database unavailable" });

    expect(screen.getByRole("alert")).toHaveTextContent("Database unavailable");
    expect(screen.queryByText("No crawls yet.")).not.toBeInTheDocument();
  });

  it("renders no status region (a run's outcome lives on its own page)", () => {
    renderSection();

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
