import { describe, it, expect, vi, type Mock } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import CredentialForm, { type CredentialFormProps } from "../../src/components/CredentialForm";
import { type CredentialRequestBody } from "../../src/hooks/useCredentials";

/** The owning website's login page, which a credential with a blank login page URL uses. */
const WEBSITE_LOGIN_URL = "https://example.com/login";

/** The helper text of the login page URL field when the website has no login page. */
const NO_WEBSITE_LOGIN_URL_HELPER_TEXT =
  "This website has no login page URL yet - enter it here (a successful login will also save it to the website)";

/** A new credential's starting values: every field blank, the login page URL included. */
const NEW_CREDENTIAL_VALUES: CredentialRequestBody = {
  name: "",
  description: "",
  username: "",
  password: "",
  loginUrl: "",
  usernameSelector: "",
  passwordSelector: "",
  submitSelector: "",
};

/** A saved credential's values, as the edit page seeds them (the password always starts blank). */
const SAVED_CREDENTIAL_VALUES: CredentialRequestBody = {
  name: "Admin",
  description: "The admin account",
  username: "admin@example.com",
  password: "",
  loginUrl: "https://example.com/login",
  usernameSelector: "#email",
  passwordSelector: "",
  submitSelector: "button.sign-in",
};

/**
 * Renders the credential form for a NEW credential of a website with a login
 * page, with spy callbacks, letting a test override any prop.
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
      websiteLoginUrl={WEBSITE_LOGIN_URL}
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
  it("starts a new credential blank, the login page URL included, with a masked password field", () => {
    renderCredentialForm();

    expect(getField("Name")).toHaveValue("");
    expect(getField("Login page URL")).toHaveValue("");
    expect(getField("Password")).toHaveAttribute("type", "password");
    expect(getField("Password")).toBeRequired();
    expect(screen.getByText("Stored encrypted. It is never shown again after you save.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Login form selectors (optional)" })).toBeInTheDocument();
  });

  it("keeps submit disabled until name, username, login page URL, and password are all filled when the website has no login page", async () => {
    const user = userEvent.setup();
    renderCredentialForm({ websiteLoginUrl: null });

    await user.type(getField("Name"), "Admin");
    await user.type(getField("Username"), "admin@example.com");
    await user.type(getField("Login page URL"), "https://example.com/login");
    expect(getSubmitButton()).toBeDisabled();

    await user.type(getField("Password"), "   ");
    expect(getSubmitButton()).toBeDisabled();

    await user.clear(getField("Password"));
    await user.type(getField("Password"), "correct horse");
    expect(getSubmitButton()).toBeEnabled();

    await user.clear(getField("Login page URL"));
    expect(getSubmitButton()).toBeDisabled();
  });

  it("sends every field, the selectors included, when submitted", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderCredentialForm();

    await user.type(getField("Name"), "Admin");
    await user.type(getField("Description"), "The admin account");
    await user.type(getField("Username"), "admin@example.com");
    await user.type(getField("Password"), "correct horse");
    await user.type(getField("Username field selector"), "#email");
    await user.type(getField("Password field selector"), "#password");
    await user.type(getField("Submit button selector"), "button.go");
    await user.click(getSubmitButton());

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({
      name: "Admin",
      description: "The admin account",
      username: "admin@example.com",
      password: "correct horse",
      loginUrl: "",
      usernameSelector: "#email",
      passwordSelector: "#password",
      submitSelector: "button.go",
    });
  });

  it("makes the login page URL optional when the website has one, offering it as the default", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderCredentialForm();

    const loginUrlField = getField("Login page URL");
    expect(loginUrlField).not.toBeRequired();
    expect(loginUrlField).toHaveAttribute("placeholder", WEBSITE_LOGIN_URL);
    expect(loginUrlField).toHaveAccessibleDescription(
      "Leave blank to use the website's login page (https://example.com/login)",
    );
    await user.type(getField("Name"), "Admin");
    await user.type(getField("Username"), "admin@example.com");
    await user.type(getField("Password"), "correct horse");
    expect(getSubmitButton()).toBeEnabled();
    await user.click(getSubmitButton());

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ loginUrl: "" }));
  });

  it("sends a login page URL typed over the website's, overriding it", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderCredentialForm();

    await user.type(getField("Name"), "Admin");
    await user.type(getField("Username"), "admin@example.com");
    await user.type(getField("Password"), "correct horse");
    await user.type(getField("Login page URL"), "https://example.com/admin/login");
    await user.click(getSubmitButton());

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ loginUrl: "https://example.com/admin/login" }),
    );
  });

  it("requires the login page URL when the website has none, saying a login will save it to the website", async () => {
    const user = userEvent.setup();
    const { onSubmit, formElement } = renderCredentialForm({ websiteLoginUrl: null });

    const loginUrlField = getField("Login page URL");
    expect(loginUrlField).toBeRequired();
    expect(loginUrlField).toHaveAttribute("placeholder", "https://example.com/login");
    expect(loginUrlField).toHaveAccessibleDescription(NO_WEBSITE_LOGIN_URL_HELPER_TEXT);
    await user.type(getField("Name"), "Admin");
    await user.type(getField("Username"), "admin@example.com");
    await user.type(getField("Password"), "correct horse");
    expect(getSubmitButton()).toBeDisabled();
    fireEvent.submit(formElement);
    expect(onSubmit).not.toHaveBeenCalled();

    await user.type(loginUrlField, "   ");
    expect(getSubmitButton()).toBeDisabled();
    await user.clear(loginUrlField);
    await user.type(loginUrlField, "https://example.com/login");
    expect(getSubmitButton()).toBeEnabled();
    await user.click(getSubmitButton());

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ loginUrl: "https://example.com/login" }),
    );
  });

  it("lets an edit be saved with the password left blank, saying the saved one is kept", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderCredentialForm({
      initialValues: SAVED_CREDENTIAL_VALUES,
      passwordIsSaved: true,
      submitLabel: "Save changes",
    });

    expect(getField("Username field selector")).toHaveValue("#email");
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
    const { formElement } = renderCredentialForm({ errorMessage: "A login page URL is required" });

    expect(screen.getByRole("alert")).toHaveTextContent("A login page URL is required");
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
});
