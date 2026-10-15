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

/** A failed latest run, as a version's `latestRun`. */
const failedLatestRun = {
  id: "run-2",
  succeeded: false,
  failedStepNumber: 2,
  timedOut: false,
  createdAt: "2026-04-03T00:00:00.000Z",
};

/** A passed latest run, as a version's `latestRun`. */
const passedLatestRun = {
  id: "run-1",
  succeeded: true,
  failedStepNumber: null,
  timedOut: false,
  createdAt: "2026-04-02T00:00:00.000Z",
};

/**
 * Builds the section's props: a loaded two-version list of an up-to-date,
 * logged-out action, showing the newest version on desktop, with nothing in
 * flight.
 * @param overrides - Props to replace in the defaults
 * @returns The complete props
 */
function buildSectionProps(overrides: Partial<ActionScriptsSectionProps> = {}): ActionScriptsSectionProps {
  return {
    scripts: [newestScript, olderScript],
    isLoading: false,
    errorMessage: null,
    selectedScriptId: "script-2",
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
    isPhoneLayout: false,
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
 * Reads the rows of the desktop versions list.
 * @returns Every version row's button
 */
function getVersionButtons(): HTMLElement[] {
  return within(screen.getByRole("list", { name: "Versions" })).getAllByRole("button");
}

describe("ActionScriptsSection", () => {
  describe("desktop versions list", () => {
    it("lists the versions under a Versions heading, newest first, and marks the shown one", () => {
      renderSection({ selectedScriptId: "script-1" });

      expect(screen.getByRole("heading", { name: "Versions" })).toBeInTheDocument();
      const versionButtons = getVersionButtons();
      expect(versionButtons[0]).toHaveAccessibleName(/^Not run yet Version 2 /);
      expect(versionButtons[1]).toHaveAccessibleName(/^Not run yet Version 1 /);
      expect(versionButtons[0]).not.toHaveAttribute("aria-current");
      expect(versionButtons[1]).toHaveAttribute("aria-current", "true");
    });

    it("marks no row when no version is shown", () => {
      renderSection({ selectedScriptId: null });

      for (const versionButton of getVersionButtons()) {
        expect(versionButton).not.toHaveAttribute("aria-current");
      }
    });

    it("reports the version the user picks", async () => {
      const user = userEvent.setup();
      const onSelectScript = vi.fn();
      renderSection({ onSelectScript });

      await user.click(getVersionButtons()[1]);

      expect(onSelectScript).toHaveBeenCalledWith("script-1");
    });

    it("starts each version's row with its run status icon, judged by that version's latest run", () => {
      renderSection({
        scripts: [
          buildActionScriptRecord({ id: "script-3", latestRun: null }),
          buildActionScriptRecord({ id: "script-2", latestRun: failedLatestRun }),
          buildActionScriptRecord({ id: "script-1", latestRun: passedLatestRun }),
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
      expect(versionButtons[0]).toHaveAccessibleName(/^Not run yet Version 3 /);
    });

    it("says where each generated version came from: the short model name, its effort, and when", () => {
      renderSection({
        scripts: [
          buildActionScriptRecord({ id: "script-4", modelId: "claude-opus-5-5", effort: "high" }),
          buildActionScriptRecord({ id: "script-3", modelId: "claude-haiku-4-5-20251001", effort: null }),
          buildActionScriptRecord({ id: "script-2", modelId: "claude-retired-1", effort: "low" }),
          buildActionScriptRecord({ id: "script-1", modelId: null, effort: null }),
        ],
      });

      const versionButtons = getVersionButtons();
      expect(versionButtons[0]).toHaveTextContent(/Version 4 Opus 5\.5 · high · .+$/);
      expect(versionButtons[1]).toHaveTextContent(/Version 3 Haiku 4\.5 · .+$/);
      expect(versionButtons[1]).not.toHaveTextContent("Standard");
      expect(versionButtons[2]).toHaveTextContent(/Version 2 claude-retired-1 · low · .+$/);
      expect(versionButtons[3]).toHaveTextContent(/Version 1 unknown model · .+$/);
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
      expect(versionButtons[0]).toHaveTextContent(/Version 4 Edited from an earlier version · .+$/);
      expect(versionButtons[1]).toHaveTextContent(/Version 3 Edited from v1 · .+$/);
    });

    it("names the version and model a refined version came from, or says it was an earlier one", () => {
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
      });

      const versionButtons = getVersionButtons();
      expect(versionButtons[0]).toHaveTextContent(/Version 4 Refined from an earlier version · Haiku 4\.5 · .+$/);
      expect(versionButtons[1]).toHaveTextContent(/Version 3 Refined from v1 · Opus 5\.5 · .+$/);
      expect(versionButtons[2]).toHaveTextContent(/Version 2 Edited from v1 · .+$/);
    });

    it("gives each origin line the version's exact creation time as its hover title", () => {
      renderSection({ scripts: [olderScript] });

      expect(within(getVersionButtons()[0]).getByTitle(new Date(olderScript.createdAt).toLocaleString())).toHaveTextContent(
        /^Opus 5\.5 · high · /,
      );
    });

    it("tags out-of-date versions, including a version generated with another credential", () => {
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
      expect(screen.getByRole("link", { name: "Compare" })).toHaveAttribute(
        "href",
        "/websites/website-1/actions/item-1/scripts/compare",
      );

      unmount();
      renderSection({ scripts: [olderScript], selectedScriptId: "script-1" });
      expect(screen.queryByRole("link", { name: "Compare" })).not.toBeInTheDocument();
    });
  });

  describe("converting", () => {
    it("reports Convert clicks, and shows progress and a disabled button while converting", async () => {
      const user = userEvent.setup();
      const onConvertClick = vi.fn();
      const { unmount } = renderSection({ onConvertClick });

      await user.click(screen.getByRole("button", { name: "Convert to new version" }));
      expect(onConvertClick).toHaveBeenCalledTimes(1);

      unmount();
      renderSection({ scripts: [], selectedScriptId: null, isConverting: true, onConvertClick });
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

    it("keeps Convert disabled until a model is chosen", () => {
      renderSection({ canConvert: false });

      expect(screen.getByRole("button", { name: "Convert to new version" })).toBeDisabled();
    });

    it("puts the Model and Effort dropdowns above Convert", () => {
      renderSection();

      expect(screen.getByRole("combobox", { name: /^Model/ })).toHaveTextContent("Claude Opus 5.5");
      expect(screen.getByRole("combobox", { name: /^Effort/ })).toHaveTextContent("high");
    });
  });

  it("shows loading, then the empty state, without a versions list or a Compare link", () => {
    const { unmount } = renderSection({ scripts: [], selectedScriptId: null, isLoading: true });
    expect(screen.getByRole("progressbar", { name: "Loading scripts" })).toBeInTheDocument();
    expect(screen.queryByText("No versions yet.")).not.toBeInTheDocument();

    unmount();
    renderSection({ scripts: [], selectedScriptId: null });
    expect(screen.getByText("No versions yet.")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Versions" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Compare" })).not.toBeInTheDocument();
  });

  it("says why the script list could not load, instead of the empty state", () => {
    renderSection({ scripts: [], selectedScriptId: null, errorMessage: "Database unavailable" });

    expect(screen.getByRole("alert")).toHaveTextContent("Database unavailable");
    expect(screen.queryByText("No versions yet.")).not.toBeInTheDocument();
  });

  describe("phone layout", () => {
    it("offers a Version dropdown instead of the list, naming each version's status and age", async () => {
      const user = userEvent.setup();
      renderSection({
        isPhoneLayout: true,
        scripts: [
          buildActionScriptRecord({ id: "script-3", latestRun: failedLatestRun }),
          buildActionScriptRecord({ id: "script-2", latestRun: passedLatestRun }),
          buildActionScriptRecord({ id: "script-1", actionTitle: "Sign in" }),
        ],
        selectedScriptId: "script-3",
      });

      expect(screen.getByRole("region", { name: "Versions" })).toBeInTheDocument();
      expect(screen.queryByRole("list", { name: "Versions" })).not.toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Versions" })).not.toBeInTheDocument();
      const versionSelect = screen.getByRole("combobox", { name: /^Version/ });
      expect(versionSelect).toHaveTextContent(/^Version 3 · Failed · .+$/);

      await user.click(versionSelect);
      const options = await screen.findAllByRole("option");
      expect(options.map((option) => option.textContent)).toEqual([
        expect.stringMatching(/^Version 3 · Failed · .+$/),
        expect.stringMatching(/^Version 2 · Passed · .+$/),
        expect.stringMatching(/^Version 1 · Not run · .+ · Out of date$/),
      ]);
    });

    it("reports the version picked from the dropdown", async () => {
      const user = userEvent.setup();
      const onSelectScript = vi.fn();
      renderSection({ isPhoneLayout: true, onSelectScript });

      await user.click(screen.getByRole("combobox", { name: /^Version/ }));
      await user.click(await screen.findByRole("option", { name: /^Version 1 · / }));

      expect(onSelectScript).toHaveBeenCalledWith("script-1");
    });

    it("keeps the model dropdowns and Convert under the dropdown", async () => {
      const user = userEvent.setup();
      const onConvertClick = vi.fn();
      renderSection({ isPhoneLayout: true, onConvertClick });

      expect(screen.getByRole("combobox", { name: /^Model/ })).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Convert to new version" }));

      expect(onConvertClick).toHaveBeenCalledTimes(1);
    });

    it("shows the empty state and no dropdown when there are no versions", () => {
      renderSection({ isPhoneLayout: true, scripts: [], selectedScriptId: null });

      expect(screen.getByText("No versions yet.")).toBeInTheDocument();
      expect(screen.queryByRole("combobox", { name: /^Version/ })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Convert to new version" })).toBeInTheDocument();
    });
  });
});
