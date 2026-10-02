import { describe, it, expect, vi } from "vitest";
import { render, screen, within, type RenderResult } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import ScreenshotRunsSection, {
  type ScreenshotRunsSectionProps,
} from "../../src/components/ScreenshotRunsSection";
import { buildScreenshotRunRecord } from "./support/frontendTestHelpers";

const newestRun = buildScreenshotRunRecord({
  id: "run-2",
  succeeded: false,
  httpStatus: 404,
  errorMessage: "The page responded with HTTP 404",
  createdAt: "2026-03-02T00:00:00.000Z",
});
const olderRun = buildScreenshotRunRecord({ id: "run-1", createdAt: "2026-03-01T00:00:00.000Z" });

/**
 * Renders the section with a loaded two-run list by default.
 * @param overrides - Props to replace in the defaults
 * @returns The Testing Library render result
 */
function renderSection(overrides: Partial<ScreenshotRunsSectionProps> = {}): RenderResult {
  const props: ScreenshotRunsSectionProps = {
    websiteId: "website-1",
    networkIdleTimeoutMs: 5000,
    screenshotMinimumWaitMs: 300,
    runs: [newestRun, olderRun],
    isLoading: false,
    errorMessage: null,
    selectedRunId: null,
    onSelectRun: vi.fn(),
    isTakingScreenshot: false,
    takeScreenshotErrorMessage: null,
    ...overrides,
  };
  return render(<ScreenshotRunsSection {...props} />);
}

/**
 * Finds the run history list.
 * @returns The list element named "Run history"
 */
function getRunHistory(): HTMLElement {
  return screen.getByRole("list", { name: "Run history" });
}

describe("ScreenshotRunsSection", () => {
  it("is a section named by its Screenshots heading", () => {
    renderSection();

    const section = screen.getByRole("region", { name: "Screenshots" });
    expect(
      within(section).getByRole("heading", { level: 2, name: "Screenshots" }),
    ).toBeInTheDocument();
  });

  it("says when screenshots are taken, from the website's timing settings", () => {
    renderSection({ networkIdleTimeoutMs: 4000, screenshotMinimumWaitMs: 1000 });

    expect(
      screen.getByText(
        "Before each screenshot: waits up to 4000 ms for network requests to finish, then for the page to paint, and at least 1000 ms after the page loads. If the network is still busy after 4000 ms, the screenshot is taken right away.",
      ),
    ).toBeInTheDocument();
  });

  it("says it doesn't wait for network requests when the cap is 0", () => {
    renderSection({ networkIdleTimeoutMs: 0, screenshotMinimumWaitMs: 0 });

    expect(
      screen.getByText(
        "Before each screenshot: doesn't wait for network requests; takes it at least 0 ms after the page loads.",
      ),
    ).toBeInTheDocument();
  });

  it("shows a spinner, and no empty state, while the runs load", () => {
    renderSection({ runs: [], isLoading: true });

    expect(screen.getByRole("progressbar", { name: "Loading screenshot runs" })).toBeInTheDocument();
    expect(screen.queryByText("No screenshots yet.")).not.toBeInTheDocument();
  });

  it("shows the run list's error in an alert, and no empty state", () => {
    renderSection({ runs: [], errorMessage: "Database unavailable" });

    expect(screen.getByRole("alert")).toHaveTextContent("Database unavailable");
    expect(screen.queryByText("No screenshots yet.")).not.toBeInTheDocument();
  });

  it("shows the empty state, and no run history, when the website has no runs", () => {
    renderSection({ runs: [] });

    expect(screen.getByText("No screenshots yet.")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Run history" })).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows the newest run when none is selected", () => {
    renderSection();

    expect(screen.getByRole("status")).toHaveTextContent("Failed · HTTP 404");
    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      "/api/websites/website-1/screenshot-runs/run-2/screenshot",
    );
  });

  it("shows the selected run", () => {
    renderSection({ selectedRunId: "run-1" });

    expect(screen.getByRole("status")).toHaveTextContent("Succeeded · HTTP 200");
    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      "/api/websites/website-1/screenshot-runs/run-1/screenshot",
    );
  });

  it("falls back to the newest run when the selected id is not in the list", () => {
    renderSection({ selectedRunId: "run-of-another-website" });

    expect(screen.getByRole("status")).toHaveTextContent("Failed · HTTP 404");
  });

  it("lists every run newest first, marking the shown run as current", () => {
    renderSection({ selectedRunId: "run-1" });

    const historyItems = within(getRunHistory()).getAllByRole("button");
    expect(historyItems).toHaveLength(2);
    expect(historyItems[0]).toHaveTextContent("Failed · HTTP 404");
    expect(historyItems[0]).not.toHaveAttribute("aria-current");
    expect(historyItems[1]).toHaveTextContent("Succeeded · HTTP 200");
    expect(historyItems[1]).toHaveAttribute("aria-current", "true");
  });

  it("asks the page to select a run when it is clicked in the history", async () => {
    const user = userEvent.setup();
    const handleSelectRun = vi.fn();
    renderSection({ onSelectRun: handleSelectRun });

    await user.click(within(getRunHistory()).getByRole("button", { name: /Succeeded · HTTP 200/ }));

    expect(handleSelectRun).toHaveBeenCalledWith("run-1");
  });

  it("shows a progress bar while a screenshot is being taken", () => {
    renderSection({ isTakingScreenshot: true });

    expect(screen.getByRole("progressbar", { name: "Taking screenshot" })).toBeInTheDocument();
  });

  it("shows no progress bar when no screenshot is being taken", () => {
    renderSection();

    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("shows why taking a screenshot failed in an alert, alongside the existing runs", () => {
    renderSection({ takeScreenshotErrorMessage: "browserType.launch: Executable doesn't exist" });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not take a screenshot: browserType.launch: Executable doesn't exist",
    );
    expect(getRunHistory()).toBeInTheDocument();
  });
});
