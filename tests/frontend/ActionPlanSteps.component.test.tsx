import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import ActionPlanSteps from "../../src/components/ActionPlanSteps";
import { statusColors } from "../../src/theme/nocturneTheme";
import { CREDENTIAL_PLACEHOLDERS, type ActionPlan } from "../../src/utils/actionPlanSteps";

/*
 * Covers src/components/ActionPlanSteps.tsx. It is not named
 * `ActionPlanSteps.test.tsx` because that name differs from
 * `actionPlanSteps.test.tsx` (the spec of src/utils/actionPlanSteps.ts) only in
 * case, and the two would be the same file on a case-insensitive file system.
 */

/** A login plan that types the action's credential, so placeholders can be checked. */
const LOGIN_PLAN: ActionPlan = {
  name: "Log in",
  startUrl: "https://example.com/login",
  steps: [
    { action: "fill", target: { label: "Email" }, value: CREDENTIAL_PLACEHOLDERS.username },
    { action: "fill", target: { label: "Password" }, value: CREDENTIAL_PLACEHOLDERS.password },
    { action: "click", target: { role: "button", name: "Sign in" }, value: null },
    { action: "expectVisible", target: { role: "heading", name: "Welcome" }, value: null },
  ],
};

/** A run that failed at step 3 with a two-line error. */
const RUN_FAILED_AT_STEP_3 = {
  succeeded: false,
  failedStepNumber: 3,
  errorMessage: 'locator.click: Timeout 10000ms exceeded.\nwaiting for button "Sign in"',
};

/**
 * Reads the step list's items.
 * @returns The list items, in order
 */
function getStepItems(): HTMLElement[] {
  return within(screen.getByRole("list", { name: "Plan steps" })).getAllByRole("listitem");
}

/**
 * Finds the step number shown in a step's row.
 * @param stepItem - The step's list item
 * @returns The number's element
 */
function getStepNumber(stepItem: HTMLElement): HTMLElement {
  const stepNumber = stepItem.firstElementChild;
  if (!(stepNumber instanceof HTMLElement)) throw new Error("The step row has no number");
  return stepNumber;
}

describe("ActionPlanSteps", () => {
  it("says where the plan starts, then lists every step with its number, in order", () => {
    render(<ActionPlanSteps plan={LOGIN_PLAN} highlightedRun={null} isCompact={false} />);

    expect(screen.getByText("Starts at https://example.com/login")).toBeInTheDocument();
    const stepList = screen.getByRole("list", { name: "Plan steps" });
    expect(stepList.tagName).toBe("OL");
    expect(getStepItems().map((stepItem) => stepItem.textContent)).toEqual([
      `1Type the credential's username into the field labelled "Email"`,
      `2Type the credential's password into the field labelled "Password"`,
      '3Click button "Sign in"',
      '4Check that heading "Welcome" is visible',
    ]);
  });

  it("mutes each step's verb", () => {
    render(<ActionPlanSteps plan={LOGIN_PLAN} highlightedRun={null} isCompact={false} />);

    const clickVerb = within(getStepItems()[2]).getByText("Click");
    expect(clickVerb.tagName).toBe("SPAN");
  });

  it("names typed credential placeholders instead of showing them", () => {
    render(<ActionPlanSteps plan={LOGIN_PLAN} highlightedRun={null} isCompact={false} />);

    expect(screen.queryByText(/\{\{credential\./)).not.toBeInTheDocument();
  });

  it("lists the same step twice when the plan repeats it", () => {
    const repeatedStep = { action: "press" as const, target: null, value: "Tab" };
    render(
      <ActionPlanSteps
        plan={{ name: "Tab twice", startUrl: "https://example.com/", steps: [repeatedStep, repeatedStep] }}
        highlightedRun={null}
        isCompact={false}
      />,
    );

    expect(getStepItems().map((stepItem) => stepItem.textContent)).toEqual(["1Press Tab", "2Press Tab"]);
  });

  it("marks the steps against a failed run: reached in green, the failed one with its error's first line, the rest dimmed", () => {
    render(<ActionPlanSteps plan={LOGIN_PLAN} highlightedRun={RUN_FAILED_AT_STEP_3} isCompact={false} />);

    const stepItems = getStepItems();
    expect(getStepNumber(stepItems[0])).toHaveStyle({ color: statusColors.passed });
    expect(getStepNumber(stepItems[1])).toHaveStyle({ color: statusColors.passed });
    expect(getStepNumber(stepItems[2])).toHaveStyle({ color: statusColors.failed });
    expect(stepItems[2]).toHaveTextContent("Failed here — locator.click: Timeout 10000ms exceeded.");
    expect(stepItems[2]).not.toHaveTextContent('waiting for button "Sign in"');
    expect(stepItems[3]).toHaveStyle({ opacity: "0.5" });
    expect(stepItems[0]).toHaveStyle({ opacity: "1" });
  });

  it("leaves the failed step's note out of the compact (phone) list", () => {
    render(<ActionPlanSteps plan={LOGIN_PLAN} highlightedRun={RUN_FAILED_AT_STEP_3} isCompact />);

    expect(screen.queryByText(/Failed here/)).not.toBeInTheDocument();
    expect(getStepNumber(getStepItems()[2])).toHaveStyle({ color: statusColors.failed });
  });

  it("marks every step reached for a passed run", () => {
    render(
      <ActionPlanSteps
        plan={LOGIN_PLAN}
        highlightedRun={{ succeeded: true, failedStepNumber: null, errorMessage: null }}
        isCompact={false}
      />,
    );

    for (const stepItem of getStepItems()) {
      expect(getStepNumber(stepItem)).toHaveStyle({ color: statusColors.passed });
    }
  });

  it("dims every step for a run that failed before the first step, and marks none failed", () => {
    render(
      <ActionPlanSteps
        plan={LOGIN_PLAN}
        highlightedRun={{ succeeded: false, failedStepNumber: null, errorMessage: "Login failed" }}
        isCompact={false}
      />,
    );

    for (const stepItem of getStepItems()) {
      expect(stepItem).toHaveStyle({ opacity: "0.5" });
    }
    expect(screen.queryByText(/Failed here/)).not.toBeInTheDocument();
  });
});
