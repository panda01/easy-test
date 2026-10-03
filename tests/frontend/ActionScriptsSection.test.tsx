import { describe, it, expect, vi } from "vitest";
import { render, screen, within, type RenderResult } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import ActionScriptsSection, {
  type ActionScriptsSectionProps,
} from "../../src/components/ActionScriptsSection";
import { buildActionScriptRecord } from "./support/frontendTestHelpers";

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
    ...overrides,
  };
  return render(<ActionScriptsSection {...props} />);
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
    const { rerender } = renderSection({ onConvertClick });

    await user.click(screen.getByRole("button", { name: "Convert to script" }));
    expect(onConvertClick).toHaveBeenCalledTimes(1);

    rerender(
      <ActionScriptsSection
        scripts={[]}
        isLoading={false}
        errorMessage={null}
        selectedScriptId={null}
        onSelectScript={vi.fn()}
        isConverting
        convertErrorMessage={null}
        onConvertClick={onConvertClick}
      />,
    );
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
    const { rerender } = renderSection({ scripts: [], isLoading: true });
    expect(screen.getByRole("progressbar", { name: "Loading scripts" })).toBeInTheDocument();
    expect(screen.queryByText("No scripts yet.")).not.toBeInTheDocument();

    rerender(
      <ActionScriptsSection
        scripts={[]}
        isLoading={false}
        errorMessage={null}
        selectedScriptId={null}
        onSelectScript={vi.fn()}
        isConverting={false}
        convertErrorMessage={null}
        onConvertClick={vi.fn()}
      />,
    );
    expect(screen.getByText("No scripts yet.")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Versions" })).not.toBeInTheDocument();
  });
});
