import { describe, it, expect, vi } from "vitest";
import { render, screen, within, type RenderResult } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import ActionScriptDetails, {
  type ActionScriptDetailsProps,
} from "../../src/components/ActionScriptDetails";
import DisclosureRow from "../../src/components/DisclosureRow";
import { type ScriptModelOption } from "../../src/hooks/useScriptModels";
import { formatPlanJson } from "../../src/utils/actionPlanSteps";
import {
  buildActionScriptRecord,
  buildActionScriptRefinementRecord,
  buildScriptModelCatalog,
} from "./support/frontendTestHelpers";

const catalogModels: ScriptModelOption[] = buildScriptModelCatalog().models;

/**
 * Builds the component's props: version 3, the default generated plan, the
 * desktop layout, no run to mark the steps by, and no save in progress.
 * @param overrides - Props to replace in the defaults
 * @returns The complete props
 */
function buildDetailsProps(overrides: Partial<ActionScriptDetailsProps> = {}): ActionScriptDetailsProps {
  return {
    script: buildActionScriptRecord(),
    versionNumber: 3,
    editedFromVersionNumber: null,
    refinedFromVersionNumber: null,
    catalogModels,
    isSavingEdit: false,
    saveEditErrorMessage: null,
    onSaveEdit: vi.fn(),
    highlightedRun: null,
    isPhoneLayout: false,
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
 * Reads the step rows of the read-only step list, each as its number
 * followed by its sentence (e.g. `1Click link "Sign in"`).
 * @returns Each listed step's text, in order
 */
function readListedSteps(): string[] {
  const stepList = screen.getByRole("list", { name: "Plan steps" });
  return within(stepList)
    .getAllByRole("listitem")
    .map((stepItem) => stepItem.textContent);
}

/**
 * Finds the deepest element whose whole text (its children's included)
 * matches - for a line built from several elements, like the version caption
 * with its relative time in a span.
 * @param pattern - What the element's full text must match
 * @returns The matching element
 */
function getElementByFullText(pattern: RegExp): HTMLElement {
  return screen.getByText((_content, element) => {
    if (element === null) return false;
    const elementMatches = pattern.test(element.textContent);
    const aChildMatchesToo = Array.from(element.children).some((child) => pattern.test(child.textContent ?? ""));
    return elementMatches && !aChildMatchesToo;
  });
}

/** A version Claude refined from the failed run of version 1 (see `buildActionScriptRefinementRecord`). */
const refinedScript = buildActionScriptRecord({
  id: "script-2",
  refinement: buildActionScriptRefinementRecord(),
});

describe("ActionScriptDetails", () => {
  describe("on desktop", () => {
    it("shows the version, how it was generated and when, the summary, where the plan starts, and its numbered steps", () => {
      const script = buildActionScriptRecord();
      renderDetails({ script });

      expect(screen.getByRole("heading", { name: "Version 3" })).toBeInTheDocument();
      const caption = getElementByFullText(/^Claude Opus 5\.5 · high effort · .+$/);
      expect(within(caption).getByTitle(new Date(script.createdAt).toLocaleString())).toBeInTheDocument();
      expect(screen.getByText("Opens the site and signs in.")).toBeInTheDocument();
      expect(screen.getByText("Starts at https://example.com/")).toBeInTheDocument();
      expect(readListedSteps()).toEqual(['1Click link "Sign in"', '2Check that heading "Welcome" is visible']);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("says when a generated version's model was not recorded", () => {
      renderDetails({ script: buildActionScriptRecord({ modelId: null, effort: null }) });

      expect(getElementByFullText(/^unknown model · .+$/)).toBeInTheDocument();
    });

    it("names the version an edited version was saved from, or says it was an earlier one", () => {
      const editedScript = buildActionScriptRecord({
        id: "script-2",
        editedFromActionScriptId: "script-1",
        modelId: null,
        effort: null,
      });
      const { rerender } = renderDetails({ script: editedScript, editedFromVersionNumber: 1 });

      expect(getElementByFullText(/^Edited from Version 1 · .+$/)).toBeInTheDocument();

      rerender(<ActionScriptDetails {...buildDetailsProps({ script: editedScript, editedFromVersionNumber: null })} />);
      expect(getElementByFullText(/^Edited from an earlier version · .+$/)).toBeInTheDocument();
    });

    it("names the version and the model a refined version came from, or says it was an earlier one", () => {
      const { rerender } = renderDetails({ script: refinedScript, refinedFromVersionNumber: 1 });

      expect(getElementByFullText(/^Refined from Version 1 · Claude Opus 5\.5 · high effort · .+$/)).toBeInTheDocument();

      rerender(
        <ActionScriptDetails {...buildDetailsProps({ script: refinedScript, refinedFromVersionNumber: null })} />,
      );
      expect(
        getElementByFullText(/^Refined from an earlier version · Claude Opus 5\.5 · high effort · .+$/),
      ).toBeInTheDocument();
    });

    it("says when a refined version's model was not recorded", () => {
      renderDetails({
        script: buildActionScriptRecord({ ...refinedScript, modelId: null, effort: null }),
        refinedFromVersionNumber: 1,
      });

      expect(getElementByFullText(/^Refined from Version 1 · unknown model · .+$/)).toBeInTheDocument();
    });

    it("names a model the catalog does not list by its id", () => {
      renderDetails({ catalogModels: [] });

      expect(getElementByFullText(/^claude-opus-5-5 · high effort · .+$/)).toBeInTheDocument();
    });

    it("marks the steps against the run shown beside them", () => {
      renderDetails({
        highlightedRun: { succeeded: false, failedStepNumber: 2, errorMessage: "Heading not visible" },
      });

      expect(readListedSteps()[1]).toBe('2Check that heading "Welcome" is visibleFailed here — Heading not visible');
    });

    it("has an outlined Edit steps button and no leading rows", () => {
      renderDetails();

      expect(screen.getByRole("button", { name: "Edit steps" })).toHaveClass("MuiButton-outlined");
      const disclosureButtons = screen
        .getAllByRole("button")
        .filter((button) => button.hasAttribute("aria-expanded"));
      expect(disclosureButtons.map((button) => button.textContent)).toEqual([
        "Assumptions · 1",
        "Pages given to Claude · 1",
        "Plan JSON",
      ]);
    });
  });

  describe("collapsed rows", () => {
    it("opens the assumptions Claude made", async () => {
      const user = userEvent.setup();
      renderDetails();
      expect(screen.queryByRole("list", { name: "Assumptions" })).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Assumptions · 1" }));

      const assumptions = screen.getByRole("list", { name: "Assumptions" });
      expect(within(assumptions).getByText("The sign-in button is labelled Sign in")).toBeInTheDocument();
    });

    it("says so when Claude recorded no assumptions", async () => {
      const user = userEvent.setup();
      renderDetails({ script: buildActionScriptRecord({ assumptions: [] }) });

      await user.click(screen.getByRole("button", { name: "Assumptions · 0" }));

      expect(screen.getByText("No assumptions recorded.")).toBeInTheDocument();
      expect(screen.queryByRole("list", { name: "Assumptions" })).not.toBeInTheDocument();
    });

    it("opens the pages Claude was shown", async () => {
      const user = userEvent.setup();
      renderDetails();

      await user.click(screen.getByRole("button", { name: "Pages given to Claude · 1" }));

      const contextPages = screen.getByRole("list", { name: "Pages given to Claude" });
      expect(within(contextPages).getAllByRole("listitem").map((pageItem) => pageItem.textContent)).toEqual([
        "https://example.com/",
      ]);
    });

    it("says Claude was shown no pages when the website had not been crawled", async () => {
      const user = userEvent.setup();
      renderDetails({ script: buildActionScriptRecord({ contextPageUrls: [] }) });

      await user.click(screen.getByRole("button", { name: "Pages given to Claude · 0" }));

      expect(
        screen.getByText("None - the website had not been crawled. Crawl it, then convert again for a better plan."),
      ).toBeInTheDocument();
      expect(screen.queryByRole("list", { name: "Pages given to Claude" })).not.toBeInTheDocument();
    });

    it("opens the plan's JSON", async () => {
      const user = userEvent.setup();
      const script = buildActionScriptRecord();
      renderDetails({ script });
      expect(screen.queryByLabelText("Plan JSON")).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Plan JSON" }));

      expect(screen.getByLabelText("Plan JSON").textContent).toBe(formatPlanJson(script.plan));
    });
  });

  describe("on a phone", () => {
    it("is headed Steps, without the caption or summary, with a text Edit steps button", () => {
      renderDetails({ isPhoneLayout: true });

      expect(screen.getByRole("heading", { name: "Steps" })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Version 3" })).not.toBeInTheDocument();
      expect(screen.queryByText("Opens the site and signs in.")).not.toBeInTheDocument();
      expect(screen.queryByText(/high effort/)).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Edit steps" })).toHaveClass("MuiButton-text");
      expect(readListedSteps()).toEqual(['1Click link "Sign in"', '2Check that heading "Welcome" is visible']);
    });

    it("lists the page's leading rows before the version's own", () => {
      renderDetails({
        isPhoneLayout: true,
        leadingDisclosures: (
          <>
            <DisclosureRow label="Run history" detail="2">
              <p>Runs</p>
            </DisclosureRow>
            <DisclosureRow label="Output log" detail="8 lines">
              <p>Log</p>
            </DisclosureRow>
          </>
        ),
      });

      const disclosureButtons = screen
        .getAllByRole("button")
        .filter((button) => button.hasAttribute("aria-expanded"));
      expect(disclosureButtons.map((button) => button.textContent)).toEqual([
        "Run history · 2",
        "Output log · 8 lines",
        "Assumptions · 1",
        "Pages given to Claude · 1",
        "Plan JSON",
      ]);
    });

    it("leaves the Failed here note out of the compact steps", () => {
      renderDetails({
        isPhoneLayout: true,
        highlightedRun: { succeeded: false, failedStepNumber: 2, errorMessage: "Heading not visible" },
      });

      expect(screen.queryByText(/Failed here/)).not.toBeInTheDocument();
    });
  });

  describe("editing steps", () => {
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

    it("opens the editor from the phone layout too", async () => {
      const user = userEvent.setup();
      renderDetails({ isPhoneLayout: true });

      await user.click(screen.getByRole("button", { name: "Edit steps" }));

      expect(screen.getByRole("textbox", { name: "Plan name" })).toHaveValue("Log in");
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
        <ActionScriptDetails {...buildDetailsProps({ onSaveEdit, saveEditErrorMessage: "Plan is invalid" })} />,
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
        <ActionScriptDetails {...buildDetailsProps({ onSaveEdit, saveEditErrorMessage: "Plan is invalid" })} />,
      );
      expect(screen.getByRole("alert")).toHaveTextContent("Could not save: Plan is invalid");

      await user.click(screen.getByRole("button", { name: "Cancel" }));
      await user.click(screen.getByRole("button", { name: "Edit steps" }));

      expect(screen.queryByText(/Could not save/)).not.toBeInTheDocument();
    });
  });
});
