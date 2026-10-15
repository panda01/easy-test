import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ScriptRunStatusIcon from "../../src/components/ScriptRunStatusIcon";
import { statusColors } from "../../src/theme/nocturneTheme";

describe("ScriptRunStatusIcon", () => {
  it("shows a green outlined check named 'Latest run passed' when the latest run passed", () => {
    render(<ScriptRunStatusIcon latestRun={{ succeeded: true }} />);

    const statusIcon = screen.getByRole("img", { name: "Latest run passed" });
    expect(statusIcon).toHaveAttribute("data-testid", "CheckCircleOutlineIcon");
    expect(statusIcon).toHaveStyle({ color: statusColors.passed });
  });

  it("shows a red outlined X named 'Latest run failed' when the latest run failed", () => {
    render(<ScriptRunStatusIcon latestRun={{ succeeded: false }} />);

    const statusIcon = screen.getByRole("img", { name: "Latest run failed" });
    expect(statusIcon).toHaveAttribute("data-testid", "HighlightOffIcon");
    expect(statusIcon).toHaveStyle({ color: statusColors.failed });
  });

  it("shows a grey dashed circle named 'Not run yet' when there are no runs", () => {
    render(<ScriptRunStatusIcon latestRun={null} />);

    const statusIcon = screen.getByRole("img", { name: "Not run yet" });
    expect(statusIcon).toHaveAttribute("data-testid", "NotRunIcon");
    expect(statusIcon).toHaveStyle({ color: statusColors.notRun });
  });

  it("draws at the size asked for (18 px unless told otherwise)", () => {
    const { rerender } = render(<ScriptRunStatusIcon latestRun={null} />);
    expect(screen.getByRole("img", { name: "Not run yet" })).toHaveStyle({ fontSize: "18px" });

    rerender(<ScriptRunStatusIcon latestRun={null} size={15} />);
    expect(screen.getByRole("img", { name: "Not run yet" })).toHaveStyle({ fontSize: "15px" });
  });
});
