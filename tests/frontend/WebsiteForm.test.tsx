import { describe, it, expect, vi, type Mock } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import WebsiteForm, { type WebsiteFormProps } from "../../src/components/WebsiteForm";
import { type WebsiteRequestBody } from "../../src/hooks/useWebsites";

/**
 * Renders the website form with blank fields and spy callbacks, letting a test
 * override any prop.
 * @param overrides - Props to replace in the default blank form
 * @returns The submit and cancel spies, and the rendered form element
 */
function renderWebsiteForm(overrides: Partial<WebsiteFormProps> = {}): {
  onSubmit: Mock<(values: WebsiteRequestBody) => void>;
  onCancel: Mock<() => void>;
  formElement: HTMLFormElement;
} {
  const onSubmit = vi.fn<(values: WebsiteRequestBody) => void>();
  const onCancel = vi.fn<() => void>();
  const { container } = render(
    <WebsiteForm
      initialValues={{ url: "", name: "", description: "" }}
      submitLabel="Create website"
      isSubmitting={false}
      errorMessage={null}
      onSubmit={onSubmit}
      onCancel={onCancel}
      {...overrides}
    />,
  );
  const formElement = container.querySelector("form");
  if (formElement === null) throw new Error("WebsiteForm did not render a <form>");
  return { onSubmit, onCancel, formElement };
}

/**
 * Finds the form's submit button by the label the tests give it.
 * @returns The "Create website" button
 */
function getSubmitButton(): HTMLElement {
  return screen.getByRole("button", { name: "Create website" });
}

describe("WebsiteForm", () => {
  it("seeds the fields from initialValues", () => {
    renderWebsiteForm({
      initialValues: { url: "https://example.com", name: "Example", description: "Notes" },
    });
    expect(screen.getByRole("textbox", { name: "URL" })).toHaveValue("https://example.com");
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Example");
    expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue("Notes");
  });

  it("disables submit while URL and name are blank", () => {
    renderWebsiteForm();
    expect(getSubmitButton()).toBeDisabled();
  });

  it("keeps submit disabled while only one of URL and name is filled", async () => {
    const user = userEvent.setup();
    renderWebsiteForm();

    await user.type(screen.getByRole("textbox", { name: "URL" }), "https://example.com");
    expect(getSubmitButton()).toBeDisabled();

    await user.clear(screen.getByRole("textbox", { name: "URL" }));
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Example");
    expect(getSubmitButton()).toBeDisabled();
  });

  it("treats whitespace-only URL or name as blank", async () => {
    const user = userEvent.setup();
    renderWebsiteForm();

    await user.type(screen.getByRole("textbox", { name: "URL" }), "   ");
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Example");
    expect(getSubmitButton()).toBeDisabled();

    await user.clear(screen.getByRole("textbox", { name: "URL" }));
    await user.type(screen.getByRole("textbox", { name: "URL" }), "https://example.com");
    await user.clear(screen.getByRole("textbox", { name: "Name" }));
    await user.type(screen.getByRole("textbox", { name: "Name" }), "  ");
    expect(getSubmitButton()).toBeDisabled();
  });

  it("enables submit once URL and name are filled, leaving description optional", async () => {
    const user = userEvent.setup();
    renderWebsiteForm();

    await user.type(screen.getByRole("textbox", { name: "URL" }), "https://example.com");
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Example");

    expect(getSubmitButton()).toBeEnabled();
  });

  it("submits the typed values, description included", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderWebsiteForm();

    await user.type(screen.getByRole("textbox", { name: "URL" }), "https://example.com");
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Example");
    await user.type(screen.getByRole("textbox", { name: "Description" }), "Line one");
    await user.click(getSubmitButton());

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({
      url: "https://example.com",
      name: "Example",
      description: "Line one",
    });
  });

  it("ignores a submit event while the required fields are blank (e.g. Enter)", () => {
    const { onSubmit, formElement } = renderWebsiteForm();
    fireEvent.submit(formElement);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("disables submit and ignores submit events while a save is in flight", () => {
    const { onSubmit, formElement } = renderWebsiteForm({
      initialValues: { url: "https://example.com", name: "Example", description: "" },
      isSubmitting: true,
    });
    expect(getSubmitButton()).toBeDisabled();
    fireEvent.submit(formElement);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows the save error in an alert", () => {
    renderWebsiteForm({ errorMessage: "url must be a valid http(s) URL" });
    expect(screen.getByRole("alert")).toHaveTextContent("url must be a valid http(s) URL");
  });

  it("shows no alert without a save error", () => {
    renderWebsiteForm();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("calls onCancel when Cancel is clicked, without submitting", async () => {
    const user = userEvent.setup();
    const { onSubmit, onCancel } = renderWebsiteForm();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
