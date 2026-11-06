import { describe, it, expect } from "vitest";
import { plansAreIdentical } from "../../../server/utils/plansAreIdentical.js";

/** A two-step plan, written in the field order Claude answers with. */
const SIGN_IN_PLAN = {
  name: "Log in",
  startUrl: "https://example.com/",
  steps: [
    { action: "click", target: { role: "button", name: "Sign in" }, value: null },
    { action: "expectVisible", target: { text: "Welcome back" }, value: null },
  ],
};

describe("plansAreIdentical", () => {
  it("treats a plan as identical to itself", () => {
    expect(plansAreIdentical(SIGN_IN_PLAN, SIGN_IN_PLAN)).toBe(true);
  });

  it("ignores the order of keys, at the top level and inside each step and target", () => {
    const reorderedPlan = {
      steps: [
        { value: null, target: { name: "Sign in", role: "button" }, action: "click" },
        { target: { text: "Welcome back" }, action: "expectVisible", value: null },
      ],
      startUrl: "https://example.com/",
      name: "Log in",
    };

    expect(plansAreIdentical(SIGN_IN_PLAN, reorderedPlan)).toBe(true);
  });

  it("detects a changed step", () => {
    const renamedButtonPlan = {
      ...SIGN_IN_PLAN,
      steps: [
        { action: "click", target: { role: "button", name: "Log in" }, value: null },
        SIGN_IN_PLAN.steps[1],
      ],
    };

    expect(plansAreIdentical(SIGN_IN_PLAN, renamedButtonPlan)).toBe(false);
  });

  it("detects an added step", () => {
    const longerPlan = {
      ...SIGN_IN_PLAN,
      steps: [...SIGN_IN_PLAN.steps, { action: "click", target: { role: "link", name: "Home" }, value: null }],
    };

    expect(plansAreIdentical(SIGN_IN_PLAN, longerPlan)).toBe(false);
  });

  it("keeps arrays order-sensitive: the same steps in another order are another plan", () => {
    const swappedStepsPlan = {
      ...SIGN_IN_PLAN,
      steps: [SIGN_IN_PLAN.steps[1], SIGN_IN_PLAN.steps[0]],
    };

    expect(plansAreIdentical(SIGN_IN_PLAN, swappedStepsPlan)).toBe(false);
  });

  it("tells a null value from a missing one", () => {
    const planWithoutValues = {
      ...SIGN_IN_PLAN,
      steps: SIGN_IN_PLAN.steps.map(({ action, target }) => ({ action, target })),
    };

    expect(plansAreIdentical(SIGN_IN_PLAN, planWithoutValues)).toBe(false);
  });

  it("compares primitives and nulls as values", () => {
    expect(plansAreIdentical(null, null)).toBe(true);
    expect(plansAreIdentical(null, SIGN_IN_PLAN)).toBe(false);
    expect(plansAreIdentical("a", "a")).toBe(true);
    expect(plansAreIdentical(1, "1")).toBe(false);
  });
});
