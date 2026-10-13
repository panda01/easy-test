import { describe, it, expect, vi } from "vitest";
import { render, screen, within, type RenderResult } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import ActionScriptRunsSection, {
  type ActionScriptRunsSectionProps,
} from "../../src/components/ActionScriptRunsSection";
import { buildActionScriptRunRecord } from "./support/frontendTestHelpers";

const newestRun = buildActionScriptRunRecord({ id: "run-2", succeeded: false, failedStepNumber: 2 });
const olderRun = buildActionScriptRunRecord({ id: "run-1" });

const NOTE_FIELD_NAME = "Note for Claude (optional)";

/** Two failed runs with error messages, newest first - both can be refined. */
const newerFailedRun = buildActionScriptRunRecord({
  id: "run-4",
  succeeded: false,
  failedStepNumber: 3,
  errorMessage: 'Step 3 (Click link "Account"): Timeout 10000ms exceeded.',
});
const olderFailedRun = buildActionScriptRunRecord({
  id: "run-3",
  succeeded: false,
  failedStepNumber: null,
  errorMessage: 'Could not log in as "Admin": the password field was not found',
});

/**
 * Builds the section's props: a loaded two-run list of a logged-out action by default.
 * @param overrides - Props to replace in the defaults
 * @returns The complete props
 */
function buildSectionProps(
  overrides: Partial<ActionScriptRunsSectionProps> = {},
): ActionScriptRunsSectionProps {
  return {
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
    credentialName: null,
    versionCanBeRefined: false,
    isRefining: false,
    refineErrorMessage: null,
    onRefine: vi.fn(),
    ...overrides,
  };
}

/**
 * Renders the section with a loaded two-run list by default.
 * @param overrides - Props to replace in the defaults
 * @returns The Testing Library render result
 */
function renderSection(overrides: Partial<ActionScriptRunsSectionProps> = {}): RenderResult {
  return render(<ActionScriptRunsSection {...buildSectionProps(overrides)} />);
}

describe("ActionScriptRunsSection", () => {
  it("names the version, explains what running a logged-out action does, and shows the newest run by default", () => {
    renderSection();

    expect(screen.getByRole("heading", { name: "Runs of version 2" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Running opens a browser window on this computer, runs logged out, and works through the plan's steps. A run is stopped after 5 minutes.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Failed at step 2");
  });

  it("says a run logs in first when the action has a credential", () => {
    renderSection({ credentialName: "Admin" });

    expect(
      screen.getByText(
        'Running opens a browser window on this computer, logs in as "Admin", and works through the plan\'s steps. A run is stopped after 5 minutes.',
      ),
    ).toBeInTheDocument();
  });

  it("shows the selected run and reports picks from the history", async () => {
    const user = userEvent.setup();
    const onSelectRun = vi.fn();
    renderSection({ selectedRunId: "run-1", onSelectRun });

    expect(screen.getByRole("status")).toHaveTextContent("Passed");
    const historyButtons = within(screen.getByRole("list", { name: "Run history" })).getAllByRole("button");
    expect(historyButtons.map((historyButton) => historyButton.textContent)).toEqual([
      expect.stringMatching(/^Failed at step 2/),
      expect.stringMatching(/^Passed/),
    ]);
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
      <ActionScriptRunsSection {...buildSectionProps({ runs: [], isRunning: true, onRunClick })} />,
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

  describe("refining", () => {
    it("hands onRefine the selected failed run with the note", async () => {
      const user = userEvent.setup();
      const onRefine = vi.fn();
      renderSection({
        runs: [newerFailedRun, olderFailedRun],
        selectedRunId: "run-3",
        versionCanBeRefined: true,
        onRefine,
      });

      await user.type(screen.getByRole("textbox", { name: NOTE_FIELD_NAME }), "Log in with the email field");
      await user.click(screen.getByRole("button", { name: "Refine" }));

      expect(onRefine).toHaveBeenCalledWith(olderFailedRun, "Log in with the email field");
    });

    it("offers no Refine when the version cannot be refined", () => {
      renderSection({ runs: [newerFailedRun], versionCanBeRefined: false });

      expect(screen.getByRole("status")).toHaveTextContent("Failed at step 3");
      expect(screen.queryByRole("button", { name: "Refine" })).not.toBeInTheDocument();
    });

    it("passes the refine progress through, and disables Refine while a run is in flight", () => {
      const { rerender } = renderSection({
        runs: [newerFailedRun],
        versionCanBeRefined: true,
        isRefining: true,
      });
      expect(screen.getByRole("button", { name: "Refining…" })).toBeDisabled();
      expect(screen.getByRole("progressbar", { name: "Refining script" })).toBeInTheDocument();

      rerender(
        <ActionScriptRunsSection
          {...buildSectionProps({ runs: [newerFailedRun], versionCanBeRefined: true, isRunning: true })}
        />,
      );
      expect(screen.getByRole("button", { name: "Running…" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Refine" })).toBeDisabled();
      expect(screen.queryByRole("progressbar", { name: "Refining script" })).not.toBeInTheDocument();
    });

    it("starts the note and the refine error over when another run is picked", async () => {
      const user = userEvent.setup();
      const onRefine = vi.fn();
      const refinableProps = { runs: [newerFailedRun, olderFailedRun], versionCanBeRefined: true, onRefine };
      const { rerender } = renderSection({ ...refinableProps, selectedRunId: "run-4" });
      await user.type(screen.getByRole("textbox", { name: NOTE_FIELD_NAME }), "Try the Profile link");
      await user.click(screen.getByRole("button", { name: "Refine" }));
      rerender(
        <ActionScriptRunsSection
          {...buildSectionProps({
            ...refinableProps,
            selectedRunId: "run-4",
            refineErrorMessage: "Claude is overloaded",
          })}
        />,
      );
      expect(screen.getByRole("alert")).toHaveTextContent("Could not refine: Claude is overloaded");

      rerender(
        <ActionScriptRunsSection
          {...buildSectionProps({
            ...refinableProps,
            selectedRunId: "run-3",
            refineErrorMessage: "Claude is overloaded",
          })}
        />,
      );

      expect(screen.getByRole("status")).toHaveTextContent("Failed before the first step");
      expect(screen.getByRole("textbox", { name: NOTE_FIELD_NAME })).toHaveValue("");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });
});
