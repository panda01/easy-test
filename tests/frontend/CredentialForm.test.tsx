import { describe, it, expect, vi, type Mock } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import CredentialForm, { type CredentialFormProps } from "../../src/components/CredentialForm";
import { type CredentialRequestBody } from "../../src/hooks/useCredentials";

/** A new credential's starting values: every field blank. */
const NEW_CREDENTIAL_VALUES: CredentialRequestBody = {
  name: "",
  description: "",
  username: "",
  password: "",
};

/** A saved credential's values, as the edit page seeds them (the password always starts blank). */
const SAVED_CREDENTIAL_VALUES: CredentialRequestBody = {
  name: "Admin",
  description: "The admin account",
  username: "admin@example.com",
  password: "",
};

/**
 * Renders the credential form for a NEW credential, with spy callbacks,
 * letting a test override any prop.
 * @param overrides - Props to replace in the default create form
 * @returns The submit and cancel spies, and the rendered form element
 */
function renderCredentialForm(overrides: Partial<CredentialFormProps> = {}): {
  onSubmit: Mock<(values: CredentialRequestBody) => void>;
  onCancel: Mock<() => void>;
  formElement: HTMLFormElement;
} {
  const onSubmit = vi.fn<(values: CredentialRequestBody) => void>();
  const onCancel = vi.fn<() => void>();
  const { container } = render(
    <CredentialForm
      initialValues={NEW_CREDENTIAL_VALUES}
      passwordIsSaved={false}
      submitLabel="Create credential"
      isSubmitting={false}
      errorMessage={null}
      onSubmit={onSubmit}
      onCancel={onCancel}
      {...overrides}
    />,
  );
  const formElement = container.querySelector("form");
  if (formElement === null) throw new Error("CredentialForm did not render a <form>");
  return { onSubmit, onCancel, formElement };
}

/**
 * Finds a text field by its label, ignoring the required-field asterisk.
 * @param label - The field's label, e.g. "Username"
 * @returns The field's input
 */
function getField(label: string): HTMLElement {
  return screen.getByLabelText(new RegExp(`^${label}\\W*$`));
}

/**
 * Finds the form's submit button by the label the tests give it.
 * @param label - The submit button's text
 * @returns The submit button
 */
function getSubmitButton(label = "Create credential"): HTMLElement {
  return screen.getByRole("button", { name: label });
}

describe("CredentialForm", () => {
  it("starts a new credential blank, with a masked password field and no login page or selector fields (a Login action has those)", () => {
    renderCredentialForm();

    expect(getField("Name")).toHaveValue("");
    expect(getField("Username")).toHaveValue("");
    expect(getField("Password")).toHaveAttribute("type", "password");
    expect(getField("Password")).toBeRequired();
    expect(screen.getByText("Stored encrypted. It is never shown again after you save.")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Login page URL/)).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Login form selectors (optional)" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/selector/)).not.toBeInTheDocument();
  });

  it("keeps submit disabled until name, username, and password are all filled", async () => {
    const user = userEvent.setup();
    renderCredentialForm();

    await user.type(getField("Name"), "Admin");
    await user.type(getField("Username"), "admin@example.com");
    expect(getSubmitButton()).toBeDisabled();

    await user.type(getField("Password"), "   ");
    expect(getSubmitButton()).toBeDisabled();

    await user.clear(getField("Password"));
    await user.type(getField("Password"), "correct horse");
    expect(getSubmitButton()).toBeEnabled();

    await user.clear(getField("Username"));
    expect(getSubmitButton()).toBeDisabled();
  });

  it("sends every field when submitted", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderCredentialForm();

    await user.type(getField("Name"), "Admin");
    await user.type(getField("Description"), "The admin account");
    await user.type(getField("Username"), "admin@example.com");
    await user.type(getField("Password"), "correct horse");
    await user.click(getSubmitButton());

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({
      name: "Admin",
      description: "The admin account",
      username: "admin@example.com",
      password: "correct horse",
    });
  });

  it("lets an edit be saved with the password left blank, saying the saved one is kept", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderCredentialForm({
      initialValues: SAVED_CREDENTIAL_VALUES,
      passwordIsSaved: true,
      submitLabel: "Save changes",
    });

    expect(getField("Username")).toHaveValue("admin@example.com");
    expect(getField("Password")).toHaveValue("");
    expect(getField("Password")).not.toBeRequired();
    expect(
      screen.getByText(
        "A password is saved. Leave this blank to keep it, or type a new one to replace it.",
      ),
    ).toBeInTheDocument();
    await user.click(getSubmitButton("Save changes"));

    expect(onSubmit).toHaveBeenCalledWith(SAVED_CREDENTIAL_VALUES);
  });

  it("ignores a submit event while a required field is blank (e.g. Enter)", () => {
    const { onSubmit, formElement } = renderCredentialForm();

    fireEvent.submit(formElement);

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("disables submit and ignores submit events while a save is in flight", () => {
    const { onSubmit, formElement } = renderCredentialForm({
      initialValues: SAVED_CREDENTIAL_VALUES,
      passwordIsSaved: true,
      isSubmitting: true,
    });

    expect(getSubmitButton()).toBeDisabled();
    fireEvent.submit(formElement);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows the save error in an alert, and none without one", () => {
    const { formElement } = renderCredentialForm({ errorMessage: "A username is required" });

    expect(screen.getByRole("alert")).toHaveTextContent("A username is required");
    expect(formElement).toBeInTheDocument();
  });

  it("calls onCancel when Cancel is clicked, without submitting", async () => {
    const user = userEvent.setup();
    const { onSubmit, onCancel } = renderCredentialForm();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("puts a plus on the submit button when told to, as the create page does", () => {
    renderCredentialForm({ submitButtonShowsPlus: true });

    const submitButton = screen.getByRole("button", { name: "Create credential" });
    expect(within(submitButton).getByTestId("AddIcon")).toBeInTheDocument();
  });

  it("leaves the plus off the submit button by default, as the edit page's Save changes has it", () => {
    renderCredentialForm({ submitLabel: "Save changes" });

    const submitButton = screen.getByRole("button", { name: "Save changes" });
    expect(within(submitButton).queryByTestId("AddIcon")).not.toBeInTheDocument();
  });
});
