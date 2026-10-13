import { describe, it, expect, vi } from "vitest";
import { render, screen, within, type RenderResult } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import ActionScriptsSection, {
  type ActionScriptsSectionProps,
} from "../../src/components/ActionScriptsSection";
import {
  buildActionScriptRecord,
  buildActionScriptRefinementRecord,
  buildScriptModelCatalog,
} from "./support/frontendTestHelpers";

const catalog = buildScriptModelCatalog();

const newestScript = buildActionScriptRecord({ id: "script-2", summary: "The newest summary." });
const olderScript = buildActionScriptRecord({ id: "script-1", summary: "The older summary." });

/**
 * Builds the section's props: a loaded two-version list of an up-to-date,
 * logged-out action, with nothing in flight.
 * @param overrides - Props to replace in the defaults
 * @returns The complete props
 */
function buildSectionProps(overrides: Partial<ActionScriptsSectionProps> = {}): ActionScriptsSectionProps {
  return {
    scripts: [newestScript, olderScript],
    isLoading: false,
    errorMessage: null,
    selectedScriptId: null,
    onSelectScript: vi.fn(),
    isConverting: false,
    convertErrorMessage: null,
    onConvertClick: vi.fn(),
    canConvert: true,
    modelPicker: {
      models: catalog.models,
      selectedModelId: "claude-opus-5-5",
      selectedEffort: "high",
      isLoading: false,
      errorMessage: null,
      isDisabled: false,
      onModelChange: vi.fn(),
      onEffortChange: vi.fn(),
    },
    currentAction: { title: "Log in", description: "Sign in with a valid account", credentialId: null },
    comparePath: "/websites/website-1/actions/item-1/scripts/compare",
    compareLinkState: { returnTo: "/websites/website-1/actions/item-1" },
    isSavingEdit: false,
    saveEditErrorMessage: null,
    onSaveEdit: vi.fn(),
    ...overrides,
  };
}

/**
 * Renders the section with a loaded two-version list by default.
 * @param overrides - Props to replace in the defaults
 * @returns The Testing Library render result
 */
function renderSection(overrides: Partial<ActionScriptsSectionProps> = {}): RenderResult {
  return render(
    <MemoryRouter>
      <ActionScriptsSection {...buildSectionProps(overrides)} />
    </MemoryRouter>,
  );
}

/**
 * Reads the rows of the versions list.
 * @returns Every version row's button
 */
function getVersionButtons(): HTMLElement[] {
  return within(screen.getByRole("list", { name: "Versions" })).getAllByRole("button");
}

describe("ActionScriptsSection", () => {
  it("explains what converting does, and shows the newest version when nothing (or an unknown id) is selected", () => {
    renderSection({ selectedScriptId: "not-in-the-list" });

    expect(screen.getByText(/Claude turns this action into a JSON step plan/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Version 2" })).toBeInTheDocument();
    expect(screen.getByText("The newest summary.")).toBeInTheDocument();
    expect(getVersionButtons()[0]).toHaveAttribute("aria-current", "true");
  });

  it("shows the selected version and reports picks", async () => {
    const user = userEvent.setup();
    const onSelectScript = vi.fn();
    renderSection({ selectedScriptId: "script-1", onSelectScript });

    expect(screen.getByRole("heading", { name: "Version 1" })).toBeInTheDocument();
    expect(screen.getByText("The older summary.")).toBeInTheDocument();
    const versions = getVersionButtons();
    expect(versions[1]).toHaveAttribute("aria-current", "true");

    await user.click(versions[0]);
    expect(onSelectScript).toHaveBeenCalledWith("script-2");
  });

  it("reports Convert clicks, and shows progress and a disabled button while converting", async () => {
    const user = userEvent.setup();
    const onConvertClick = vi.fn();
    const { unmount } = renderSection({ onConvertClick });

    await user.click(screen.getByRole("button", { name: "Convert to script" }));
    expect(onConvertClick).toHaveBeenCalledTimes(1);

    unmount();
    renderSection({ scripts: [], isConverting: true, onConvertClick });
    expect(screen.getByRole("button", { name: "Converting…" })).toBeDisabled();
    expect(screen.getByRole("progressbar", { name: "Converting to script" })).toBeInTheDocument();
    expect(screen.getByText("This can take a few minutes.")).toBeInTheDocument();
  });

  it("shows a failed conversion's reason", () => {
    renderSection({ convertErrorMessage: "Claude declined to convert this action (cyber)" });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not convert: Claude declined to convert this action (cyber)",
    );
  });

  it("shows loading, then the empty state, without a versions list", () => {
    const { unmount } = renderSection({ scripts: [], isLoading: true });
    expect(screen.getByRole("progressbar", { name: "Loading scripts" })).toBeInTheDocument();
    expect(screen.queryByText("No scripts yet.")).not.toBeInTheDocument();

    unmount();
    renderSection({ scripts: [] });
    expect(screen.getByText("No scripts yet.")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Versions" })).not.toBeInTheDocument();
  });

  it("keeps Convert disabled until a model is chosen", () => {
    renderSection({ canConvert: false });

    expect(screen.getByRole("button", { name: "Convert to script" })).toBeDisabled();
  });

  it("shows the model and effort on each generated version's row", () => {
    renderSection({
      scripts: [
        buildActionScriptRecord({ id: "script-3", modelId: "claude-haiku-4-5-20251001", effort: null }),
        buildActionScriptRecord({ id: "script-2", modelId: "claude-retired-1", effort: null }),
        buildActionScriptRecord({ id: "script-1", modelId: null, effort: null }),
      ],
    });

    const versionButtons = getVersionButtons();
    expect(versionButtons[0]).toHaveTextContent("Claude Haiku 4.5 (claude-haiku-4-5-20251001) · Standard effort");
    expect(versionButtons[1]).toHaveTextContent("claude-retired-1 · no effort level");
    expect(versionButtons[2]).toHaveTextContent(/ · unknown model$/);
  });

  it("names the version an edited version came from, or says it was an earlier one", () => {
    renderSection({
      scripts: [
        buildActionScriptRecord({ id: "script-4", editedFromActionScriptId: "deleted-script", modelId: null }),
        buildActionScriptRecord({ id: "script-3", editedFromActionScriptId: "script-1", modelId: null }),
        buildActionScriptRecord({ id: "script-2" }),
        buildActionScriptRecord({ id: "script-1" }),
      ],
    });

    const versionButtons = getVersionButtons();
    // Each row starts with its run status icon's title; none of these versions has run.
    expect(versionButtons[0]).toHaveTextContent(/^Not run yetVersion 4.+ · Edited from an earlier version$/);
    expect(versionButtons[1]).toHaveTextContent(/^Not run yetVersion 3.+ · Edited from Version 1$/);
    expect(versionButtons[2]).toHaveTextContent(/^Not run yetVersion 2.+ · Claude Opus 5\.5 \(claude-opus-5-5\) · high effort$/);
    expect(screen.getByText(/^Edited .+ from an earlier version · Runs logged out$/)).toBeInTheDocument();
  });

  it("names the version and model a refined version came from, or says it was an earlier one, and shows its Refined from details", () => {
    renderSection({
      scripts: [
        buildActionScriptRecord({
          id: "script-4",
          modelId: "claude-haiku-4-5-20251001",
          effort: null,
          refinement: buildActionScriptRefinementRecord({
            sourceActionScriptId: "deleted-script",
            refinedActionScriptId: "script-4",
          }),
        }),
        buildActionScriptRecord({
          id: "script-3",
          refinement: buildActionScriptRefinementRecord({
            sourceActionScriptId: "script-1",
            refinedActionScriptId: "script-3",
          }),
        }),
        buildActionScriptRecord({ id: "script-2", editedFromActionScriptId: "script-1", modelId: null }),
        buildActionScriptRecord({ id: "script-1" }),
      ],
      selectedScriptId: "script-3",
    });

    const versionButtons = getVersionButtons();
    // Each row starts with its run status icon's title; none of these versions has run.
    expect(versionButtons[0]).toHaveTextContent(
      /^Not run yetVersion 4.+ · Refined from an earlier version · Claude Haiku 4\.5 \(claude-haiku-4-5-20251001\) · Standard effort$/,
    );
    expect(versionButtons[1]).toHaveTextContent(
      /^Not run yetVersion 3.+ · Refined from Version 1 · Claude Opus 5\.5 \(claude-opus-5-5\) · high effort$/,
    );
    expect(versionButtons[2]).toHaveTextContent(/^Not run yetVersion 2.+ · Edited from Version 1$/);
    expect(
      screen.getByText(/^Refined .+ from Version 1 · Claude Opus 5\.5 \(claude-opus-5-5\) · high effort · Runs logged out$/),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Refined from" })).toBeInTheDocument();
    const [refinedFromVersionDefinition] = screen.getAllByRole("definition");
    expect(refinedFromVersionDefinition).toHaveTextContent(/^Version 1$/);
  });

  it("starts each version's row with its run status icon, judged by that version's latest run", () => {
    renderSection({
      scripts: [
        buildActionScriptRecord({ id: "script-3", latestRun: null }),
        buildActionScriptRecord({
          id: "script-2",
          latestRun: { id: "run-2", succeeded: false, createdAt: "2026-04-03T00:00:00.000Z" },
        }),
        buildActionScriptRecord({
          id: "script-1",
          latestRun: { id: "run-1", succeeded: true, createdAt: "2026-04-02T00:00:00.000Z" },
        }),
      ],
    });

    const versionButtons = getVersionButtons();
    expect(within(versionButtons[0]).getByRole("img", { name: "Not run yet" })).toBeInTheDocument();
    expect(within(versionButtons[1]).getByRole("img", { name: "Latest run failed" })).toBeInTheDocument();
    expect(within(versionButtons[2]).getByRole("img", { name: "Latest run passed" })).toBeInTheDocument();
    expect(versionButtons.map((versionButton) => within(versionButton).getAllByRole("img"))).toEqual([
      [expect.anything()],
      [expect.anything()],
      [expect.anything()],
    ]);
    expect(versionButtons[0]).toHaveAccessibleName(/^Not run yet Version 3/);
  });

  it("marks out-of-date versions with a chip, including a version generated with another credential", () => {
    renderSection({
      scripts: [
        buildActionScriptRecord({ id: "script-3" }),
        buildActionScriptRecord({ id: "script-2", credentialId: "credential-1", credentialName: "Admin" }),
        buildActionScriptRecord({ id: "script-1", actionDescription: "An older description" }),
      ],
    });

    const versionButtons = getVersionButtons();
    expect(versionButtons.map((versionButton) => versionButton.textContent.includes("Out of date"))).toEqual([
      false,
      true,
      true,
    ]);
  });

  it("links to the comparison page only when there are two versions", () => {
    const { unmount } = renderSection();
    expect(screen.getByRole("link", { name: "Compare versions" })).toHaveAttribute(
      "href",
      "/websites/website-1/actions/item-1/scripts/compare",
    );

    unmount();
    renderSection({ scripts: [olderScript] });
    expect(screen.queryByRole("link", { name: "Compare versions" })).not.toBeInTheDocument();
  });

  it("hands the selected version and its edited plan to onSaveEdit", async () => {
    const user = userEvent.setup();
    const onSaveEdit = vi.fn();
    renderSection({ selectedScriptId: "script-1", onSaveEdit });

    await user.click(screen.getByRole("button", { name: "Edit steps" }));
    const planNameField = screen.getByRole("textbox", { name: "Plan name" });
    await user.clear(planNameField);
    await user.type(planNameField, "Log in again");
    await user.click(screen.getByRole("button", { name: "Save as new version" }));

    expect(onSaveEdit).toHaveBeenCalledWith(olderScript, { ...olderScript.plan, name: "Log in again" });
  });

  it("passes the edit save state through to the editor", async () => {
    const user = userEvent.setup();
    const { rerender } = renderSection({ isSavingEdit: true });

    await user.click(screen.getByRole("button", { name: "Edit steps" }));
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();

    const onSaveEdit = vi.fn();
    rerender(
      <MemoryRouter>
        <ActionScriptsSection {...buildSectionProps({ onSaveEdit })} />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("button", { name: "Delete step 2" }));
    await user.click(screen.getByRole("button", { name: "Save as new version" }));
    rerender(
      <MemoryRouter>
        <ActionScriptsSection
          {...buildSectionProps({ onSaveEdit, saveEditErrorMessage: "Action not found" })}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Could not save: Action not found");
  });

  it("closes the editor when another version is shown", async () => {
    const user = userEvent.setup();
    const { rerender } = renderSection();
    await user.click(screen.getByRole("button", { name: "Edit steps" }));
    expect(screen.getByRole("textbox", { name: "Plan name" })).toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <ActionScriptsSection {...buildSectionProps({ selectedScriptId: "script-1" })} />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Version 1" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Plan name" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit steps" })).toBeInTheDocument();
  });
});
