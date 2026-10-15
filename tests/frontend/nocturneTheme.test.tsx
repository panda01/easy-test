import { type ReactElement } from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import Button from "@mui/material/Button";
import { ThemeProvider } from "@mui/material/styles";
import {
  crawlSeverityColors,
  nocturneTheme,
  nocturneTokens,
  runStatusColors,
  statusColors,
} from "../../src/theme/nocturneTheme";

/**
 * Renders one button inside the Nocturne theme, as the app does.
 * @param button - The button to render
 */
function renderInTheme(button: ReactElement): void {
  render(<ThemeProvider theme={nocturneTheme}>{button}</ThemeProvider>);
}

/**
 * Reads the styles jsdom computed for a button. Outlined buttons get their
 * text color from MUI's `--variant-outlinedColor` variable, which jsdom does
 * not resolve, so that variable is read instead.
 * @param buttonName - The button's accessible name
 * @returns Its fill, outline color, and text color (as rendered or as the variable)
 */
function readButtonColors(buttonName: string): {
  fill: string;
  outline: string;
  text: string;
  outlinedText: string;
} {
  const buttonStyle = getComputedStyle(screen.getByRole("button", { name: buttonName }));
  return {
    fill: buttonStyle.backgroundColor,
    outline: buttonStyle.borderTopColor,
    text: buttonStyle.color,
    outlinedText: buttonStyle.getPropertyValue("--variant-outlinedColor"),
  };
}

describe("nocturneTheme", () => {
  it("is dark, on Nocturne's ground, surface, text, and accent", () => {
    const { palette } = nocturneTheme;
    expect(palette.mode).toBe("dark");
    expect(palette.background.default).toBe(nocturneTokens.background);
    expect(palette.background.paper).toBe(nocturneTokens.surface);
    expect(palette.text.primary).toBe(nocturneTokens.text);
    expect(palette.primary.main).toBe(nocturneTokens.accent);
  });

  it("speaks the one status language: passed, failed, and stale as success, error, and warning", () => {
    const { palette } = nocturneTheme;
    expect(palette.success.main).toBe(statusColors.passed);
    expect(palette.error.main).toBe(statusColors.failed);
    expect(palette.warning.main).toBe(statusColors.stale);
    expect(runStatusColors).toEqual({
      passed: statusColors.passed,
      failed: statusColors.failed,
      notRun: statusColors.notRun,
    });
    expect(crawlSeverityColors).toEqual({
      info: statusColors.running,
      success: statusColors.passed,
      warning: statusColors.stale,
      error: statusColors.failed,
    });
  });

  it("draws a contained button as an accent outline on a transparent ground, never a fill", () => {
    renderInTheme(<Button variant="contained">Save</Button>);

    const buttonColors = readButtonColors("Save");
    expect(buttonColors.fill).toBe("rgba(0, 0, 0, 0)");
    expect(buttonColors.outline).toBe("rgb(145, 132, 217)");
    expect(buttonColors.text).toBe("rgb(145, 132, 217)");
  });

  it("outlines a contained button in its own color when it has one, e.g. a red Delete", () => {
    renderInTheme(
      <Button variant="contained" color="error">
        Delete
      </Button>,
    );

    const buttonColors = readButtonColors("Delete");
    expect(buttonColors.text).toBe("rgb(240, 127, 119)");
    expect(buttonColors.outline).toBe("rgb(240, 127, 119)");
  });

  it("keeps an inherit-colored contained button on the accent", () => {
    renderInTheme(
      <Button variant="contained" color="inherit">
        Go
      </Button>,
    );

    expect(screen.getByRole("button", { name: "Go" })).toHaveStyle({ color: nocturneTokens.accent });
  });

  it("draws the secondary button with the divider outline in the text color", () => {
    renderInTheme(
      <Button variant="outlined" color="secondary">
        Edit
      </Button>,
    );

    const buttonColors = readButtonColors("Edit");
    expect(buttonColors.outlinedText).toBe(nocturneTokens.text);
    expect(buttonColors.outline).toBe("rgba(233, 233, 237, 0.16)");
  });

  it("keeps an outlined primary button's own outline", () => {
    renderInTheme(<Button variant="outlined">New action</Button>);

    expect(readButtonColors("New action").outlinedText).toBe(nocturneTokens.accent);
  });

  it("fades a disabled button instead of greying it out", () => {
    renderInTheme(
      <Button variant="contained" disabled>
        Crawl website
      </Button>,
    );

    expect(screen.getByRole("button", { name: "Crawl website" })).toHaveStyle({
      opacity: "0.45",
      color: nocturneTokens.accent,
    });
  });

  it("never uppercases button text", () => {
    renderInTheme(<Button>Run again</Button>);

    expect(screen.getByRole("button", { name: "Run again" })).toHaveStyle({ textTransform: "none" });
  });
});
