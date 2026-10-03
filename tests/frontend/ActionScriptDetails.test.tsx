import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import ActionScriptDetails from "../../src/components/ActionScriptDetails";
import { buildActionScriptRecord } from "./support/frontendTestHelpers";

describe("ActionScriptDetails", () => {
  it("shows the version, how it was generated, the summary, the assumptions, and the code", () => {
    render(<ActionScriptDetails script={buildActionScriptRecord()} versionNumber={3} />);

    expect(screen.getByRole("heading", { name: "Version 3" })).toBeInTheDocument();
    expect(
      screen.getByText(/^Generated .+ · claude-opus-5-5 · START_URL https:\/\/example\.com$/),
    ).toBeInTheDocument();
    expect(screen.getByText("Opens the site and signs in.")).toBeInTheDocument();
    const assumptions = screen.getByRole("list", { name: "Assumptions" });
    expect(within(assumptions).getByText("The sign-in button is labelled Sign in")).toBeInTheDocument();
    expect(screen.getByLabelText("Script code")).toHaveTextContent("// script-1 steps");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says so when Claude recorded no assumptions", () => {
    render(<ActionScriptDetails script={buildActionScriptRecord({ assumptions: [] })} versionNumber={1} />);

    expect(screen.getByText("No assumptions recorded.")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Assumptions" })).not.toBeInTheDocument();
  });

  it("warns about each rule violation, noting the script can still be run", () => {
    const ruleViolations = ["Line 4: .fill( - sets a whole value at once; type with pressSequentially"];

    render(
      <ActionScriptDetails script={buildActionScriptRecord({ ruleViolations })} versionNumber={1} />,
    );

    const warning = screen.getByRole("alert");
    expect(warning).toHaveTextContent("1 rule warning");
    expect(warning).toHaveTextContent("It is saved and can still be run.");
    expect(within(warning).getByText(ruleViolations[0])).toBeInTheDocument();
  });
});
