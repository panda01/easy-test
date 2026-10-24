import { describe, it, expect, vi } from "vitest";
import { render, screen, within, type RenderResult } from "@testing-library/react";
import { userEvent, type UserEvent } from "@testing-library/user-event";
import AddActionParameterDialog, {
  type AddActionParameterDialogProps,
} from "../../src/components/AddActionParameterDialog";
import { buildVersionParameterRecord } from "./support/frontendTestHelpers";

/**
 * Builds the dialog's props: open, with one text of the steps, one parameter
 * to fill a field in after, one object type, and nothing in flight.
 * @param overrides - Props to replace in the defaults
 * @returns The complete props
 */
function buildDialogProps(overrides: Partial<AddActionParameterDialogProps> = {}): AddActionParameterDialogProps {
  return {
    isOpen: true,
    bindableTexts: [
      { text: "Apollo 7", fields: ["value", "targetName"] },
      { text: "https://example.com/projects/1", fields: ["url"] },
      { text: "Open", fields: ["targetText"] },
    ],
    parameters: [buildVersionParameterRecord()],
    objectTypes: [{ key: "/projects/{project}", name: "Project" }],
    isSaving: false,
    errorMessage: null,
    onSave: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
}

/**
 * Renders the dialog.
 * @param overrides - Props to replace in the defaults
 * @returns The Testing Library render result
 */
function renderDialog(overrides: Partial<AddActionParameterDialogProps> = {}): RenderResult {
  return render(<AddActionParameterDialog {...buildDialogProps(overrides)} />);
}

/**
 * Picks an option from one of the dialog's selects.
 * @param user - The user-event session
 * @param selectName - The select's label
 * @param optionName - The option's text
 */
async function pickOption(user: UserEvent, selectName: RegExp, optionName: string | RegExp): Promise<void> {
  await user.click(screen.getByRole("combobox", { name: selectName }));
  await user.click(await screen.findByRole("option", { name: optionName }));
}

describe("AddActionParameterDialog", () => {
  it("adds a value in the steps as text, describing where each text appears", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    renderDialog({ onSave });

    expect(screen.getByRole("combobox", { name: /^Value in the steps/ })).toHaveTextContent(
      "Apollo 7 (typed, a name clicked or checked)",
    );
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    await pickOption(user, /^Value in the steps/, "Open (a text clicked or checked)");
    await user.type(screen.getByRole("textbox", { name: "Label" }), "Button");
    await pickOption(user, /^Required/, "Optional");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(onSave).toHaveBeenCalledWith({
      addKind: "value",
      label: "Button",
      requiredChoice: "optional",
      valueKind: "text",
      objectTypeKey: null,
      matchText: "Open",
    });
  });

  it("adds a value in the steps as an object, which is always required", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    renderDialog({ onSave });

    await pickOption(user, /^Value in the steps/, /^https:\/\/example.com\/projects\/1/);
    await user.type(screen.getByRole("textbox", { name: "Label" }), "Project");
    await pickOption(user, /^It is/, "An object (always required)");
    expect(screen.getByRole("combobox", { name: /^Object type/ })).toHaveTextContent("Project");
    expect(screen.queryByRole("combobox", { name: /^Required/ })).not.toBeInTheDocument();
    await pickOption(user, /^It is/, "An object (always required)");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(onSave).toHaveBeenCalledWith({
      addKind: "value",
      label: "Project",
      requiredChoice: "required",
      valueKind: "object",
      objectTypeKey: "/projects/{project}",
      matchText: "https://example.com/projects/1",
    });
  });

  it("adds a field the steps don't fill, found by label, placeholder, or role and name", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    renderDialog({ onSave });

    await pickOption(user, /^Kind/, "A field the steps don't fill");
    await user.type(screen.getByRole("textbox", { name: "Label" }), "Notes");
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: "The field's label" }), "Notes");
    expect(screen.getByRole("combobox", { name: /^Filled in after/ })).toHaveTextContent("Project name");
    expect(screen.getByRole("combobox", { name: /^Required/ })).toHaveTextContent("Optional");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(onSave).toHaveBeenLastCalledWith({
      addKind: "field",
      label: "Notes",
      requiredChoice: "optional",
      fieldTarget: { label: "Notes" },
      stepAction: "fill",
      fillAfterKey: "projectName",
    });

    await pickOption(user, /^Find it by/, "Placeholder");
    expect(screen.getByRole("textbox", { name: "The field's placeholder" })).toHaveValue("Notes");
    await pickOption(user, /^Typed or picked/, "Picked from a list (select)");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(onSave).toHaveBeenLastCalledWith(
      expect.objectContaining({ fieldTarget: { placeholder: "Notes" }, stepAction: "selectOption" }),
    );

    await pickOption(user, /^Find it by/, "Role and name");
    await pickOption(user, /^Role/, "searchbox");
    await pickOption(user, /^Typed or picked/, "Typed (fill)");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(onSave).toHaveBeenLastCalledWith(
      expect.objectContaining({ fieldTarget: { role: "searchbox", name: "Notes" }, stepAction: "fill" }),
    );

    await pickOption(user, /^Find it by/, "Label");
    await pickOption(user, /^Kind/, "A value in the steps");
    expect(screen.getByRole("combobox", { name: /^Required/ })).toHaveTextContent("Required");
  });

  it("shows the reason an add failed only once this dialog tried, and backs out with Cancel", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const { rerender } = renderDialog({ errorMessage: "An earlier error", onCancel });
    expect(screen.queryByText("An earlier error")).not.toBeInTheDocument();

    await user.type(screen.getByRole("textbox", { name: "Label" }), "Mission");
    await user.click(screen.getByRole("button", { name: "Add" }));
    rerender(
      <AddActionParameterDialog {...buildDialogProps({ errorMessage: "That value is not in this version's steps", onCancel })} />,
    );
    expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent(
      "That value is not in this version's steps",
    );

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("renders nothing while closed", () => {
    renderDialog({ isOpen: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("starts with nothing picked when the version has no texts, parameters, or types", () => {
    renderDialog({ bindableTexts: [], parameters: [], objectTypes: [] });
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
  });
});
