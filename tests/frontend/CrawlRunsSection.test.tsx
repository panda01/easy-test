import { describe, it, expect, vi } from "vitest";
import { render, screen, within, type RenderResult } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import CrawlRunsSection, { type CrawlRunsSectionProps } from "../../src/components/CrawlRunsSection";
import { buildCrawlRunRecord } from "./support/frontendTestHelpers";

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
    expect(section).toHaveTextContent("it only follows links - it never clicks buttons");
    expect(section).toHaveTextContent("up to 50 pages or 10 minutes");
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
