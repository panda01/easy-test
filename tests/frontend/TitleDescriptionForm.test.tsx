import { describe, it, expect, vi, type Mock } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { userEvent, type UserEvent } from "@testing-library/user-event";
import TitleDescriptionForm, {
  type CredentialOption,
  type TitleDescriptionFormProps,
} from "../../src/components/TitleDescriptionForm";
import { type WebsiteItemRequestBody } from "../../src/hooks/useWebsiteItems";

/**
 * Renders the title / description form with blank fields and spy callbacks,
 * letting a test override any prop.
 * @param overrides - Props to replace in the default blank form
 * @returns The submit and cancel spies, and the rendered form element
 */
function renderTitleDescriptionForm(overrides: Partial<TitleDescriptionFormProps> = {}): {
  onSubmit: Mock<(values: WebsiteItemRequestBody) => void>;
  onCancel: Mock<() => void>;
  formElement: HTMLFormElement;
} {
  const onSubmit = vi.fn<(values: WebsiteItemRequestBody) => void>();
  const onCancel = vi.fn<() => void>();
  const { container } = render(
    <TitleDescriptionForm
      initialValues={{ title: "", description: "" }}
      submitLabel="Create use case"
      isSubmitting={false}
      errorMessage={null}
      onSubmit={onSubmit}
      onCancel={onCancel}
      {...overrides}
    />,
  );
  const formElement = container.querySelector("form");
  if (formElement === null) throw new Error("TitleDescriptionForm did not render a <form>");
  return { onSubmit, onCancel, formElement };
}

/** Two credentials the "Log in as" select can offer. */
const CREDENTIAL_OPTIONS: CredentialOption[] = [
  { id: "credential-2", name: "Viewer" },
  { id: "credential-1", name: "Admin" },
];

/** A filled-in title and description, so submit is enabled. */
const FILLED_VALUES = { title: "Log in", description: "Sign in" };

/**
 * Picks an option from the "Log in as" select.
 * @param user - The user-event session
 * @param optionName - The option's text
 */
async function pickCredential(user: UserEvent, optionName: string): Promise<void> {
  await user.click(screen.getByRole("combobox", { name: /^Log in as/ }));
  await user.click(await screen.findByRole("option", { name: optionName }));
}

/**
 * Finds the form's submit button by the label the tests give it.
 * @returns The "Create use case" button
 */
function getSubmitButton(): HTMLElement {
  return screen.getByRole("button", { name: "Create use case" });
}

describe("TitleDescriptionForm", () => {
  it("seeds the fields from initialValues", () => {
    renderTitleDescriptionForm({
      initialValues: { title: "Log in", description: "Sign in with a valid account" },
    });
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue("Log in");
    expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue(
      "Sign in with a valid account",
    );
  });

  it("disables submit while both fields are blank", () => {
    renderTitleDescriptionForm();
    expect(getSubmitButton()).toBeDisabled();
  });

  it("keeps submit disabled while only one field is filled", async () => {
    const user = userEvent.setup();
    renderTitleDescriptionForm();

    await user.type(screen.getByRole("textbox", { name: "Title" }), "Log in");
    expect(getSubmitButton()).toBeDisabled();

    await user.clear(screen.getByRole("textbox", { name: "Title" }));
    await user.type(screen.getByRole("textbox", { name: "Description" }), "Steps");
    expect(getSubmitButton()).toBeDisabled();
  });

  it("treats a whitespace-only title or description as blank", async () => {
    const user = userEvent.setup();
    renderTitleDescriptionForm();

    await user.type(screen.getByRole("textbox", { name: "Title" }), "   ");
    await user.type(screen.getByRole("textbox", { name: "Description" }), "Steps");
    expect(getSubmitButton()).toBeDisabled();

    await user.clear(screen.getByRole("textbox", { name: "Title" }));
    await user.type(screen.getByRole("textbox", { name: "Title" }), "Log in");
    await user.clear(screen.getByRole("textbox", { name: "Description" }));
    await user.type(screen.getByRole("textbox", { name: "Description" }), "  ");
    expect(getSubmitButton()).toBeDisabled();
  });

  it("enables submit and sends the typed values once both fields are filled", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderTitleDescriptionForm();

    await user.type(screen.getByRole("textbox", { name: "Title" }), "Log in");
    await user.type(screen.getByRole("textbox", { name: "Description" }), "Sign in");
    expect(getSubmitButton()).toBeEnabled();
    await user.click(getSubmitButton());

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({ title: "Log in", description: "Sign in" });
  });

  it("ignores a submit event while a required field is blank (e.g. Enter)", () => {
    const { onSubmit, formElement } = renderTitleDescriptionForm({
      initialValues: { title: "Log in", description: "" },
    });
    fireEvent.submit(formElement);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("disables submit and ignores submit events while a save is in flight", () => {
    const { onSubmit, formElement } = renderTitleDescriptionForm({
      initialValues: { title: "Log in", description: "Sign in" },
      isSubmitting: true,
    });
    expect(getSubmitButton()).toBeDisabled();
    fireEvent.submit(formElement);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows the save error in an alert", () => {
    renderTitleDescriptionForm({ errorMessage: "title is required" });
    expect(screen.getByRole("alert")).toHaveTextContent("title is required");
  });

  it("shows no alert without a save error", () => {
    renderTitleDescriptionForm();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("calls onCancel when Cancel is clicked, without submitting", async () => {
    const user = userEvent.setup();
    const { onSubmit, onCancel } = renderTitleDescriptionForm();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("asks who to log in as only when given credential options, and leaves credentialId out otherwise", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderTitleDescriptionForm({ initialValues: FILLED_VALUES });

    expect(screen.queryByRole("combobox", { name: /^Log in as/ })).not.toBeInTheDocument();
    await user.click(getSubmitButton());

    expect(onSubmit).toHaveBeenCalledWith({ title: "Log in", description: "Sign in" });
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("credentialId");
  });

  it("starts logged out, offers each credential, and explains when the credential is used", async () => {
    const user = userEvent.setup();
    renderTitleDescriptionForm({ initialValues: FILLED_VALUES, credentialOptions: CREDENTIAL_OPTIONS });

    const credentialSelect = screen.getByRole("combobox", { name: /^Log in as/ });
    expect(credentialSelect).toHaveTextContent("Logged out (no credential)");
    expect(screen.getByText("Before each run, the browser logs in as this credential first")).toBeInTheDocument();

    await user.click(credentialSelect);
    const options = within(await screen.findByRole("listbox")).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["Logged out (no credential)", "Viewer", "Admin"]);
  });

  it("submits null for logged out when the website has no credentials", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderTitleDescriptionForm({ initialValues: FILLED_VALUES, credentialOptions: [] });

    expect(screen.getByRole("combobox", { name: /^Log in as/ })).toHaveTextContent("Logged out (no credential)");
    await user.click(getSubmitButton());

    expect(onSubmit).toHaveBeenCalledWith({ title: "Log in", description: "Sign in", credentialId: null });
  });

  it("starts on the saved credential and submits the one picked", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderTitleDescriptionForm({
      initialValues: { ...FILLED_VALUES, credentialId: "credential-1" },
      credentialOptions: CREDENTIAL_OPTIONS,
    });
    expect(screen.getByRole("combobox", { name: /^Log in as/ })).toHaveTextContent("Admin");

    await pickCredential(user, "Viewer");
    await user.click(getSubmitButton());
    await pickCredential(user, "Logged out (no credential)");
    await user.click(getSubmitButton());

    expect(onSubmit.mock.calls).toEqual([
      [{ title: "Log in", description: "Sign in", credentialId: "credential-2" }],
      [{ title: "Log in", description: "Sign in", credentialId: null }],
    ]);
  });

  it("shows and submits a saved credential that is no longer offered as logged out", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderTitleDescriptionForm({
      initialValues: { ...FILLED_VALUES, credentialId: "deleted-credential" },
      credentialOptions: CREDENTIAL_OPTIONS,
    });

    expect(screen.getByRole("combobox", { name: /^Log in as/ })).toHaveTextContent("Logged out (no credential)");
    await user.click(getSubmitButton());

    expect(onSubmit).toHaveBeenCalledWith({ title: "Log in", description: "Sign in", credentialId: null });
  });
});
