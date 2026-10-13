import { describe, it, expect, vi } from "vitest";
import { render, screen, within, type RenderResult } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import ActionScriptDetails, {
  type ActionScriptDetailsProps,
} from "../../src/components/ActionScriptDetails";
import { type ScriptModelOption } from "../../src/hooks/useScriptModels";
import { formatPlanJson } from "../../src/utils/actionPlanSteps";
import { type CurrentActionText } from "../../src/utils/describeScriptStaleness";
import {
  buildActionScriptRecord,
  buildActionScriptRefinementRecord,
  buildScriptModelCatalog,
} from "./support/frontendTestHelpers";

const catalogModels: ScriptModelOption[] = buildScriptModelCatalog().models;

/** The action as it is now - the same text and (no) credential the default plan was generated from. */
const currentAction: CurrentActionText = {
  title: "Log in",
  description: "Sign in with a valid account",
  credentialId: null,
};

/**
 * Builds the component's props: version 3, the default generated plan, an
 * up-to-date action, and no save in progress.
 * @param overrides - Props to replace in the defaults
 * @returns The complete props
 */
function buildDetailsProps(overrides: Partial<ActionScriptDetailsProps> = {}): ActionScriptDetailsProps {
  return {
    script: buildActionScriptRecord(),
    versionNumber: 3,
    editedFromVersionNumber: null,
    refinedFromVersionNumber: null,
    currentAction,
    catalogModels,
    isSavingEdit: false,
    saveEditErrorMessage: null,
    onSaveEdit: vi.fn(),
    ...overrides,
  };
}

/**
 * Renders one version's details with the default props.
 * @param overrides - Props to replace in the defaults
 * @returns The Testing Library render result
 */
function renderDetails(overrides: Partial<ActionScriptDetailsProps> = {}): RenderResult {
  return render(<ActionScriptDetails {...buildDetailsProps(overrides)} />);
}

/**
 * Reads the step sentences of the read-only step list.
 * @returns Each listed step's text, in order
 */
function readListedSteps(): string[] {
  const stepList = screen.getByRole("list", { name: "Plan steps" });
  return within(stepList)
    .getAllByRole("listitem")
    .map((stepItem) => stepItem.textContent);
}

/** A version Claude refined from the failed run of version 1 (see `buildActionScriptRefinementRecord`). */
const refinedScript = buildActionScriptRecord({
  id: "script-2",
  refinement: buildActionScriptRefinementRecord(),
});

/**
 * Reads the "Refined from" block as term / definition pairs.
 * @returns Each term's text followed by its definition's text, in order
 */
function readRefinedFromDetails(): string[] {
  const refinedFromHeading = screen.getByRole("heading", { name: "Refined from" });
  const definitionList = refinedFromHeading.nextElementSibling;
  if (definitionList === null) {
    throw new Error("The Refined from heading has no definition list after it");
  }
  return Array.from(definitionList.children).map((termOrDefinition) => termOrDefinition.textContent);
}

describe("ActionScriptDetails", () => {
  it("shows the version, how it was generated, the summary, the assumptions, the steps, the pages, and the JSON", () => {
    const script = buildActionScriptRecord();
    renderDetails({ script });

    expect(screen.getByRole("heading", { name: "Version 3" })).toBeInTheDocument();
    expect(
      screen.getByText(/^Generated .+ · Claude Opus 5\.5 \(claude-opus-5-5\) · high effort · Runs logged out$/),
    ).toBeInTheDocument();
    expect(screen.getByText("Opens the site and signs in.")).toBeInTheDocument();
    const assumptions = screen.getByRole("list", { name: "Assumptions" });
    expect(within(assumptions).getByText("The sign-in button is labelled Sign in")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Steps" })).toBeInTheDocument();
    expect(screen.getByText("Starts at https://example.com/")).toBeInTheDocument();
    expect(readListedSteps()).toEqual(['Click link "Sign in"', 'Check that heading "Welcome" is visible']);
    const contextPages = screen.getByRole("list", { name: "Pages given to Claude" });
    expect(within(contextPages).getAllByRole("listitem").map((pageItem) => pageItem.textContent)).toEqual([
      "https://example.com/",
    ]);
    expect(screen.getByRole("heading", { name: "Plan JSON" })).toBeInTheDocument();
    expect(screen.getByLabelText("Plan JSON").textContent).toBe(formatPlanJson(script.plan));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says who a version logs in as", () => {
    renderDetails({
      script: buildActionScriptRecord({ credentialId: "credential-1", credentialName: "Admin" }),
      currentAction: { ...currentAction, credentialId: "credential-1" },
    });

    expect(screen.getByText(/ · Logs in as "Admin" first$/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says when a generated version's model was not recorded", () => {
    renderDetails({ script: buildActionScriptRecord({ modelId: null, effort: null }) });

    expect(screen.getByText(/^Generated .+ · unknown model · Runs logged out$/)).toBeInTheDocument();
  });

  it("names the version an edited version was saved from, or says it was an earlier one", () => {
    const editedScript = buildActionScriptRecord({
      id: "script-2",
      editedFromActionScriptId: "script-1",
      modelId: null,
      effort: null,
    });
    const { rerender } = renderDetails({ script: editedScript, editedFromVersionNumber: 1 });

    expect(screen.getByText(/^Edited .+ from Version 1 · Runs logged out$/)).toBeInTheDocument();

    rerender(<ActionScriptDetails {...buildDetailsProps({ script: editedScript, editedFromVersionNumber: null })} />);
    expect(screen.getByText(/^Edited .+ from an earlier version · Runs logged out$/)).toBeInTheDocument();
  });

  it("says so when Claude recorded no assumptions", () => {
    renderDetails({ script: buildActionScriptRecord({ assumptions: [] }) });

    expect(screen.getByText("No assumptions recorded.")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Assumptions" })).not.toBeInTheDocument();
  });

  it("says Claude was shown no pages when the website had not been crawled", () => {
    renderDetails({ script: buildActionScriptRecord({ contextPageUrls: [] }) });

    expect(
      screen.getByText("None - the website had not been crawled. Crawl it, then convert again for a better plan."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Pages given to Claude" })).not.toBeInTheDocument();
  });

  it("always shows the title and description the version was generated from", () => {
    renderDetails();

    expect(screen.getByRole("heading", { name: "Generated from" })).toBeInTheDocument();
    expect(screen.getByText("Log in")).toBeInTheDocument();
    expect(screen.getByText("Sign in with a valid account")).toBeInTheDocument();
    expect(screen.queryByText("Out of date")).not.toBeInTheDocument();
  });

  it.each<[string, CurrentActionText]>([
    ["title", { ...currentAction, title: "Log in to the shop" }],
    ["description", { ...currentAction, description: "A new description" }],
    ["credential", { ...currentAction, credentialId: "credential-1" }],
    ["title and description", { ...currentAction, title: "Log in to the shop", description: "A new description" }],
    [
      "title, description and credential",
      { title: "Log in to the shop", description: "A new description", credentialId: "credential-1" },
    ],
  ])("warns that the version is out of date when the %s changed", (changedText, action) => {
    renderDetails({ currentAction: action });

    const warning = screen.getByRole("alert");
    expect(warning).toHaveTextContent("Out of date");
    expect(warning).toHaveTextContent(
      `This version was generated from a different ${changedText} than the action has now. Convert again to get a plan for the current action.`,
    );
  });

  it("opens the step editor on Edit steps, and closes it again on Cancel without saving", async () => {
    const user = userEvent.setup();
    const onSaveEdit = vi.fn();
    renderDetails({ onSaveEdit });

    await user.click(screen.getByRole("button", { name: "Edit steps" }));

    expect(screen.getByRole("textbox", { name: "Plan name" })).toHaveValue("Log in");
    expect(screen.getByRole("list", { name: "Steps being edited" })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Plan steps" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit steps" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("textbox", { name: "Plan name" })).not.toBeInTheDocument();
    expect(readListedSteps()).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Edit steps" })).toBeInTheDocument();
    expect(onSaveEdit).not.toHaveBeenCalled();
  });

  it("hands the edited plan to onSaveEdit", async () => {
    const user = userEvent.setup();
    const onSaveEdit = vi.fn();
    const script = buildActionScriptRecord();
    renderDetails({ script, onSaveEdit });

    await user.click(screen.getByRole("button", { name: "Edit steps" }));
    await user.click(screen.getByRole("button", { name: "Delete step 2" }));
    await user.click(screen.getByRole("button", { name: "Save as new version" }));

    expect(onSaveEdit).toHaveBeenCalledWith({ ...script.plan, steps: [script.plan.steps[0]] });
  });

  it("passes the save state through to the editor once it has tried to save", async () => {
    const user = userEvent.setup();
    const onSaveEdit = vi.fn();
    const { rerender } = renderDetails({ onSaveEdit });
    await user.click(screen.getByRole("button", { name: "Edit steps" }));
    await user.click(screen.getByRole("button", { name: "Delete step 2" }));
    await user.click(screen.getByRole("button", { name: "Save as new version" }));

    rerender(<ActionScriptDetails {...buildDetailsProps({ onSaveEdit, isSavingEdit: true })} />);
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Plan name" })).toBeDisabled();

    rerender(
      <ActionScriptDetails
        {...buildDetailsProps({ onSaveEdit, saveEditErrorMessage: "Plan is invalid" })}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Could not save: Plan is invalid");
  });

  it("does not show a save error left over from an editor that was cancelled", async () => {
    const user = userEvent.setup();
    const onSaveEdit = vi.fn();
    const { rerender } = renderDetails({ onSaveEdit });
    await user.click(screen.getByRole("button", { name: "Edit steps" }));
    await user.click(screen.getByRole("button", { name: "Delete step 2" }));
    await user.click(screen.getByRole("button", { name: "Save as new version" }));
    rerender(
      <ActionScriptDetails
        {...buildDetailsProps({ onSaveEdit, saveEditErrorMessage: "Plan is invalid" })}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Could not save: Plan is invalid");

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Edit steps" }));

    expect(screen.queryByText(/Could not save/)).not.toBeInTheDocument();
  });

  describe("refined versions", () => {
    it("names the version and the model a refined version came from, or says it was an earlier one", () => {
      const { rerender } = renderDetails({ script: refinedScript, refinedFromVersionNumber: 1 });

      expect(
        screen.getByText(
          /^Refined .+ from Version 1 · Claude Opus 5\.5 \(claude-opus-5-5\) · high effort · Runs logged out$/,
        ),
      ).toBeInTheDocument();

      rerender(
        <ActionScriptDetails
          {...buildDetailsProps({ script: refinedScript, refinedFromVersionNumber: null })}
        />,
      );
      expect(
        screen.getByText(/^Refined .+ from an earlier version · Claude Opus 5\.5 \(claude-opus-5-5\) · high effort · Runs logged out$/),
      ).toBeInTheDocument();
      expect(readRefinedFromDetails().slice(0, 2)).toEqual(["Version", "an earlier version"]);
    });

    it("says when a refined version's model was not recorded", () => {
      renderDetails({
        script: buildActionScriptRecord({ ...refinedScript, modelId: null, effort: null }),
        refinedFromVersionNumber: 1,
      });

      expect(screen.getByText(/^Refined .+ from Version 1 · unknown model · Runs logged out$/)).toBeInTheDocument();
    });

    it("shows what it was refined from: the version, the failed run, its error, the note, what Claude was sent, and the tokens", () => {
      renderDetails({ script: refinedScript, refinedFromVersionNumber: 1 });

      expect(readRefinedFromDetails()).toEqual([
        "Version",
        "Version 1",
        "Failed run",
        "Failed at step 2",
        "Error",
        'Step 2 (Click link "Account"): Timeout 10000ms exceeded.',
        "Your note",
        "The link is called Profile now",
        "Sent to Claude",
        "The plan, the error, and the step log, plus the failure screenshot and the failing page snapshot",
        "Tokens used",
        "2,408 input · 9,519 read from cache · 1,292 written to cache · 989 output",
      ]);
    });

    it("leaves out the note and the error when there are none", () => {
      const refinement = buildActionScriptRefinementRecord({ note: null });
      renderDetails({
        script: buildActionScriptRecord({
          ...refinedScript,
          refinement: {
            ...refinement,
            actionScriptRun: { ...refinement.actionScriptRun, errorMessage: null },
          },
        }),
        refinedFromVersionNumber: 1,
      });

      const refinedFromDetails = readRefinedFromDetails();
      expect(refinedFromDetails).not.toContain("Your note");
      expect(refinedFromDetails).not.toContain("Error");
      expect(refinedFromDetails).toContain("Sent to Claude");
    });

    it.each<[string, boolean, string | null, string]>([
      [
        "the screenshot alone",
        true,
        null,
        "The plan, the error, and the step log, plus the failure screenshot",
      ],
      [
        "the failing page snapshot alone",
        false,
        '- link "Profile"',
        "The plan, the error, and the step log, plus the failing page snapshot",
      ],
      [
        "neither the screenshot nor the snapshot",
        false,
        null,
        "The plan, the error, and the step log (no screenshot or failing page snapshot was available)",
      ],
    ])("says when Claude was sent %s", (_sentText, screenshotWasSent, failingPageAriaSnapshot, expectedText) => {
      const refinement = buildActionScriptRefinementRecord({ screenshotWasSent });
      renderDetails({
        script: buildActionScriptRecord({
          ...refinedScript,
          refinement: {
            ...refinement,
            actionScriptRun: { ...refinement.actionScriptRun, failingPageAriaSnapshot },
          },
        }),
        refinedFromVersionNumber: 1,
      });

      const refinedFromDetails = readRefinedFromDetails();
      expect(refinedFromDetails[refinedFromDetails.indexOf("Sent to Claude") + 1]).toBe(expectedText);
    });

    it.each<[string, number | null, boolean]>([
      ["Failed before the first step", null, false],
      ["Timed out · stopped after 5 min", 4, true],
    ])("describes a failed run that %s", (expectedOutcome, failedStepNumber, timedOut) => {
      const refinement = buildActionScriptRefinementRecord();
      renderDetails({
        script: buildActionScriptRecord({
          ...refinedScript,
          refinement: {
            ...refinement,
            actionScriptRun: { ...refinement.actionScriptRun, failedStepNumber, timedOut },
          },
        }),
        refinedFromVersionNumber: 1,
      });

      expect(readRefinedFromDetails().slice(2, 4)).toEqual(["Failed run", expectedOutcome]);
    });

    it("shows no Refined from block for a generated or an edited version", () => {
      const { rerender } = renderDetails();
      expect(screen.queryByRole("heading", { name: "Refined from" })).not.toBeInTheDocument();

      rerender(
        <ActionScriptDetails
          {...buildDetailsProps({
            script: buildActionScriptRecord({ editedFromActionScriptId: "script-1", modelId: null, effort: null }),
            editedFromVersionNumber: 1,
          })}
        />,
      );
      expect(screen.getByText(/^Edited .+ from Version 1 · Runs logged out$/)).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Refined from" })).not.toBeInTheDocument();
    });
  });
});
