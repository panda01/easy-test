import { type ReactElement, useState } from "react";
import { describe, it, expect, vi, type Mock } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { userEvent, type UserEvent } from "@testing-library/user-event";
import { DndContext } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import ActionPlanStepFields, {
  type ActionPlanStepFieldsProps,
} from "../../src/components/ActionPlanStepFields";
import {
  ARIA_ROLES,
  PLAN_KEYS,
  PLAN_STEP_ACTIONS,
  type PlanStep,
  changePlanStepAction,
  readPlanStepRule,
} from "../../src/utils/actionPlanSteps";

const CLIENT_ID = "plan-step-a";

/** A click on the "Sign in" button. */
const CLICK_SIGN_IN: PlanStep = {
  action: "click",
  target: { role: "button", name: "Sign in" },
  value: null,
};

/** The spies a rendered card reports to. */
interface StepFieldsSpies {
  /** Receives every changed step. */
  onChange: Mock<(clientId: string, step: PlanStep) => void>;
  /** Receives every move request. */
  onMove: Mock<(clientId: string, offset: -1 | 1) => void>;
  /** Receives every delete request. */
  onDelete: Mock<(clientId: string) => void>;
}

/**
 * Hosts one step card the way the editor does - inside a dnd-kit context and
 * a sortable list - and keeps the step in state, so typed and picked values
 * show up in the fields like they do in the editor.
 * @param props - The card's props; `step` is only the starting step
 * @returns The card inside its drag-and-drop contexts
 */
function StepFieldsHarness(props: ActionPlanStepFieldsProps): ReactElement {
  const { onChange } = props;
  const [step, setStep] = useState(props.step);

  /**
   * Reports the change and shows it.
   * @param clientId - The card's id
   * @param changedStep - The step after the change
   */
  const handleChange = (clientId: string, changedStep: PlanStep): void => {
    onChange(clientId, changedStep);
    setStep(changedStep);
  };

  return (
    <DndContext>
      <SortableContext items={[props.clientId]}>
        <ol>
          <ActionPlanStepFields {...props} step={step} onChange={handleChange} />
        </ol>
      </SortableContext>
    </DndContext>
  );
}

/**
 * Renders step 2 of a longer plan (so it can move both ways), a click on the
 * "Sign in" button by default.
 * @param overrides - Props to replace in the defaults
 * @returns The spies the card reports to
 */
function renderStepFields(overrides: Partial<ActionPlanStepFieldsProps> = {}): StepFieldsSpies {
  const spies: StepFieldsSpies = { onChange: vi.fn(), onMove: vi.fn(), onDelete: vi.fn() };
  render(
    <StepFieldsHarness
      clientId={CLIENT_ID}
      stepNumber={2}
      step={CLICK_SIGN_IN}
      isFirst={false}
      isLast={false}
      isDisabled={false}
      {...spies}
      {...overrides}
    />,
  );
  return spies;
}

/**
 * Opens one of the card's dropdowns and picks an option.
 * @param user - The user-event session
 * @param selectName - The dropdown's accessible name pattern (its label comes first)
 * @param optionName - The option's text
 */
async function pickFromSelect(user: UserEvent, selectName: RegExp, optionName: string): Promise<void> {
  await user.click(screen.getByRole("combobox", { name: selectName }));
  await user.click(await screen.findByRole("option", { name: optionName }));
}

/**
 * Reads the options a dropdown offers, then closes it again.
 * @param user - The user-event session
 * @param selectName - The dropdown's accessible name pattern
 * @returns Each option's text, in order
 */
async function readSelectOptions(user: UserEvent, selectName: RegExp): Promise<string[]> {
  await user.click(screen.getByRole("combobox", { name: selectName }));
  const optionList = await screen.findByRole("listbox");
  const optionTexts = within(optionList)
    .getAllByRole("option")
    .map((option) => option.textContent);
  await user.keyboard("{Escape}");
  return optionTexts;
}

/**
 * Reads the step the card last reported.
 * @param onChange - The card's change spy
 * @returns The step from the most recent call
 */
function readLastReportedStep(onChange: StepFieldsSpies["onChange"]): PlanStep | undefined {
  return onChange.mock.lastCall?.[1];
}

describe("ActionPlanStepFields", () => {
  it("shows the step's number, its action, and how its element is found, with no value field for a click", () => {
    renderStepFields();

    const card = screen.getByRole("listitem", { name: "Step 2" });
    expect(within(card).getByRole("heading", { name: "Step 2" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /^Action/ })).toHaveTextContent("Click");
    expect(screen.getByRole("combobox", { name: /^Find element by/ })).toHaveTextContent("Role and name");
    expect(screen.getByRole("combobox", { name: /^Role/ })).toHaveTextContent("button");
    expect(screen.getByRole("textbox", { name: "Name (blank for any)" })).toHaveValue("Sign in");
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Drag step 2" })).toBeEnabled();
  });

  it("offers every step action by its label", async () => {
    const user = userEvent.setup();
    renderStepFields();

    expect(await readSelectOptions(user, /^Action/)).toEqual(
      PLAN_STEP_ACTIONS.map((action) => readPlanStepRule(action).label),
    );
  });

  it("changes the action with changePlanStepAction, keeping the element when the new action takes one", async () => {
    const user = userEvent.setup();
    const { onChange } = renderStepFields();

    await pickFromSelect(user, /^Action/, "Hover");

    expect(onChange).toHaveBeenLastCalledWith(CLIENT_ID, changePlanStepAction(CLICK_SIGN_IN, "hover"));
    expect(readLastReportedStep(onChange)).toEqual({
      action: "hover",
      target: { role: "button", name: "Sign in" },
      value: null,
    });
    expect(screen.getByRole("textbox", { name: "Name (blank for any)" })).toHaveValue("Sign in");
  });

  it("drops the element fields and shows the value field when the new action takes no element", async () => {
    const user = userEvent.setup();
    const { onChange } = renderStepFields();

    await pickFromSelect(user, /^Action/, "Go to address");

    expect(onChange).toHaveBeenLastCalledWith(CLIENT_ID, changePlanStepAction(CLICK_SIGN_IN, "goto"));
    expect(screen.queryByRole("combobox", { name: /^Find element by/ })).not.toBeInTheDocument();
    const urlField = screen.getByRole("textbox", { name: "URL" });
    expect(urlField).toHaveValue("");
    expect(urlField).not.toHaveAccessibleDescription();

    await user.type(urlField, "https://example.com/account");
    expect(readLastReportedStep(onChange)).toEqual({
      action: "goto",
      target: null,
      value: "https://example.com/account",
    });
  });

  it("offers every way of finding an element, and only offers 'No element' for an action where it is optional", async () => {
    const user = userEvent.setup();
    renderStepFields();

    const elementKinds = [
      "Role and name",
      "Label",
      "Placeholder",
      "Visible text",
      "Image alt text",
      "Title (tooltip)",
      "CSS selector (last resort)",
    ];
    expect(await readSelectOptions(user, /^Find element by/)).toEqual(elementKinds);

    await pickFromSelect(user, /^Action/, "Press key");

    expect(await readSelectOptions(user, /^Find element by/)).toEqual([
      "No element (where the focus is)",
      ...elementKinds,
    ]);
  });

  it("changes how the element is found, keeping the text already typed", async () => {
    const user = userEvent.setup();
    const { onChange } = renderStepFields();

    await pickFromSelect(user, /^Find element by/, "Label");

    expect(onChange).toHaveBeenLastCalledWith(CLIENT_ID, { ...CLICK_SIGN_IN, target: { label: "Sign in" } });
    expect(screen.queryByRole("combobox", { name: /^Role/ })).not.toBeInTheDocument();
    const labelField = screen.getByRole("textbox", { name: "Label" });
    expect(labelField).toHaveValue("Sign in");

    await user.clear(labelField);
    await user.type(labelField, "Email");
    expect(readLastReportedStep(onChange)).toEqual({ ...CLICK_SIGN_IN, target: { label: "Email" } });

    await pickFromSelect(user, /^Find element by/, "CSS selector (last resort)");
    expect(readLastReportedStep(onChange)).toEqual({ ...CLICK_SIGN_IN, target: { css: "Email" } });
    expect(screen.getByRole("textbox", { name: "CSS selector (last resort)" })).toHaveValue("Email");

    await pickFromSelect(user, /^Find element by/, "Role and name");
    expect(readLastReportedStep(onChange)).toEqual({
      ...CLICK_SIGN_IN,
      target: { role: "button", name: "Email" },
    });
  });

  it("lets a press step act where the focus is, and find an element again", async () => {
    const user = userEvent.setup();
    const pressInSearch: PlanStep = {
      action: "press",
      target: { role: "textbox", name: "Search" },
      value: "Enter",
    };
    const { onChange } = renderStepFields({ step: pressInSearch });

    await pickFromSelect(user, /^Find element by/, "No element (where the focus is)");

    expect(onChange).toHaveBeenLastCalledWith(CLIENT_ID, { ...pressInSearch, target: null });
    expect(screen.getByRole("combobox", { name: /^Find element by/ })).toHaveTextContent(
      "No element (where the focus is)",
    );
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /^Role/ })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /^Key/ })).toHaveTextContent("Enter");

    await pickFromSelect(user, /^Find element by/, "Visible text");
    expect(readLastReportedStep(onChange)).toEqual({ ...pressInSearch, target: { text: "" } });
    expect(screen.getByRole("textbox", { name: "Visible text" })).toHaveValue("");
  });

  it("changes a role target's role, keeping its name, from every ARIA role", async () => {
    const user = userEvent.setup();
    const { onChange } = renderStepFields();

    expect(await readSelectOptions(user, /^Role/)).toEqual([...ARIA_ROLES]);
    await pickFromSelect(user, /^Role/, "link");

    expect(onChange).toHaveBeenLastCalledWith(CLIENT_ID, {
      ...CLICK_SIGN_IN,
      target: { role: "link", name: "Sign in" },
    });
    expect(screen.getByRole("combobox", { name: /^Role/ })).toHaveTextContent("link");
  });

  it("changes a role target's name as it is typed", async () => {
    const user = userEvent.setup();
    const { onChange } = renderStepFields();
    const nameField = screen.getByRole("textbox", { name: "Name (blank for any)" });

    await user.clear(nameField);
    expect(readLastReportedStep(onChange)).toEqual({ ...CLICK_SIGN_IN, target: { role: "button", name: "" } });
    await user.type(nameField, "Log in");

    expect(readLastReportedStep(onChange)).toEqual({
      ...CLICK_SIGN_IN,
      target: { role: "button", name: "Log in" },
    });
  });

  it("picks a Press key step's key from the listed keys", async () => {
    const user = userEvent.setup();
    const pressEnter: PlanStep = { action: "press", target: null, value: "Enter" };
    const { onChange } = renderStepFields({ step: pressEnter });

    expect(await readSelectOptions(user, /^Key/)).toEqual([...PLAN_KEYS]);
    await pickFromSelect(user, /^Key/, "Tab");

    expect(onChange).toHaveBeenLastCalledWith(CLIENT_ID, { ...pressEnter, value: "Tab" });
    expect(screen.getByRole("combobox", { name: /^Key/ })).toHaveTextContent("Tab");
  });

  it("answers the next dialog with accept or dismiss", async () => {
    const user = userEvent.setup();
    const acceptDialog: PlanStep = { action: "respondToNextDialog", target: null, value: "accept" };
    const { onChange } = renderStepFields({ step: acceptDialog });

    expect(screen.queryByRole("combobox", { name: /^Find element by/ })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /^Answer/ })).toHaveTextContent("Accept (OK)");
    expect(await readSelectOptions(user, /^Answer/)).toEqual(["Accept (OK)", "Dismiss (Cancel)"]);
    await pickFromSelect(user, /^Answer/, "Dismiss (Cancel)");

    expect(onChange).toHaveBeenLastCalledWith(CLIENT_ID, { ...acceptDialog, value: "dismiss" });
  });

  it("types a Type text step's text, explaining the credential placeholders", async () => {
    const user = userEvent.setup();
    const fillEmail: PlanStep = { action: "fill", target: { label: "Email" }, value: null };
    const { onChange } = renderStepFields({ step: fillEmail });

    const textField = screen.getByRole("textbox", { name: "Text to type" });
    expect(textField).toHaveValue("");
    expect(textField).toHaveAccessibleDescription(
      "Or {{credential.username}} / {{credential.password}} to type the action's credential",
    );

    await user.type(textField, "{{{{credential.username}}");
    expect(readLastReportedStep(onChange)).toEqual({ ...fillEmail, value: "{{credential.username}}" });
  });

  it("disables Move up on the first step and Move down on the last, and reports moves", async () => {
    const user = userEvent.setup();
    const { onMove } = renderStepFields();

    await user.click(screen.getByRole("button", { name: "Move step 2 up" }));
    await user.click(screen.getByRole("button", { name: "Move step 2 down" }));

    expect(onMove.mock.calls).toEqual([
      [CLIENT_ID, -1],
      [CLIENT_ID, 1],
    ]);
  });

  it.each([
    { position: "first", isFirst: true, isLast: false, upIsEnabled: false, downIsEnabled: true },
    { position: "last", isFirst: false, isLast: true, upIsEnabled: true, downIsEnabled: false },
    { position: "only", isFirst: true, isLast: true, upIsEnabled: false, downIsEnabled: false },
  ])("only lets the $position step move where it can", ({ isFirst, isLast, upIsEnabled, downIsEnabled }) => {
    renderStepFields({ isFirst, isLast });

    const moveUpButton = screen.getByRole("button", { name: "Move step 2 up" });
    const moveDownButton = screen.getByRole("button", { name: "Move step 2 down" });
    expect(moveUpButton.hasAttribute("disabled")).toBe(!upIsEnabled);
    expect(moveDownButton.hasAttribute("disabled")).toBe(!downIsEnabled);
  });

  it("reports Delete", async () => {
    const user = userEvent.setup();
    const { onDelete } = renderStepFields();

    await user.click(screen.getByRole("button", { name: "Delete step 2" }));

    expect(onDelete).toHaveBeenCalledWith(CLIENT_ID);
  });

  it("disables every field and button while the plan is being saved", () => {
    renderStepFields({ isDisabled: true, step: { action: "fill", target: { role: "textbox", name: "Email" }, value: "x" } });

    for (const selectName of [/^Action/, /^Find element by/, /^Role/]) {
      expect(screen.getByRole("combobox", { name: selectName })).toHaveAttribute("aria-disabled", "true");
    }
    for (const textField of screen.getAllByRole("textbox")) {
      expect(textField).toBeDisabled();
    }
    for (const buttonName of ["Drag step 2", "Move step 2 up", "Move step 2 down", "Delete step 2"]) {
      expect(screen.getByRole("button", { name: buttonName })).toBeDisabled();
    }
  });
});
