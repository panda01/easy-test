import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import ActionScriptDetails from "../../src/components/ActionScriptDetails";
import { type ScriptModelOption } from "../../src/hooks/useScriptModels";
import { buildActionScriptRecord, buildScriptModelCatalog } from "./support/frontendTestHelpers";

const catalogModels: ScriptModelOption[] = buildScriptModelCatalog().models;

/** The action as it is now - the same text the default script was generated from. */
const currentAction = { title: "Log in", description: "Sign in with a valid account" };

describe("ActionScriptDetails", () => {
  it("shows the version, how it was generated, the summary, the assumptions, and the code", () => {
    render(<ActionScriptDetails script={buildActionScriptRecord()} versionNumber={3} currentAction={currentAction} catalogModels={catalogModels} />);

    expect(screen.getByRole("heading", { name: "Version 3" })).toBeInTheDocument();
    expect(
      screen.getByText(
        /^Generated .+ · Claude Opus 5\.5 \(claude-opus-5-5\) · high effort · START_URL https:\/\/example\.com$/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Opens the site and signs in.")).toBeInTheDocument();
    const assumptions = screen.getByRole("list", { name: "Assumptions" });
    expect(within(assumptions).getByText("The sign-in button is labelled Sign in")).toBeInTheDocument();
    expect(screen.getByLabelText("Script code")).toHaveTextContent("// script-1 steps");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says so when Claude recorded no assumptions", () => {
    render(<ActionScriptDetails script={buildActionScriptRecord({ assumptions: [] })} versionNumber={1} currentAction={currentAction} catalogModels={catalogModels} />);

    expect(screen.getByText("No assumptions recorded.")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Assumptions" })).not.toBeInTheDocument();
  });

  it("warns about each rule violation, noting the script can still be run", () => {
    const ruleViolations = ["Line 4: .fill( - sets a whole value at once; type with pressSequentially"];

    render(
      <ActionScriptDetails script={buildActionScriptRecord({ ruleViolations })} versionNumber={1} currentAction={currentAction} catalogModels={catalogModels} />,
    );

    const warning = screen.getByRole("alert");
    expect(warning).toHaveTextContent("1 rule warning");
    expect(warning).toHaveTextContent("It is saved and can still be run.");
    expect(within(warning).getByText(ruleViolations[0])).toBeInTheDocument();
  });

  it("always shows the title and description the version was generated from", () => {
    render(
      <ActionScriptDetails
        script={buildActionScriptRecord()}
        versionNumber={1}
        currentAction={currentAction}
        catalogModels={catalogModels}
      />,
    );

    expect(screen.getByRole("heading", { name: "Generated from" })).toBeInTheDocument();
    expect(screen.getByText("Log in")).toBeInTheDocument();
    expect(screen.getByText("Sign in with a valid account")).toBeInTheDocument();
    expect(screen.queryByText("Out of date")).not.toBeInTheDocument();
  });

  it.each([
    ["title", { title: "Log in to the shop", description: "Sign in with a valid account" }],
    ["description", { title: "Log in", description: "A new description" }],
    ["title and description", { title: "Log in to the shop", description: "A new description" }],
  ])("warns that the version is out of date when the %s changed", (changedText, action) => {
    render(
      <ActionScriptDetails
        script={buildActionScriptRecord()}
        versionNumber={1}
        currentAction={action}
        catalogModels={catalogModels}
      />,
    );

    const warnings = screen.getAllByRole("alert");
    expect(warnings[0]).toHaveTextContent("Out of date");
    expect(warnings[0]).toHaveTextContent(
      `This version was generated from a different ${changedText} than the action has now. Convert again to get a script for the current text.`,
    );
  });
});
