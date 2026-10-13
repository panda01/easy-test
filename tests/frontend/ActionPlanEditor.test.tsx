import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, waitFor, within, type RenderResult } from "@testing-library/react";
import { userEvent, type UserEvent } from "@testing-library/user-event";
import ActionPlanEditor, { type ActionPlanEditorProps } from "../../src/components/ActionPlanEditor";
import { MAX_PLAN_STEPS, type ActionPlan, type PlanStep } from "../../src/utils/actionPlanSteps";

/** Step 1 of the starting plan: click the "Sign in" link. */
const CLICK_SIGN_IN: PlanStep = { action: "click", target: { role: "link", name: "Sign in" }, value: null };

/** Step 2 of the starting plan: type into the Email field. */
const FILL_EMAIL: PlanStep = { action: "fill", target: { label: "Email" }, value: "me@example.com" };

/** Step 3 of the starting plan: check that the welcome heading shows. */
const EXPECT_WELCOME: PlanStep = {
  action: "expectVisible",
  target: { role: "heading", name: "Welcome" },
  value: null,
};

/** The step "Add step" appends: a click on a button the user still has to name. */
const NEW_CLICK_STEP: PlanStep = { action: "click", target: { role: "button", name: "" }, value: null };

/** The plan the editor starts from by default: three valid steps. */
const STARTING_PLAN: ActionPlan = {
  name: "Log in",
  startUrl: "https://example.com/",
  steps: [CLICK_SIGN_IN, FILL_EMAIL, EXPECT_WELCOME],
};

/** The editor's save and cancel spies. */
interface EditorSpies {
  /** Receives the edited plan. */
  onSave: Mock<(plan: ActionPlan) => void>;
  /** Called on Cancel. */
  onCancel: Mock<() => void>;
}

/**
 * Renders the editor on the three-step plan, idle and without a save error by default.
 * @param overrides - Props to replace in the defaults
 * @returns The save / cancel spies and the render result
 */
function renderEditor(
  overrides: Partial<ActionPlanEditorProps> = {},
): EditorSpies & { renderResult: RenderResult } {
  const spies: EditorSpies = { onSave: vi.fn(), onCancel: vi.fn() };
  const renderResult = render(
    <ActionPlanEditor
      initialPlan={STARTING_PLAN}
      isSaving={false}
      saveErrorMessage={null}
      {...spies}
      {...overrides}
    />,
  );
  return { ...spies, renderResult };
}

/**
 * Reads the action each step card shows, top to bottom.
 * @returns The text of every card's Action dropdown
 */
function readStepActions(): string[] {
  const stepList = screen.getByRole("list", { name: "Steps being edited" });
  return within(stepList)
    .getAllByRole("combobox", { name: /^Action/ })
    .map((actionSelect) => actionSelect.textContent);
}

/**
 * Finds one step's card by its position.
 * @param stepNumber - The 1-based position
 * @returns The card element
 */
function getStepCard(stepNumber: number): HTMLElement {
  return screen.getByRole("listitem", { name: `Step ${String(stepNumber)}` });
}

/**
 * Finds the "Save as new version" button.
 * @returns The save button
 */
function getSaveButton(): HTMLElement {
  return screen.getByRole("button", { name: "Save as new version" });
}

/**
 * Replaces a text field's value by clearing it and typing.
 * @param user - The user-event session
 * @param fieldName - The field's accessible name
 * @param text - What to type ("" only clears)
 */
async function replaceFieldText(user: UserEvent, fieldName: string, text: string): Promise<void> {
  const field = screen.getByRole("textbox", { name: fieldName });
  await user.clear(field);
  if (text !== "") await user.type(field, text);
}

/**
 * Gives every step card a distinct place on the page (jsdom lays nothing
 * out, so every element would otherwise measure 0 x 0 at the origin). Step N
 * is 80px tall and starts at N * 100px, which is what dnd-kit's keyboard
 * sensor needs to find the step below or above the dragged one.
 */
function layOutStepCardsVertically(): void {
  /**
   * Measures an element: a step card at its place in the column, anything else as 0 x 0.
   * @param this - The element being measured
   * @returns The element's box
   */
  const measureElement = function (this: HTMLElement): DOMRect {
    const stepLabelMatch = /^Step (\d+)$/.exec(this.getAttribute("aria-label") ?? "");
    const elementIsAStepCard = stepLabelMatch !== null && this.tagName === "LI";
    const top = elementIsAStepCard ? Number(stepLabelMatch[1]) * 100 : 0;
    const height = elementIsAStepCard ? 80 : 0;
    const width = elementIsAStepCard ? 600 : 0;
    return {
      x: 0,
      y: top,
      top,
      left: 0,
      width,
      height,
      right: width,
      bottom: top + height,
      toJSON: () => ({}),
    };
  };
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(measureElement);
}

describe("ActionPlanEditor", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("starts from the given plan, with Save disabled because nothing has changed yet", () => {
    renderEditor();

    expect(screen.getByRole("textbox", { name: "Plan name" })).toHaveValue("Log in");
    expect(screen.getByRole("textbox", { name: "Start URL" })).toHaveValue("https://example.com/");
    expect(screen.getByRole("textbox", { name: "Start URL" })).toHaveAccessibleDescription(
      "The page the browser opens (after logging in) before the first step",
    );
    expect(readStepActions()).toEqual(["Click", "Type text", "Expect visible"]);
    expect(within(getStepCard(2)).getByRole("textbox", { name: "Label" })).toHaveValue("Email");
    expect(within(getStepCard(2)).getByRole("textbox", { name: "Text to type" })).toHaveValue("me@example.com");
    expect(getSaveButton()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
    expect(screen.queryByRole("list", { name: "Plan problems" })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("enables Save once something changes, and disables it again when the change is undone", async () => {
    const user = userEvent.setup();
    renderEditor();

    await replaceFieldText(user, "Plan name", "Log in again");
    expect(getSaveButton()).toBeEnabled();

    await replaceFieldText(user, "Plan name", "Log in");
    expect(getSaveButton()).toBeDisabled();
  });

  it("saves the edited name and start URL as a plain plan, with no editor ids", async () => {
    const user = userEvent.setup();
    const { onSave } = renderEditor();

    await replaceFieldText(user, "Plan name", "Log in as admin");
    await replaceFieldText(user, "Start URL", "https://example.com/login");
    await user.click(getSaveButton());

    expect(onSave).toHaveBeenCalledTimes(1);
    const savedPlan = onSave.mock.calls[0][0];
    expect(savedPlan).toEqual({
      name: "Log in as admin",
      startUrl: "https://example.com/login",
      steps: [CLICK_SIGN_IN, FILL_EMAIL, EXPECT_WELCOME],
    });
    expect(JSON.stringify(savedPlan)).not.toMatch(/clientId|plan-step-/);
  });

  it("saves a changed step in its place, leaving the others as they were", async () => {
    const user = userEvent.setup();
    const { onSave } = renderEditor();

    const emailField = within(getStepCard(2)).getByRole("textbox", { name: "Text to type" });
    await user.clear(emailField);
    await user.type(emailField, "{{{{credential.username}}");
    await user.click(getSaveButton());

    expect(onSave).toHaveBeenCalledWith({
      ...STARTING_PLAN,
      steps: [CLICK_SIGN_IN, { ...FILL_EMAIL, value: "{{credential.username}}" }, EXPECT_WELCOME],
    });
  });

  it("moves a step down and up with its buttons, renumbering the cards", async () => {
    const user = userEvent.setup();
    const { onSave } = renderEditor();

    await user.click(screen.getByRole("button", { name: "Move step 1 down" }));
    expect(readStepActions()).toEqual(["Type text", "Click", "Expect visible"]);
    expect(screen.getByRole("button", { name: "Move step 1 up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move step 3 down" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Move step 3 up" }));
    expect(readStepActions()).toEqual(["Type text", "Expect visible", "Click"]);

    await user.click(getSaveButton());
    expect(onSave).toHaveBeenCalledWith({ ...STARTING_PLAN, steps: [FILL_EMAIL, EXPECT_WELCOME, CLICK_SIGN_IN] });
  });

  it("deletes a step", async () => {
    const user = userEvent.setup();
    const { onSave } = renderEditor();

    await user.click(screen.getByRole("button", { name: "Delete step 2" }));

    expect(readStepActions()).toEqual(["Click", "Expect visible"]);
    await user.click(getSaveButton());
    expect(onSave).toHaveBeenCalledWith({ ...STARTING_PLAN, steps: [CLICK_SIGN_IN, EXPECT_WELCOME] });
  });

  it("appends a click step with Add step", async () => {
    const user = userEvent.setup();
    const { onSave } = renderEditor();

    await user.click(screen.getByRole("button", { name: "Add step" }));

    expect(readStepActions()).toEqual(["Click", "Type text", "Expect visible", "Click"]);
    expect(within(getStepCard(4)).getByRole("combobox", { name: /^Role/ })).toHaveTextContent("button");
    expect(within(getStepCard(4)).getByRole("textbox", { name: "Name (blank for any)" })).toHaveValue("");
    await user.click(getSaveButton());
    expect(onSave).toHaveBeenCalledWith({ ...STARTING_PLAN, steps: [...STARTING_PLAN.steps, NEW_CLICK_STEP] });
  });

  it("stops adding steps at the most a plan may have", async () => {
    const user = userEvent.setup();
    const almostFullPlan: ActionPlan = {
      ...STARTING_PLAN,
      steps: Array<PlanStep>(MAX_PLAN_STEPS - 1).fill(CLICK_SIGN_IN),
    };
    renderEditor({ initialPlan: almostFullPlan });
    const addStepButton = screen.getByRole("button", { name: "Add step" });
    expect(addStepButton).toBeEnabled();

    await user.click(addStepButton);

    expect(screen.getByRole("listitem", { name: `Step ${String(MAX_PLAN_STEPS)}` })).toBeInTheDocument();
    expect(addStepButton).toBeDisabled();
    expect(getSaveButton()).toBeEnabled();
  }, 30_000);

  it("lists what would make the server refuse the plan, and blocks Save until it is fixed", async () => {
    const user = userEvent.setup();
    const { onSave } = renderEditor();

    await replaceFieldText(user, "Start URL", "example.com");
    await user.click(within(getStepCard(1)).getByRole("combobox", { name: /^Action/ }));
    await user.click(await screen.findByRole("option", { name: "Go to address" }));

    const problemsAlert = screen.getByRole("alert");
    expect(problemsAlert).toHaveTextContent("Fix these before saving");
    const problemItems = within(screen.getByRole("list", { name: "Plan problems" })).getAllByRole("listitem");
    expect(problemItems.map((problemItem) => problemItem.textContent)).toEqual([
      "Start URL: must be an absolute http:// or https:// address",
      "Step 1 (Go to address): needs a value (URL)",
    ]);
    expect(getSaveButton()).toBeDisabled();

    await replaceFieldText(user, "Start URL", "https://example.com/");
    await user.type(within(getStepCard(1)).getByRole("textbox", { name: "URL" }), "https://example.com/home");

    expect(screen.queryByRole("list", { name: "Plan problems" })).not.toBeInTheDocument();
    await user.click(getSaveButton());
    expect(onSave).toHaveBeenCalledWith({
      ...STARTING_PLAN,
      steps: [{ action: "goto", target: null, value: "https://example.com/home" }, FILL_EMAIL, EXPECT_WELCOME],
    });
  });

  it("asks for a name and at least one step", async () => {
    const user = userEvent.setup();
    renderEditor({ initialPlan: { ...STARTING_PLAN, steps: [CLICK_SIGN_IN] } });

    await replaceFieldText(user, "Plan name", "");
    await user.click(screen.getByRole("button", { name: "Delete step 1" }));

    const problemItems = within(screen.getByRole("list", { name: "Plan problems" })).getAllByRole("listitem");
    expect(problemItems.map((problemItem) => problemItem.textContent)).toEqual([
      "Name: may not be blank",
      "Steps: a plan needs at least one step",
    ]);
    expect(getSaveButton()).toBeDisabled();
  });

  it("calls onCancel on Cancel without saving", async () => {
    const user = userEvent.setup();
    const { onSave, onCancel } = renderEditor();

    await replaceFieldText(user, "Plan name", "Changed");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("shows why the last save failed", () => {
    renderEditor({ saveErrorMessage: "Step 1 (Click): needs an element to act on" });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not save: Step 1 (Click): needs an element to act on",
    );
  });

  it("disables everything and says Saving… while the save is in flight", async () => {
    const user = userEvent.setup();
    const { renderResult, onSave } = renderEditor();
    await replaceFieldText(user, "Plan name", "Log in again");

    renderResult.rerender(
      <ActionPlanEditor
        initialPlan={STARTING_PLAN}
        isSaving
        saveErrorMessage={null}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add step" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Plan name" })).toHaveValue("Log in again");
    for (const textField of screen.getAllByRole("textbox")) {
      expect(textField).toBeDisabled();
    }
    for (const actionSelect of screen.getAllByRole("combobox", { name: /^Action/ })) {
      expect(actionSelect).toHaveAttribute("aria-disabled", "true");
    }
    expect(screen.getByRole("button", { name: "Delete step 1" })).toBeDisabled();
  });

  it("moves a step with the keyboard: focus its drag handle, Space, an arrow key, Space", async () => {
    const user = userEvent.setup();
    layOutStepCardsVertically();
    const { onSave } = renderEditor();

    screen.getByRole("button", { name: "Drag step 1" }).focus();
    await user.keyboard("[Space]");
    await user.keyboard("[ArrowDown]");
    await user.keyboard("[Space]");

    await waitFor(() => {
      expect(readStepActions()).toEqual(["Type text", "Click", "Expect visible"]);
    });
    await user.click(getSaveButton());
    expect(onSave).toHaveBeenCalledWith({ ...STARTING_PLAN, steps: [FILL_EMAIL, CLICK_SIGN_IN, EXPECT_WELCOME] });
  });

  it("moves a step up with the keyboard, and leaves the order alone when the drag is dropped where it started", async () => {
    const user = userEvent.setup();
    layOutStepCardsVertically();
    renderEditor();

    screen.getByRole("button", { name: "Drag step 3" }).focus();
    await user.keyboard("[Space]");
    await user.keyboard("[ArrowUp]");
    await user.keyboard("[Space]");
    await waitFor(() => {
      expect(readStepActions()).toEqual(["Click", "Expect visible", "Type text"]);
    });

    screen.getByRole("button", { name: "Drag step 1" }).focus();
    await user.keyboard("[Space]");
    await user.keyboard("[Space]");

    expect(readStepActions()).toEqual(["Click", "Expect visible", "Type text"]);
  });
});
