import { describe, it, expect, vi } from "vitest";
import { render, screen, within, type RenderResult } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import ActionScriptRunsSection, {
  type ActionScriptRunsSectionProps,
} from "../../src/components/ActionScriptRunsSection";
import {
  buildActionScriptRunRecord,
  buildObjectChoiceRecord,
  buildVersionParameterRecord,
  buildVersionParametersRecord,
} from "./support/frontendTestHelpers";

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
 * Builds the panel's props: a loaded two-run list of version 2 on desktop,
 * showing the newest run, with version 3 next.
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
    selectedRun: newestRun,
    onSelectRun: vi.fn(),
    isRunning: false,
    runErrorMessage: null,
    onRunClick: vi.fn(),
    versionCanBeRefined: false,
    isRefining: false,
    refineErrorMessage: null,
    onRefine: vi.fn(),
    nextVersionNumber: 3,
    isPhoneLayout: false,
    parametersView: buildVersionParametersRecord(),
    parametersErrorMessage: null,
    ...overrides,
  };
}

/**
 * Renders the panel with a loaded two-run list by default.
 * @param overrides - Props to replace in the defaults
 * @returns The Testing Library render result
 */
function renderSection(overrides: Partial<ActionScriptRunsSectionProps> = {}): RenderResult {
  return render(<ActionScriptRunsSection {...buildSectionProps(overrides)} />);
}

/**
 * Reads the outcome title in the run's status banner.
 * @returns The banner's outcome line, e.g. "Failed at step 2"
 */
function readBannerOutcome(): string {
  const outcome = screen.getByRole("status").querySelector(".MuiAlert-message > div");
  return outcome?.textContent ?? "";
}

describe("ActionScriptRunsSection", () => {
  describe("on desktop", () => {
    it("is the Latest run panel, showing the shown run and the version's runs", () => {
      renderSection();

      expect(screen.getByRole("region", { name: "Latest run" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Latest run" })).toBeInTheDocument();
      expect(readBannerOutcome()).toBe("Failed at step 2");
      expect(screen.getByRole("heading", { name: "Runs of version 2" })).toBeInTheDocument();
      const runButtons = within(screen.getByRole("list", { name: "Runs of version 2" })).getAllByRole("button");
      expect(runButtons.map((runButton) => runButton.textContent)).toEqual([
        expect.stringMatching(/^Failed at step 2/),
        expect.stringMatching(/^Passed/),
      ]);
      expect(runButtons[0]).toHaveAttribute("aria-current", "true");
    });

    it("is headed Run once an older run is shown, and reports picks from the run list", async () => {
      const user = userEvent.setup();
      const onSelectRun = vi.fn();
      renderSection({ selectedRun: olderRun, onSelectRun });

      expect(screen.getByRole("heading", { name: "Run" })).toBeInTheDocument();
      expect(readBannerOutcome()).toBe("Passed");
      const runButtons = within(screen.getByRole("list", { name: "Runs of version 2" })).getAllByRole("button");
      expect(runButtons[1]).toHaveAttribute("aria-current", "true");

      await user.click(runButtons[0]);
      expect(onSelectRun).toHaveBeenCalledWith("run-2");
    });

    it("offers Run again with a play icon, and reports clicks", async () => {
      const user = userEvent.setup();
      const onRunClick = vi.fn();
      renderSection({ onRunClick });

      const runButton = screen.getByRole("button", { name: "Run again" });
      expect(within(runButton).getByTestId("PlayArrowIcon")).toBeInTheDocument();
      await user.click(runButton);

      expect(onRunClick).toHaveBeenCalledTimes(1);
    });

    it("says Run before the first run, and shows progress and a disabled Running… while running", () => {
      const { rerender } = renderSection({ runs: [], selectedRun: null });
      expect(screen.getByRole("button", { name: "Run" })).toBeEnabled();
      expect(screen.getByRole("heading", { name: "Latest run" })).toBeInTheDocument();

      rerender(<ActionScriptRunsSection {...buildSectionProps({ runs: [], selectedRun: null, isRunning: true })} />);
      expect(screen.getByRole("button", { name: "Running…" })).toBeDisabled();
      expect(screen.getByRole("progressbar", { name: "Running script" })).toBeInTheDocument();
    });

    it("shows why a run could not start, and a failed run list", () => {
      renderSection({ runs: [], selectedRun: null, runErrorMessage: "spawn ENOENT", errorMessage: "Script not found" });

      const alerts = screen.getAllByRole("alert");
      expect(alerts.map((alert) => alert.textContent)).toEqual([
        "Could not run the script: spawn ENOENT",
        expect.stringContaining("Script not found"),
      ]);
      expect(screen.queryByText("This version has not been run yet.")).not.toBeInTheDocument();
    });

    it("says when the version has not been run", () => {
      renderSection({ runs: [], selectedRun: null });

      expect(screen.getByText("This version has not been run yet.")).toBeInTheDocument();
      expect(screen.queryByRole("list", { name: "Runs of version 2" })).not.toBeInTheDocument();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("shows a spinner while the runs load", () => {
      renderSection({ runs: [], selectedRun: null, isLoading: true });

      expect(screen.getByRole("progressbar", { name: "Loading runs" })).toBeInTheDocument();
      expect(screen.queryByText("This version has not been run yet.")).not.toBeInTheDocument();
    });
  });

  describe("on a phone", () => {
    it("is the Latest run card, with Run again beside Refine and no run list", () => {
      renderSection({
        isPhoneLayout: true,
        runs: [newerFailedRun],
        selectedRun: newerFailedRun,
        versionCanBeRefined: true,
      });

      expect(screen.getByRole("region", { name: "Latest run" })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Latest run" })).not.toBeInTheDocument();
      const runAgain = screen.getByRole("button", { name: "Run again" });
      expect(runAgain).toHaveClass("MuiButton-colorSecondary");
      expect(within(runAgain).queryByTestId("PlayArrowIcon")).not.toBeInTheDocument();
      expect(runAgain.parentElement).toBe(screen.getByRole("button", { name: "Refine" }).parentElement);
      expect(screen.queryByRole("list", { name: /^Runs of version/ })).not.toBeInTheDocument();
    });

    it("offers Run on its own before the first run", async () => {
      const user = userEvent.setup();
      const onRunClick = vi.fn();
      renderSection({ isPhoneLayout: true, runs: [], selectedRun: null, onRunClick });

      expect(screen.getByText("This version has not been run yet.")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Run" }));

      expect(onRunClick).toHaveBeenCalledTimes(1);
    });
  });

  describe("refining", () => {
    it("hands onRefine the shown failed run with the note, refining into the next version", async () => {
      const user = userEvent.setup();
      const onRefine = vi.fn();
      renderSection({
        runs: [newerFailedRun, olderFailedRun],
        selectedRun: olderFailedRun,
        versionCanBeRefined: true,
        onRefine,
      });

      await user.type(screen.getByRole("textbox", { name: NOTE_FIELD_NAME }), "Log in with the email field");
      await user.click(screen.getByRole("button", { name: "Refine into Version 3" }));

      expect(onRefine).toHaveBeenCalledWith(olderFailedRun, "Log in with the email field");
    });

    it("offers no Refine when the version cannot be refined", () => {
      renderSection({ runs: [newerFailedRun], selectedRun: newerFailedRun, versionCanBeRefined: false });

      expect(readBannerOutcome()).toBe("Failed at step 3");
      expect(screen.queryByRole("button", { name: /^Refine/ })).not.toBeInTheDocument();
    });

    it("passes the refine progress through, and disables Refine while a run is in flight", () => {
      const refinableProps = { runs: [newerFailedRun], selectedRun: newerFailedRun, versionCanBeRefined: true };
      const { rerender } = renderSection({ ...refinableProps, isRefining: true });
      expect(screen.getByRole("button", { name: "Refining…" })).toBeDisabled();
      expect(screen.getByRole("progressbar", { name: "Refining script" })).toBeInTheDocument();

      rerender(<ActionScriptRunsSection {...buildSectionProps({ ...refinableProps, isRunning: true })} />);
      expect(screen.getByRole("button", { name: "Running…" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Refine into Version 3" })).toBeDisabled();
      expect(screen.queryByRole("progressbar", { name: "Refining script" })).not.toBeInTheDocument();
    });

    it("starts the note and the refine error over when another run is shown", async () => {
      const user = userEvent.setup();
      const onRefine = vi.fn();
      const refinableProps = { runs: [newerFailedRun, olderFailedRun], versionCanBeRefined: true, onRefine };
      const { rerender } = renderSection({ ...refinableProps, selectedRun: newerFailedRun });
      await user.type(screen.getByRole("textbox", { name: NOTE_FIELD_NAME }), "Try the Profile link");
      await user.click(screen.getByRole("button", { name: "Refine into Version 3" }));
      rerender(
        <ActionScriptRunsSection
          {...buildSectionProps({
            ...refinableProps,
            selectedRun: newerFailedRun,
            refineErrorMessage: "Claude is overloaded",
          })}
        />,
      );
      expect(screen.getByRole("alert")).toHaveTextContent("Could not refine: Claude is overloaded");

      rerender(
        <ActionScriptRunsSection
          {...buildSectionProps({
            ...refinableProps,
            selectedRun: olderFailedRun,
            refineErrorMessage: "Claude is overloaded",
          })}
        />,
      );

      expect(readBannerOutcome()).toBe("Failed before the first step");
      expect(screen.getByRole("textbox", { name: NOTE_FIELD_NAME })).toHaveValue("");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  describe("the run's values", () => {
    /** A Create version: the required name, an optional added field, and a secret. */
    const createParametersView = buildVersionParametersRecord({
      parameters: [
        buildVersionParameterRecord(),
        buildVersionParameterRecord({
          id: "parameter-2",
          key: "description",
          label: "Description",
          source: "page",
          isRequired: false,
          defaultValue: "",
          uses: [],
          addedField: { target: { label: "Description" }, stepAction: "fill", afterStepNumber: 1 },
        }),
        buildVersionParameterRecord({
          id: "parameter-3",
          key: "password",
          label: "Password",
          isSecret: true,
          defaultValue: "hunter2",
          uses: [{ stepNumber: 2, field: "value" }],
        }),
      ],
    });

    it("prefills each value, and runs with only the values the user changed", async () => {
      const user = userEvent.setup();
      const onRunClick = vi.fn();
      renderSection({ parametersView: createParametersView, onRunClick });

      expect(screen.getByRole("group", { name: "Values for this run" })).toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: "Project name" })).toHaveValue("Apollo 7");
      expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue("");
      expect(
        screen.getByText("A field the steps don't fill - typed after step 1 when you give it a value"),
      ).toBeInTheDocument();
      const passwordField = screen.getByLabelText("Password *");
      expect(passwordField).toHaveAttribute("type", "password");
      expect(screen.getByText("Secret - never stored on the run")).toBeInTheDocument();

      const nameField = screen.getByRole("textbox", { name: "Project name" });
      await user.clear(nameField);
      await user.type(nameField, "Voyager");
      await user.click(screen.getByRole("button", { name: "Run again" }));

      expect(onRunClick).toHaveBeenCalledWith({ projectName: "Voyager" });
    });

    it("blocks the run while a required value is blank or a value holds {{", async () => {
      const user = userEvent.setup();
      renderSection({ parametersView: createParametersView });
      const nameField = screen.getByRole("textbox", { name: "Project name" });

      await user.clear(nameField);
      expect(screen.getByRole("button", { name: "Run again" })).toBeDisabled();
      expect(screen.getByText("Fill in Project name to run.")).toBeInTheDocument();

      await user.click(nameField);
      await user.paste("{{credential.password}}");
      expect(screen.getByText("May not contain {{")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Run again" })).toBeDisabled();
    });

    it("waits for the parameters before it lets a run start, and says when they could not load", () => {
      const { rerender } = renderSection({ parametersView: null });
      expect(screen.getByRole("button", { name: "Run again" })).toBeDisabled();

      rerender(
        <ActionScriptRunsSection
          {...buildSectionProps({ parametersView: null, parametersErrorMessage: "Script not found" })}
        />,
      );
      expect(screen.getByRole("alert")).toHaveTextContent("Could not load this version's parameters: Script not found");
      expect(screen.getByRole("button", { name: "Run again" })).toBeEnabled();
    });

    it("offers the known objects for the object, created ones described, and takes a typed name", async () => {
      const user = userEvent.setup();
      const onRunClick = vi.fn();
      const objectParametersView = buildVersionParametersRecord({
        parameters: [
          buildVersionParameterRecord({
            key: "object",
            label: "Project",
            kind: "object",
            requiredReason: "object",
            defaultValue: "Mercury",
            uses: [{ stepNumber: 1, field: "targetName" }],
          }),
        ],
        objectChoices: [
          buildObjectChoiceRecord({
            name: "Apollo 7",
            source: "created",
            createdObjectId: "created-object-1",
            createdByActionTitle: "Create a project",
            createdAt: "2026-04-03T03:04:05.000Z",
            seenOnCrawl: true,
          }),
          buildObjectChoiceRecord({
            name: "Apollo 9",
            source: "created",
            createdObjectId: "created-object-2",
            createdByActionTitle: null,
            createdAt: null,
            seenOnCrawl: false,
          }),
          buildObjectChoiceRecord(),
        ],
      });
      renderSection({ parametersView: objectParametersView, onRunClick });

      const objectField = screen.getByRole("combobox", { name: "Project" });
      expect(objectField).toHaveValue("Mercury");
      await user.click(objectField);
      await user.keyboard("{ArrowDown}");
      const listbox = await screen.findByRole("listbox");
      const optionNames = within(listbox)
        .getAllByRole("option")
        .map((option) => option.firstChild?.textContent);
      expect(optionNames).toEqual(["Apollo 7", "Apollo 9", "Mercury"]);
      expect(within(listbox).getByText(/created by a run of Create a project · .*, seen on crawl/)).toBeInTheDocument();
      expect(within(listbox).getByText("created by a run of an action")).toBeInTheDocument();
      expect(within(listbox).getByText("seen on crawl")).toBeInTheDocument();

      await user.clear(objectField);
      await user.type(objectField, "apollo");
      const narrowedNames = within(await screen.findByRole("listbox"))
        .getAllByRole("option")
        .map((option) => option.firstChild?.textContent);
      expect(narrowedNames).toEqual(["Apollo 7", "Apollo 9"]);

      await user.clear(objectField);
      await user.type(objectField, "Gemini 5");
      await user.keyboard("{Escape}");
      expect(screen.getByText("Pick a known one, or type any name")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Run again" }));
      expect(onRunClick).toHaveBeenCalledWith({ object: "Gemini 5" });
    });

    it("shows no values form for a version without parameters", () => {
      renderSection();
      expect(screen.queryByRole("group", { name: "Values for this run" })).not.toBeInTheDocument();
    });
  });
});
