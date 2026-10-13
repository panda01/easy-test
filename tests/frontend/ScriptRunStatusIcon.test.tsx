import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { amber } from "@mui/material/colors";
import ScriptRunStatusIcon from "../../src/components/ScriptRunStatusIcon";

describe("ScriptRunStatusIcon", () => {
  it("shows a green check named 'Latest run passed' when the latest run passed", () => {
    render(<ScriptRunStatusIcon latestRun={{ succeeded: true }} />);

    const statusIcon = screen.getByRole("img", { name: "Latest run passed" });
    expect(statusIcon).toHaveAttribute("data-testid", "CheckCircleIcon");
    expect(statusIcon).toHaveClass("MuiSvgIcon-colorSuccess");
  });

  it("shows a red X named 'Latest run failed' when the latest run failed", () => {
    render(<ScriptRunStatusIcon latestRun={{ succeeded: false }} />);

    const statusIcon = screen.getByRole("img", { name: "Latest run failed" });
    expect(statusIcon).toHaveAttribute("data-testid", "CancelIcon");
    expect(statusIcon).toHaveClass("MuiSvgIcon-colorError");
  });

  it("shows a yellow exclamation named 'Not run yet' when there are no runs", () => {
    render(<ScriptRunStatusIcon latestRun={null} />);

    const statusIcon = screen.getByRole("img", { name: "Not run yet" });
    expect(statusIcon).toHaveAttribute("data-testid", "ErrorIcon");
    expect(statusIcon).toHaveStyle({ color: amber[400] });
  });
});
