import { describe, it, expect, vi, type Mock } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import ConfirmDeleteDialog, {
  type ConfirmDeleteDialogProps,
} from "../../src/components/ConfirmDeleteDialog";

/**
 * Renders the dialog open, with spy callbacks, letting a test override any prop.
 * @param overrides - Props to replace in the default open dialog
 * @returns The two callback spies
 */
function renderDialog(overrides: Partial<ConfirmDeleteDialogProps> = {}): {
  onCancel: Mock<() => void>;
  onConfirm: Mock<() => void>;
} {
  const onCancel = vi.fn<() => void>();
  const onConfirm = vi.fn<() => void>();
  render(
    <ConfirmDeleteDialog
      isOpen
      title="Delete website?"
      message='"Example" will be deleted.'
      isDeleting={false}
      errorMessage={null}
      onCancel={onCancel}
      onConfirm={onConfirm}
      {...overrides}
    />,
  );
  return { onCancel, onConfirm };
}

describe("ConfirmDeleteDialog", () => {
  it("renders nothing while closed", () => {
    renderDialog({ isOpen: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the title as the dialog's name and the message", () => {
    renderDialog();
    const dialog = screen.getByRole("dialog", { name: "Delete website?" });
    expect(within(dialog).getByText('"Example" will be deleted.')).toBeInTheDocument();
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a failed delete's reason in an error alert", () => {
    renderDialog({ errorMessage: "Website not found" });
    expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent(
      "Website not found",
    );
  });

  it("calls onCancel when Cancel is clicked", async () => {
    const user = userEvent.setup();
    const { onCancel, onConfirm } = renderDialog();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("calls onCancel when Escape is pressed", async () => {
    const user = userEvent.setup();
    const { onCancel } = renderDialog();

    await user.keyboard("{Escape}");

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onConfirm when Delete is clicked", async () => {
    const user = userEvent.setup();
    const { onCancel, onConfirm } = renderDialog();

    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("disables both buttons while the delete is in flight", () => {
    renderDialog({ isDeleting: true });
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
  });
});
