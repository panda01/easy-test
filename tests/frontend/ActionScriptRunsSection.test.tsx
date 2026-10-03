import { describe, it, expect, vi } from "vitest";
import { render, screen, within, type RenderResult } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import ActionScriptRunsSection, {
  type ActionScriptRunsSectionProps,
} from "../../src/components/ActionScriptRunsSection";
import { buildActionScriptRunRecord } from "./support/frontendTestHelpers";

const newestRun = buildActionScriptRunRecord({ id: "run-2", succeeded: false, exitCode: 1 });
const olderRun = buildActionScriptRunRecord({ id: "run-1" });

/**
 * Renders the section with a loaded two-run list by default.
 * @param overrides - Props to replace in the defaults
 * @returns The Testing Library render result
 */
function renderSection(overrides: Partial<ActionScriptRunsSectionProps> = {}): RenderResult {
  const props: ActionScriptRunsSectionProps = {
    websiteId: "website-1",
    versionNumber: 2,
    runs: [newestRun, olderRun],
    isLoading: false,
    errorMessage: null,
    selectedRunId: null,
    onSelectRun: vi.fn(),
    isRunning: false,
    runErrorMessage: null,
    onRunClick: vi.fn(),
    ...overrides,
  };
  return render(<ActionScriptRunsSection {...props} />);
}

describe("ActionScriptRunsSection", () => {
  it("names the version, explains what running does, and shows the newest run by default", () => {
    renderSection();

    expect(screen.getByRole("heading", { name: "Runs of version 2" })).toBeInTheDocument();
    expect(screen.getByText(/opens a browser window on this computer/)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Failed · exit code 1");
  });

  it("shows the selected run and reports picks from the history", async () => {
    const user = userEvent.setup();
    const onSelectRun = vi.fn();
    renderSection({ selectedRunId: "run-1", onSelectRun });

    expect(screen.getByRole("status")).toHaveTextContent("Passed");
    const historyButtons = within(screen.getByRole("list", { name: "Run history" })).getAllByRole("button");
    await user.click(historyButtons[0]);
    expect(onSelectRun).toHaveBeenCalledWith("run-2");
  });

  it("reports Run clicks, and shows progress and a disabled button while running", async () => {
    const user = userEvent.setup();
    const onRunClick = vi.fn();
    const { rerender } = renderSection({ onRunClick });

    await user.click(screen.getByRole("button", { name: "Run script" }));
    expect(onRunClick).toHaveBeenCalledTimes(1);

    rerender(
      <ActionScriptRunsSection
        websiteId="website-1"
        versionNumber={2}
        runs={[]}
        isLoading={false}
        errorMessage={null}
        selectedRunId={null}
        onSelectRun={vi.fn()}
        isRunning
        runErrorMessage={null}
        onRunClick={onRunClick}
      />,
    );
    expect(screen.getByRole("button", { name: "Running…" })).toBeDisabled();
    expect(screen.getByRole("progressbar", { name: "Running script" })).toBeInTheDocument();
  });

  it("shows why a run could not start, and a failed run list", () => {
    renderSection({ runs: [], runErrorMessage: "spawn ENOENT", errorMessage: "Script not found" });

    const alerts = screen.getAllByRole("alert");
    expect(alerts.map((alert) => alert.textContent)).toEqual([
      "Could not run the script: spawn ENOENT",
      expect.stringContaining("Script not found"),
    ]);
    expect(screen.queryByText("This version has not been run yet.")).not.toBeInTheDocument();
  });

  it("says when the version has not been run", () => {
    renderSection({ runs: [] });

    expect(screen.getByText("This version has not been run yet.")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Run history" })).not.toBeInTheDocument();
  });
});
