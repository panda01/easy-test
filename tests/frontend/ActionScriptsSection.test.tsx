import { describe, it, expect, vi } from "vitest";
import { render, screen, within, type RenderResult } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import ActionScriptsSection, {
  type ActionScriptsSectionProps,
} from "../../src/components/ActionScriptsSection";
import {
  buildActionScriptRecord,
  buildScriptModelCatalog,
} from "./support/frontendTestHelpers";

const catalog = buildScriptModelCatalog();

const newestScript = buildActionScriptRecord({ id: "script-2", code: "// newest" });
const olderScript = buildActionScriptRecord({ id: "script-1", code: "// older" });

/**
 * Renders the section with a loaded two-version list by default.
 * @param overrides - Props to replace in the defaults
 * @returns The Testing Library render result
 */
function renderSection(overrides: Partial<ActionScriptsSectionProps> = {}): RenderResult {
  const props: ActionScriptsSectionProps = {
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
    currentAction: { title: "Log in", description: "Sign in with a valid account" },
    comparePath: "/websites/website-1/actions/item-1/scripts/compare",
    compareLinkState: { returnTo: "/websites/website-1/actions/item-1" },
    ...overrides,
  };
  return render(
    <MemoryRouter>
      <ActionScriptsSection {...props} />
    </MemoryRouter>,
  );
}

describe("ActionScriptsSection", () => {
  it("shows the newest version when nothing (or an unknown id) is selected", () => {
    renderSection({ selectedScriptId: "not-in-the-list" });

    expect(screen.getByRole("heading", { name: "Version 2" })).toBeInTheDocument();
    expect(screen.getByLabelText("Script code")).toHaveTextContent("// newest");
  });

  it("shows the selected version and reports picks", async () => {
    const user = userEvent.setup();
    const onSelectScript = vi.fn();
    renderSection({ selectedScriptId: "script-1", onSelectScript });

    expect(screen.getByLabelText("Script code")).toHaveTextContent("// older");
    const versions = within(screen.getByRole("list", { name: "Versions" })).getAllByRole("button");
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

  it("shows the model and effort on each version row", () => {
    renderSection({
      scripts: [
        buildActionScriptRecord({ id: "script-2", modelId: "claude-haiku-4-5-20251001", effort: null }),
        buildActionScriptRecord({ id: "script-1", modelId: "claude-retired-1", effort: null }),
      ],
    });

    const versionButtons = within(screen.getByRole("list", { name: "Versions" })).getAllByRole("button");
    expect(versionButtons[0]).toHaveTextContent("Claude Haiku 4.5 (claude-haiku-4-5-20251001) · Standard effort");
    expect(versionButtons[1]).toHaveTextContent("claude-retired-1 · no effort level");
  });

  it("marks out-of-date versions with a chip", () => {
    renderSection({
      scripts: [
        buildActionScriptRecord({ id: "script-2" }),
        buildActionScriptRecord({ id: "script-1", actionDescription: "An older description" }),
      ],
    });

    const versionButtons = within(screen.getByRole("list", { name: "Versions" })).getAllByRole("button");
    expect(versionButtons[0]).not.toHaveTextContent("Out of date");
    expect(versionButtons[1]).toHaveTextContent("Out of date");
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
});
