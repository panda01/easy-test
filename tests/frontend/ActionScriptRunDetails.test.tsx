import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ActionScriptRunDetails from "../../src/components/ActionScriptRunDetails";
import { buildActionScriptRunRecord } from "./support/frontendTestHelpers";

describe("ActionScriptRunDetails", () => {
  it("shows a passing run's outcome, duration, and output, with no screenshot", () => {
    render(<ActionScriptRunDetails websiteId="website-1" run={buildActionScriptRunRecord()} />);

    expect(screen.getByRole("status")).toHaveTextContent("Passed · 4.3 s");
    expect(screen.getByText(/^Ran /)).toBeInTheDocument();
    expect(screen.getByLabelText("Run output")).toHaveTextContent("✔ Use case completed");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByText("No failure screenshot was captured for this run.")).not.toBeInTheDocument();
  });

  it("shows a failed run's screenshot from the failure screenshot url", () => {
    render(
      <ActionScriptRunDetails
        websiteId="website-1"
        run={buildActionScriptRunRecord({
          succeeded: false,
          exitCode: 1,
          failureScreenshotFileName: "website-1/run-folder/failure.png",
        })}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Failed · exit code 1");
    expect(screen.getByRole("img", { name: /Failure screenshot/ })).toHaveAttribute(
      "src",
      "/api/websites/website-1/actions/item-1/scripts/script-1/runs/script-run-1/failure-screenshot",
    );
  });

  it("says so when a failed run captured no screenshot", () => {
    render(
      <ActionScriptRunDetails
        websiteId="website-1"
        run={buildActionScriptRunRecord({
          succeeded: false,
          timedOut: true,
          exitCode: null,
          exitSignal: "SIGKILL",
        })}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Timed out · stopped after 5 min");
    expect(screen.getByText("No failure screenshot was captured for this run.")).toBeInTheDocument();
  });

  it("notes truncated output, and an empty output", () => {
    const { rerender } = render(
      <ActionScriptRunDetails
        websiteId="website-1"
        run={buildActionScriptRunRecord({ outputWasTruncated: true })}
      />,
    );
    expect(screen.getByText("The output was long, so only its end is kept.")).toBeInTheDocument();

    rerender(
      <ActionScriptRunDetails websiteId="website-1" run={buildActionScriptRunRecord({ output: "" })} />,
    );
    expect(screen.getByText("The script printed nothing.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Run output")).not.toBeInTheDocument();
  });
});
