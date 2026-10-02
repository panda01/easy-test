import { describe, it, expect, vi, type Mock } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import TitleDescriptionForm, {
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
});
