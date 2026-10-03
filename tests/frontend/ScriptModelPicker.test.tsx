import { describe, it, expect, vi } from "vitest";
import { render, screen, type RenderResult } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import ScriptModelPicker, { type ScriptModelPickerProps } from "../../src/components/ScriptModelPicker";
import { buildScriptModelCatalog } from "./support/frontendTestHelpers";

const catalog = buildScriptModelCatalog();

/**
 * Renders the picker on Opus 5.5 at high by default.
 * @param overrides - Props to replace in the defaults
 * @returns The Testing Library render result
 */
function renderPicker(overrides: Partial<ScriptModelPickerProps> = {}): RenderResult {
  const props: ScriptModelPickerProps = {
    models: catalog.models,
    selectedModelId: "claude-opus-5-5",
    selectedEffort: "high",
    isLoading: false,
    errorMessage: null,
    isDisabled: false,
    onModelChange: vi.fn(),
    onEffortChange: vi.fn(),
    ...overrides,
  };
  return render(<ScriptModelPicker {...props} />);
}

describe("ScriptModelPicker", () => {
  it("lists every model and reports the one picked", async () => {
    const user = userEvent.setup();
    const onModelChange = vi.fn();
    renderPicker({ onModelChange });

    await user.click(screen.getByRole("combobox", { name: /^Model/ }));
    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "Claude Opus 5.5",
      "Claude Opus 4.6",
      "Claude Haiku 4.5",
    ]);
    await user.click(screen.getByRole("option", { name: "Claude Opus 4.6" }));

    expect(onModelChange).toHaveBeenCalledWith("claude-opus-4-6");
  });

  it("offers exactly the chosen model's effort levels and reports the one picked", async () => {
    const user = userEvent.setup();
    const onEffortChange = vi.fn();
    renderPicker({ selectedModelId: "claude-opus-4-6", onEffortChange });

    await user.click(screen.getByRole("combobox", { name: /^Effort/ }));
    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["low", "medium", "high", "max"]);
    await user.click(screen.getByRole("option", { name: "max" }));

    expect(onEffortChange).toHaveBeenCalledWith("max");
  });

  it("names the model id and its fallback, or says there is none", () => {
    const { unmount } = renderPicker();
    expect(
      screen.getByText("claude-opus-5-5 · If it declines, Claude Opus 4.8 answers instead"),
    ).toBeInTheDocument();
    unmount();

    renderPicker({ selectedModelId: "claude-opus-4-6" });
    expect(screen.getByText("claude-opus-4-6 · No fallback for this model")).toBeInTheDocument();
  });

  it("shows a disabled Standard level for a model with no effort setting", () => {
    renderPicker({ selectedModelId: "claude-haiku-4-5-20251001", selectedEffort: null });

    const effortSelect = screen.getByRole("combobox", { name: /^Effort/ });
    expect(effortSelect).toHaveTextContent("Standard");
    expect(effortSelect).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("This model has no effort setting")).toBeInTheDocument();
  });

  it("is disabled while the list loads or a conversion runs", () => {
    const { unmount } = renderPicker({ models: [], selectedModelId: null, isLoading: true });
    expect(screen.getByText("Loading models…")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /^Model/ })).toHaveAttribute("aria-disabled", "true");
    unmount();

    renderPicker({ isDisabled: true });
    expect(screen.getByRole("combobox", { name: /^Model/ })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("combobox", { name: /^Effort/ })).toHaveAttribute("aria-disabled", "true");
  });

  it("says why the model list could not load instead of showing the dropdowns", () => {
    renderPicker({ models: [], selectedModelId: null, errorMessage: "ANTHROPIC_API_KEY is not set" });

    expect(screen.getByRole("alert")).toHaveTextContent("Could not load models: ANTHROPIC_API_KEY is not set");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});
