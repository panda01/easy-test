import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import ActionPlanSteps from "../../src/components/ActionPlanSteps";
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

describe("ActionPlanSteps", () => {
  it("says where the plan starts, then lists every step as a numbered sentence in order", () => {
    render(<ActionPlanSteps plan={LOGIN_PLAN} />);

    expect(screen.getByText("Starts at https://example.com/login")).toBeInTheDocument();
    const stepList = screen.getByRole("list", { name: "Plan steps" });
    expect(stepList.tagName).toBe("OL");
    expect(within(stepList).getAllByRole("listitem").map((stepItem) => stepItem.textContent)).toEqual([
      `Type the credential's username into the field labelled "Email"`,
      `Type the credential's password into the field labelled "Password"`,
      'Click button "Sign in"',
      'Check that heading "Welcome" is visible',
    ]);
  });

  it("names typed credential placeholders instead of showing them", () => {
    render(<ActionPlanSteps plan={LOGIN_PLAN} />);

    expect(screen.queryByText(/\{\{credential\./)).not.toBeInTheDocument();
  });

  it("lists the same step twice when the plan repeats it", () => {
    const repeatedStep = { action: "press" as const, target: null, value: "Tab" };
    render(
      <ActionPlanSteps
        plan={{ name: "Tab twice", startUrl: "https://example.com/", steps: [repeatedStep, repeatedStep] }}
      />,
    );

    const stepItems = within(screen.getByRole("list", { name: "Plan steps" })).getAllByRole("listitem");
    expect(stepItems.map((stepItem) => stepItem.textContent)).toEqual(["Press Tab", "Press Tab"]);
  });
});
