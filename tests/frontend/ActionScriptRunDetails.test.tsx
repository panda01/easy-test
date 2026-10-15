import { describe, it, expect, vi } from "vitest";
import { render, screen, within, type RenderResult } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import ActionScriptRunDetails, {
  MAX_REFINE_NOTE_LENGTH,
  type ActionScriptRunDetailsProps,
} from "../../src/components/ActionScriptRunDetails";
import { buildActionScriptRunRecord } from "./support/frontendTestHelpers";

const NOTE_FIELD_NAME = "Note for Claude (optional)";

/** A failed run with an error message - the kind that can be refined. */
const failedRun = buildActionScriptRunRecord({
  succeeded: false,
  failedStepNumber: 3,
  errorMessage: 'Step 3 (Click link "Account"): Timeout 10000ms exceeded.',
  failingPageUrl: "http://localhost:3099/account",
  failingPageAriaSnapshot: '- link "Profile"',
});

/**
 * Builds the component's props: the failed run of a version Claude wrote,
 * on desktop, refining into version 6, with nothing in flight and no refine
 * error.
 * @param overrides - Props to replace in the defaults
 * @returns The complete props
 */
function buildRunDetailsProps(
  overrides: Partial<ActionScriptRunDetailsProps> = {},
): ActionScriptRunDetailsProps {
  return {
    websiteId: "website-1",
    run: failedRun,
    versionCanBeRefined: true,
    isRefining: false,
    isRunning: false,
    refineErrorMessage: null,
    onRefine: vi.fn(),
    refinedVersionNumber: 6,
    isCompact: false,
    ...overrides,
  };
}

/**
 * Renders a failed, refinable run's details by default.
 * @param overrides - Props to replace in the defaults
 * @returns The Testing Library render result
 */
function renderRunDetails(overrides: Partial<ActionScriptRunDetailsProps> = {}): RenderResult {
  return render(<ActionScriptRunDetails {...buildRunDetailsProps(overrides)} />);
}

describe("ActionScriptRunDetails", () => {
  describe("the outcome", () => {
    it("banners a passing run with its duration and when it ran, with no screenshot", () => {
      renderRunDetails({ run: buildActionScriptRunRecord(), versionCanBeRefined: false });

      const banner = screen.getByRole("status");
      expect(within(banner).getByText("Passed")).toBeInTheDocument();
      expect(banner).toHaveTextContent(/^Passed4\.3 s · .+$/);
      expect(within(banner).getByTestId("CheckCircleOutlineIcon")).toBeInTheDocument();
      expect(banner).toHaveClass("MuiAlert-standardSuccess");
      expect(screen.queryByRole("img", { name: /Failure screenshot/ })).not.toBeInTheDocument();
      expect(screen.queryByText("No failure screenshot was captured for this run.")).not.toBeInTheDocument();
    });

    it("puts the exact time it ran in the details' hover title", () => {
      const passedRun = buildActionScriptRunRecord();
      renderRunDetails({ run: passedRun, versionCanBeRefined: false });

      expect(screen.getByTitle(new Date(passedRun.createdAt).toLocaleString())).toBeInTheDocument();
    });

    it("banners the step a failed run stopped at and why, and shows its screenshot and the page it failed on", () => {
      renderRunDetails({
        run: { ...failedRun, failureScreenshotFileName: "website-1/run-folder/failure.png" },
        versionCanBeRefined: false,
      });

      const banner = screen.getByRole("status");
      expect(banner).toHaveClass("MuiAlert-standardError");
      expect(within(banner).getByTestId("HighlightOffIcon")).toBeInTheDocument();
      expect(within(banner).getByText("Failed at step 3")).toBeInTheDocument();
      expect(banner).toHaveTextContent('Step 3 (Click link "Account"): Timeout 10000ms exceeded. · 4.3 s · ');
      expect(screen.getByRole("img", { name: /^Failure screenshot of the run at / })).toHaveAttribute(
        "src",
        "/api/websites/website-1/actions/item-1/scripts/script-1/runs/script-run-1/failure-screenshot",
      );
      expect(screen.getByText("http://localhost:3099/account")).toBeInTheDocument();
      expect(screen.queryByText("No failure screenshot was captured for this run.")).not.toBeInTheDocument();
    });

    it("explains a run that failed before the first step, such as a failed login", () => {
      renderRunDetails({
        run: buildActionScriptRunRecord({
          succeeded: false,
          failedStepNumber: null,
          errorMessage: 'Could not log in as "Admin": the password field was not found',
          credentialName: "Admin",
        }),
        versionCanBeRefined: false,
      });

      const banner = screen.getByRole("status");
      expect(within(banner).getByText("Failed before the first step")).toBeInTheDocument();
      expect(banner).toHaveTextContent('Could not log in as "Admin": the password field was not found · 4.3 s');
    });

    it("says so when a failed run captured no screenshot", () => {
      renderRunDetails({
        run: buildActionScriptRunRecord({
          succeeded: false,
          timedOut: true,
          failedStepNumber: 2,
          errorMessage: "The run was stopped after 5 minutes",
        }),
        versionCanBeRefined: false,
      });

      expect(within(screen.getByRole("status")).getByText("Timed out · stopped after 5 min")).toBeInTheDocument();
      expect(screen.getByText("No failure screenshot was captured for this run.")).toBeInTheDocument();
    });

    it("shows nothing about a failing page when none was captured", () => {
      renderRunDetails({ run: { ...failedRun, failingPageUrl: null } });

      expect(screen.queryByText("http://localhost:3099/account")).not.toBeInTheDocument();
    });
  });

  describe("the output log (desktop)", () => {
    it("is a collapsed row with the log's line count that opens the step log", async () => {
      const user = userEvent.setup();
      renderRunDetails({
        run: buildActionScriptRunRecord({ output: "▶ Open the site\n✔ Use case completed" }),
        versionCanBeRefined: false,
      });
      expect(screen.queryByLabelText("Run output")).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Output log · 2 lines" }));

      expect(screen.getByLabelText("Run output")).toHaveTextContent("✔ Use case completed");
    });

    it("notes truncated output, and an empty output", async () => {
      const user = userEvent.setup();
      const { rerender } = renderRunDetails({
        run: buildActionScriptRunRecord({ output: "the end of a long log", outputWasTruncated: true }),
        versionCanBeRefined: false,
      });
      await user.click(screen.getByRole("button", { name: "Output log · 1 line" }));
      expect(screen.getByText("The output was long, so only its end is kept.")).toBeInTheDocument();

      rerender(
        <ActionScriptRunDetails
          {...buildRunDetailsProps({ run: buildActionScriptRunRecord({ output: "" }), versionCanBeRefined: false })}
        />,
      );
      expect(screen.getByRole("button", { name: "Output log · 0 lines" })).toBeInTheDocument();
      expect(screen.getByText("The run logged nothing.")).toBeInTheDocument();
      expect(screen.queryByLabelText("Run output")).not.toBeInTheDocument();
    });
  });

  describe("refining (desktop)", () => {
    it("offers Refine with Claude: an optional note with a counter, and Refine into the next version", () => {
      renderRunDetails();

      expect(screen.getByRole("heading", { name: "Refine with Claude" })).toBeInTheDocument();
      const noteField = screen.getByRole("textbox", { name: NOTE_FIELD_NAME });
      expect(noteField).toBeEnabled();
      expect(noteField).toHaveAttribute(
        "placeholder",
        "What did you notice? e.g. the toast says “Spot reserved”, not “Booking confirmed”",
      );
      expect(screen.getByText("Optional · 0 / 2,000")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Refine into Version 6" })).toBeEnabled();
      expect(screen.queryByRole("progressbar", { name: "Refining script" })).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("counts the note's characters as it is typed", async () => {
      const user = userEvent.setup();
      renderRunDetails();

      await user.type(screen.getByRole("textbox", { name: NOTE_FIELD_NAME }), "Profile");

      expect(screen.getByText("Optional · 7 / 2,000")).toBeInTheDocument();
    });

    it("offers no Refine for a passing run, or for a version saved from the step editor", () => {
      const { rerender } = renderRunDetails({ run: buildActionScriptRunRecord() });
      expect(screen.queryByRole("button", { name: /^Refine/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("textbox", { name: NOTE_FIELD_NAME })).not.toBeInTheDocument();

      rerender(<ActionScriptRunDetails {...buildRunDetailsProps({ versionCanBeRefined: false })} />);
      expect(within(screen.getByRole("status")).getByText("Failed at step 3")).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Refine with Claude" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Refine/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("textbox", { name: NOTE_FIELD_NAME })).not.toBeInTheDocument();
    });

    it("hands onRefine the run with the note trimmed, or null when the note is blank", async () => {
      const user = userEvent.setup();
      const onRefine = vi.fn();
      renderRunDetails({ onRefine });
      const noteField = screen.getByRole("textbox", { name: NOTE_FIELD_NAME });
      const refineButton = screen.getByRole("button", { name: "Refine into Version 6" });

      await user.click(refineButton);
      await user.type(noteField, "   ");
      await user.click(refineButton);
      await user.clear(noteField);
      await user.type(noteField, "  The link is called Profile now  ");
      await user.click(refineButton);

      expect(onRefine.mock.calls).toEqual([
        [failedRun, null],
        [failedRun, null],
        [failedRun, "The link is called Profile now"],
      ]);
    });

    it("caps the note at the length the server accepts", () => {
      renderRunDetails();

      expect(MAX_REFINE_NOTE_LENGTH).toBe(2000);
      expect(screen.getByRole("textbox", { name: NOTE_FIELD_NAME })).toHaveAttribute("maxlength", "2000");
    });

    it("disables Refine and the note, and shows progress, while refining", () => {
      renderRunDetails({ isRefining: true });

      expect(screen.getByRole("button", { name: "Refining…" })).toBeDisabled();
      expect(screen.getByRole("textbox", { name: NOTE_FIELD_NAME })).toBeDisabled();
      expect(screen.getByRole("progressbar", { name: "Refining script" })).toBeInTheDocument();
      expect(screen.getByText("This can take a few minutes.")).toBeInTheDocument();
    });

    it("disables Refine, but not the note, while a run is in flight, without refine progress", () => {
      renderRunDetails({ isRunning: true });

      expect(screen.getByRole("button", { name: "Refine into Version 6" })).toBeDisabled();
      expect(screen.getByRole("textbox", { name: NOTE_FIELD_NAME })).toBeEnabled();
      expect(screen.queryByRole("progressbar", { name: "Refining script" })).not.toBeInTheDocument();
      expect(screen.queryByText("This can take a few minutes.")).not.toBeInTheDocument();
    });

    it("shows a refine error only once these run details have tried to refine", async () => {
      const user = userEvent.setup();
      const onRefine = vi.fn();
      const { rerender } = renderRunDetails({ onRefine, refineErrorMessage: "Claude is overloaded" });
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Refine into Version 6" }));
      rerender(
        <ActionScriptRunDetails {...buildRunDetailsProps({ onRefine, refineErrorMessage: "Claude is overloaded" })} />,
      );

      expect(screen.getByRole("alert")).toHaveTextContent("Could not refine: Claude is overloaded");

      rerender(<ActionScriptRunDetails {...buildRunDetailsProps({ onRefine })} />);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  describe("the compact (phone) card", () => {
    const runAgainButton = <button type="button">Run again</button>;

    it("leaves the time out of the banner, and has no output log", () => {
      renderRunDetails({ isCompact: true, runAgainButton, versionCanBeRefined: false });

      const banner = screen.getByRole("status");
      expect(banner).toHaveTextContent(/· 4\.3 s$/);
      expect(screen.queryByRole("button", { name: /^Output log/ })).not.toBeInTheDocument();
    });

    it("puts Refine beside Run again, with the short note field and no heading or counter", async () => {
      const user = userEvent.setup();
      const onRefine = vi.fn();
      renderRunDetails({ isCompact: true, runAgainButton, onRefine });

      expect(screen.queryByRole("heading", { name: "Refine with Claude" })).not.toBeInTheDocument();
      expect(screen.queryByText(/^Optional ·/)).not.toBeInTheDocument();
      const noteField = screen.getByRole("textbox", { name: NOTE_FIELD_NAME });
      expect(noteField).toHaveAttribute("placeholder", "What did you notice? (optional)");
      const refineButton = screen.getByRole("button", { name: "Refine" });
      const runAgain = screen.getByRole("button", { name: "Run again" });
      const buttonGrid = refineButton.parentElement;
      expect(buttonGrid).toBe(runAgain.parentElement);
      expect(buttonGrid).toHaveStyle({ gridTemplateColumns: "1fr 1fr" });

      await user.type(noteField, "Profile");
      await user.click(refineButton);

      expect(onRefine).toHaveBeenCalledWith(failedRun, "Profile");
    });

    it("shows only Run again, full width, when the run cannot be refined", () => {
      renderRunDetails({ isCompact: true, runAgainButton, versionCanBeRefined: false });

      const runAgain = screen.getByRole("button", { name: "Run again" });
      expect(runAgain.parentElement).toHaveStyle({ gridTemplateColumns: "1fr" });
      expect(screen.queryByRole("button", { name: "Refine" })).not.toBeInTheDocument();
      expect(screen.queryByRole("textbox", { name: NOTE_FIELD_NAME })).not.toBeInTheDocument();
    });

    it("shows refining progress and a refine error in the card", async () => {
      const user = userEvent.setup();
      const { rerender } = renderRunDetails({ isCompact: true, runAgainButton });
      await user.click(screen.getByRole("button", { name: "Refine" }));

      rerender(<ActionScriptRunDetails {...buildRunDetailsProps({ isCompact: true, runAgainButton, isRefining: true })} />);
      expect(screen.getByRole("button", { name: "Refining…" })).toBeDisabled();
      expect(screen.getByRole("progressbar", { name: "Refining script" })).toBeInTheDocument();

      rerender(
        <ActionScriptRunDetails
          {...buildRunDetailsProps({ isCompact: true, runAgainButton, refineErrorMessage: "Claude is overloaded" })}
        />,
      );
      expect(screen.getByRole("alert")).toHaveTextContent("Could not refine: Claude is overloaded");
    });
  });
});
