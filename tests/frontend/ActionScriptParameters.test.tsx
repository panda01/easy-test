import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, within, type RenderResult } from "@testing-library/react";
import { userEvent, type UserEvent } from "@testing-library/user-event";
import ActionScriptParameters, {
  type ActionScriptParametersProps,
} from "../../src/components/ActionScriptParameters";
import {
  buildActionObjectRoleRecord,
  buildVersionParameterRecord,
  buildVersionParametersRecord,
} from "./support/frontendTestHelpers";

/** A Create action's version: a name, a secret, an added field, and one the user added. */
const createView = buildVersionParametersRecord({
  role: buildActionObjectRoleRecord({ kind: "create", objectTypeName: "Project" }),
  parameters: [
    buildVersionParameterRecord({ containerName: "New project" }),
    buildVersionParameterRecord({
      id: "parameter-2",
      key: "password",
      label: "Password",
      isSecret: true,
      requiredReason: "crawl",
      defaultValue: "hunter2",
      uses: [{ stepNumber: 2, field: "value" }],
    }),
    buildVersionParameterRecord({
      id: "parameter-3",
      key: "description",
      label: "Description",
      source: "page",
      isRequired: false,
      requiredReason: "run",
      defaultValue: "",
      uses: [],
      addedField: { target: { label: "Description" }, stepAction: "fill", afterStepNumber: 2 },
    }),
    buildVersionParameterRecord({
      id: "parameter-4",
      key: "code",
      label: "Code",
      source: "you",
      isRequired: false,
      requiredReason: "you",
      userRequiredChoice: "optional",
      userLabel: "Code",
      detectedLabel: "Code",
      defaultValue: "",
      uses: [{ stepNumber: 0, field: "url" }, { stepNumber: 4, field: "value" }],
    }),
  ],
  confirmStepNumber: 3,
  nameParameterKey: "projectName",
  warnings: ["Pick the kind of object this action works on - none was detected"],
});

/**
 * Builds the section's props: the Create view above, nothing in flight, and
 * spy callbacks that report success.
 * @param overrides - Props to replace in the defaults
 * @returns The complete props
 */
function buildProps(overrides: Partial<ActionScriptParametersProps> = {}): ActionScriptParametersProps {
  return {
    view: createView,
    isLoading: false,
    errorMessage: null,
    objectTypes: [{ key: "/projects/{project}", name: "Project" }],
    userNameParameterKey: null,
    isSaving: false,
    saveErrorMessage: null,
    onChangeParameter: vi.fn(() => Promise.resolve(true)),
    onRemoveParameter: vi.fn(),
    onAddParameter: vi.fn(() => Promise.resolve(true)),
    onNameParameterChange: vi.fn(),
    ...overrides,
  };
}

/**
 * Renders the section.
 * @param overrides - Props to replace in the defaults
 * @returns The Testing Library render result
 */
function renderParameters(overrides: Partial<ActionScriptParametersProps> = {}): RenderResult {
  return render(<ActionScriptParameters {...buildProps(overrides)} />);
}

/**
 * Picks an option from a select.
 * @param user - The user-event session
 * @param selectName - The select's label
 * @param optionName - The option's text
 */
async function pickOption(user: UserEvent, selectName: RegExp, optionName: string | RegExp): Promise<void> {
  await user.click(screen.getByRole("combobox", { name: selectName }));
  await user.click(await screen.findByRole("option", { name: optionName }));
}

describe("ActionScriptParameters", () => {
  it("lists each parameter with where it came from, why it is required, its value, and its steps", () => {
    renderParameters();

    const list = screen.getByRole("list", { name: "Parameters" });
    const [nameRow, passwordRow, descriptionRow, codeRow] = within(list).getAllByRole("listitem");
    expect(within(nameRow).getByText("In the steps")).toBeInTheDocument();
    expect(within(nameRow).getByText("Names the new object")).toBeInTheDocument();
    expect(within(nameRow).getByText("Required (a step types it) · used in steps 1, 3 · in “New project”")).toBeInTheDocument();
    expect(within(nameRow).getByText("Apollo 7")).toBeInTheDocument();
    expect(within(passwordRow).getByText("Secret")).toBeInTheDocument();
    expect(within(passwordRow).getByText("••••••")).toBeInTheDocument();
    expect(within(passwordRow).getByText(/Required \(the page says so, seen on a crawl\)/)).toBeInTheDocument();
    expect(within(descriptionRow).getByText("On the page")).toBeInTheDocument();
    expect(within(descriptionRow).getByText(/Optional \(the page says so, seen on a run\) · used in typed after step 2/)).toBeInTheDocument();
    expect(within(descriptionRow).getByText("(empty until you give it a value)")).toBeInTheDocument();
    expect(within(codeRow).getByText("Added by you")).toBeInTheDocument();
    expect(within(codeRow).getByText(/Optional \(you chose\) · used in the start address and step 4/)).toBeInTheDocument();
    expect(within(codeRow).getByText("(none)")).toBeInTheDocument();
    expect(within(codeRow).getByRole("button", { name: "Remove Code" })).toBeInTheDocument();
    expect(within(nameRow).queryByRole("button", { name: /Remove/ })).not.toBeInTheDocument();
  });

  it("shows the warnings, the confirm step, and what names the new object", async () => {
    const user = userEvent.setup();
    const onNameParameterChange = vi.fn();
    renderParameters({ onNameParameterChange });

    expect(screen.getByRole("alert")).toHaveTextContent("Pick the kind of object this action works on");
    expect(screen.getByText("Confirm step: step 3 - a new object is recorded when it shows no error")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /^Names the new object/ })).toHaveTextContent("Detect — Project name");

    await pickOption(user, /^Names the new object/, "Code");
    expect(onNameParameterChange).toHaveBeenLastCalledWith("code");
  });

  it("goes back to Detect for the name, and says when nothing names it or there is no confirm step", async () => {
    const user = userEvent.setup();
    const onNameParameterChange = vi.fn();
    renderParameters({
      onNameParameterChange,
      userNameParameterKey: "code",
      view: { ...createView, nameParameterKey: null, confirmStepNumber: null },
    });

    expect(screen.getByText("No confirm step")).toBeInTheDocument();
    await pickOption(user, /^Names the new object/, "Detect — none found");
    expect(onNameParameterChange).toHaveBeenLastCalledWith(null);
  });

  it("changes a parameter's label and required choice, closing the dialog once saved", async () => {
    const user = userEvent.setup();
    const onChangeParameter = vi.fn(() => Promise.resolve(true));
    renderParameters({ onChangeParameter });

    await user.click(screen.getByRole("button", { name: "Change Project name" }));
    const dialog = await screen.findByRole("dialog", { name: "Change “Project name”" });
    await user.type(within(dialog).getByRole("textbox", { name: "Label" }), "  Name  ");
    await pickOption(user, /^Required/, "Optional");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(onChangeParameter).toHaveBeenCalledWith("projectName", { userLabel: "Name", userRequiredChoice: "optional" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Change Project name" }));
    await pickOption(user, /^Required/, "Required");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onChangeParameter).toHaveBeenLastCalledWith("projectName", { userLabel: null, userRequiredChoice: "required" });
  });

  it("keeps the change dialog open with the reason when the change fails, and closes it on Cancel", async () => {
    const user = userEvent.setup();
    const { rerender } = renderParameters({ onChangeParameter: vi.fn(() => Promise.resolve(false)) });

    await user.click(screen.getByRole("button", { name: "Change Code" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("textbox", { name: "Label" })).toHaveValue("Code");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    rerender(
      <ActionScriptParameters
        {...buildProps({ onChangeParameter: vi.fn(() => Promise.resolve(false)), saveErrorMessage: "Parameter not found" })}
      />,
    );
    expect(within(screen.getByRole("dialog")).getByText("Parameter not found")).toBeInTheDocument();

    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Parameter not found")).toBeInTheDocument();
  });

  it("offers the object only as required, always", async () => {
    const user = userEvent.setup();
    const onChangeParameter = vi.fn(() => Promise.resolve(true));
    renderParameters({
      onChangeParameter,
      view: buildVersionParametersRecord({
        parameters: [
          buildVersionParameterRecord({ key: "object", label: "Project", kind: "object", requiredReason: "object" }),
        ],
      }),
    });

    expect(screen.getByText(/Required, always/)).toBeInTheDocument();
    expect(screen.getByText("The object")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Change Project" }));
    expect(screen.getByRole("textbox", { name: "Required" })).toHaveValue("Required, always");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onChangeParameter).toHaveBeenCalledWith("object", { userLabel: null, userRequiredChoice: null });
  });

  it("removes one of the user's own parameters", async () => {
    const user = userEvent.setup();
    const onRemoveParameter = vi.fn();
    renderParameters({ onRemoveParameter });
    await user.click(screen.getByRole("button", { name: "Remove Code" }));
    expect(onRemoveParameter).toHaveBeenCalledWith("code");
  });

  it("adds a parameter through the dialog, closing it once added", async () => {
    const user = userEvent.setup();
    const onAddParameter = vi.fn(() => Promise.resolve(true));
    renderParameters({
      onAddParameter,
      view: { ...createView, bindableTexts: [{ text: "Apollo 7", fields: ["value", "targetName"] }] },
    });

    await user.click(screen.getByRole("button", { name: "Add parameter" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a parameter" });
    await user.type(within(dialog).getByRole("textbox", { name: "Label" }), "Mission");
    await user.click(within(dialog).getByRole("button", { name: "Add" }));

    expect(onAddParameter).toHaveBeenCalledWith({
      addKind: "value",
      label: "Mission",
      requiredChoice: "required",
      valueKind: "text",
      objectTypeKey: null,
      matchText: "Apollo 7",
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("keeps the add dialog open when adding fails", async () => {
    const user = userEvent.setup();
    renderParameters({ onAddParameter: vi.fn(() => Promise.resolve(false)), view: { ...createView, bindableTexts: [{ text: "x", fields: ["value"] }] } });
    await user.click(screen.getByRole("button", { name: "Add parameter" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a parameter" });
    await user.type(within(dialog).getByRole("textbox", { name: "Label" }), "X");
    await user.click(within(dialog).getByRole("button", { name: "Add" }));
    expect(screen.getByRole("dialog", { name: "Add a parameter" })).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("says when a version has no parameters, and shows nothing to add while loading", () => {
    const { rerender } = renderParameters({ view: buildVersionParametersRecord() });
    expect(
      screen.getByText("This version has no parameters. Add one if a value in its steps should change from run to run."),
    ).toBeInTheDocument();

    rerender(<ActionScriptParameters {...buildProps({ view: null, isLoading: true })} />);
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add parameter" })).not.toBeInTheDocument();
  });
});
