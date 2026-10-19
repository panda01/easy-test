import { describe, it, expect, vi } from "vitest";
import { render, screen, type RenderResult } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import RenameWebObjectDialog, {
  MAX_WEB_OBJECT_NAME_LENGTH,
  type RenameWebObjectDialogProps,
} from "../../src/components/RenameWebObjectDialog";

/**
 * Renders the dialog open for "Action" with sensible defaults, overridden per test.
 * @param overrides - Props to replace
 * @returns The Testing Library render result
 */
function renderDialog(overrides: Partial<RenameWebObjectDialogProps> = {}): RenderResult {
  const props: RenameWebObjectDialogProps = {
    webObject: { currentName: "Action", detectedName: "Action" },
    isSaving: false,
    errorMessage: null,
    onSave: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  return render(<RenameWebObjectDialog {...props} />);
}

describe("RenameWebObjectDialog", () => {
  it("starts at the current name, says what was detected and how long a name lasts, and saves the trimmed name", async () => {
    const onSave = vi.fn();
    renderDialog({ onSave });

    expect(screen.getByRole("dialog", { name: "Rename “Action”" })).toBeInTheDocument();
    const nameField = screen.getByRole("textbox", { name: "Name" });
    expect(nameField).toHaveValue("Action");
    expect(nameField).toHaveAttribute("maxlength", String(MAX_WEB_OBJECT_NAME_LENGTH));
    expect(screen.getByText("Detected as “Action”. The name lasts until the next crawl.")).toBeInTheDocument();

    await userEvent.clear(nameField);
    await userEvent.type(nameField, "  Test step  ");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledWith("Test step");
  });

  it("saves a blank name, or Use detected name, as null", async () => {
    const onSave = vi.fn();
    renderDialog({ onSave, webObject: { currentName: "Test step", detectedName: "Action" } });

    await userEvent.click(screen.getByRole("button", { name: "Use detected name" }));
    await userEvent.clear(screen.getByRole("textbox", { name: "Name" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenNthCalledWith(1, null);
    expect(onSave).toHaveBeenNthCalledWith(2, null);
  });

  it("cancels without saving", async () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    renderDialog({ onSave, onCancel });

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("shows the server's reason only after this opening tried to save", async () => {
    renderDialog({ errorMessage: "Web object not found" });

    expect(screen.queryByText("Web object not found")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Web object not found");
  });

  it("disables its buttons while saving", () => {
    renderDialog({ isSaving: true });

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Use detected name" })).toBeDisabled();
  });

  it("shows nothing while closed", () => {
    renderDialog({ webObject: null });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
