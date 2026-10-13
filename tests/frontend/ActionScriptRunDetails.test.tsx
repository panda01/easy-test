import { describe, it, expect, vi } from "vitest";
import { render, screen, type RenderResult } from "@testing-library/react";
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

/** The refine props for a run whose version cannot be refined, so no "Refine" area is shown. */
const refineHiddenProps = {
  versionCanBeRefined: false,
  isRefining: false,
  isRunning: false,
  refineErrorMessage: null,
  onRefine: vi.fn(),
};

/**
 * Builds the component's props: the failed run of a version Claude wrote,
 * with nothing in flight and no refine error.
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
  it("shows a passing run's outcome, duration, that it ran logged out, and its output, with no screenshot", () => {
    render(
      <ActionScriptRunDetails
        websiteId="website-1"
        {...refineHiddenProps}
        run={buildActionScriptRunRecord()}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(/^Passed · 4\.3 s$/);
    expect(screen.getByText(/^Ran .+ · logged out$/)).toBeInTheDocument();
    expect(screen.getByLabelText("Run output")).toHaveTextContent("✔ Use case completed");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByText("No failure screenshot was captured for this run.")).not.toBeInTheDocument();
  });

  it("names the credential a run logged in as", () => {
    render(
      <ActionScriptRunDetails
        websiteId="website-1"
        {...refineHiddenProps}
        run={buildActionScriptRunRecord({ credentialName: "Admin" })}
      />,
    );

    expect(screen.getByText(/^Ran .+ · logged in as "Admin"$/)).toBeInTheDocument();
  });

  it("shows the step a failed run stopped at, why, and its screenshot from the failure screenshot url", () => {
    render(
      <ActionScriptRunDetails
        websiteId="website-1"
        {...refineHiddenProps}
        run={buildActionScriptRunRecord({
          succeeded: false,
          failedStepNumber: 3,
          errorMessage: 'Step 3 (Click button "Sign in"): Timeout 10000ms exceeded.',
          failureScreenshotFileName: "website-1/run-folder/failure.png",
        })}
      />,
    );

    const outcome = screen.getByRole("status");
    expect(outcome).toHaveTextContent("Failed at step 3 · 4.3 s");
    expect(outcome).toHaveTextContent('Step 3 (Click button "Sign in"): Timeout 10000ms exceeded.');
    expect(screen.getByRole("img", { name: /Failure screenshot/ })).toHaveAttribute(
      "src",
      "/api/websites/website-1/actions/item-1/scripts/script-1/runs/script-run-1/failure-screenshot",
    );
    expect(screen.queryByText("No failure screenshot was captured for this run.")).not.toBeInTheDocument();
  });

  it("explains a run that failed before the first step, such as a failed login", () => {
    render(
      <ActionScriptRunDetails
        websiteId="website-1"
        {...refineHiddenProps}
        run={buildActionScriptRunRecord({
          succeeded: false,
          failedStepNumber: null,
          errorMessage: 'Could not log in as "Admin": the password field was not found',
          credentialName: "Admin",
        })}
      />,
    );

    const outcome = screen.getByRole("status");
    expect(outcome).toHaveTextContent("Failed before the first step · 4.3 s");
    expect(outcome).toHaveTextContent('Could not log in as "Admin": the password field was not found');
  });

  it("says so when a failed run captured no screenshot", () => {
    render(
      <ActionScriptRunDetails
        websiteId="website-1"
        {...refineHiddenProps}
        run={buildActionScriptRunRecord({
          succeeded: false,
          timedOut: true,
          failedStepNumber: 2,
          errorMessage: "The run was stopped after 5 minutes",
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
        {...refineHiddenProps}
        run={buildActionScriptRunRecord({ outputWasTruncated: true })}
      />,
    );
    expect(screen.getByText("The output was long, so only its end is kept.")).toBeInTheDocument();

    rerender(
      <ActionScriptRunDetails
        websiteId="website-1"
        {...refineHiddenProps}
        run={buildActionScriptRunRecord({ output: "" })}
      />,
    );
    expect(screen.getByText("The run logged nothing.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Run output")).not.toBeInTheDocument();
  });

  it("names the page a failed run stopped on, and says nothing about it when none was captured", () => {
    const { rerender } = renderRunDetails();
    expect(screen.getByText("Failing page: http://localhost:3099/account")).toBeInTheDocument();

    rerender(
      <ActionScriptRunDetails {...buildRunDetailsProps({ run: { ...failedRun, failingPageUrl: null } })} />,
    );
    expect(screen.queryByText(/^Failing page:/)).not.toBeInTheDocument();
  });

  describe("refining", () => {
    it("offers an optional note and Refine for a failed run of a version Claude wrote", () => {
      renderRunDetails();

      expect(screen.getByRole("textbox", { name: NOTE_FIELD_NAME })).toBeEnabled();
      expect(screen.getByRole("button", { name: "Refine" })).toBeEnabled();
      expect(screen.queryByRole("progressbar", { name: "Refining script" })).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("offers no Refine for a passing run, or for a version saved from the step editor", () => {
      const { rerender } = renderRunDetails({ run: buildActionScriptRunRecord() });
      expect(screen.queryByRole("button", { name: "Refine" })).not.toBeInTheDocument();
      expect(screen.queryByRole("textbox", { name: NOTE_FIELD_NAME })).not.toBeInTheDocument();

      rerender(<ActionScriptRunDetails {...buildRunDetailsProps({ versionCanBeRefined: false })} />);
      expect(screen.getByRole("status")).toHaveTextContent("Failed at step 3");
      expect(screen.queryByRole("button", { name: "Refine" })).not.toBeInTheDocument();
      expect(screen.queryByRole("textbox", { name: NOTE_FIELD_NAME })).not.toBeInTheDocument();
    });

    it("hands onRefine the run with the note trimmed, or null when the note is blank", async () => {
      const user = userEvent.setup();
      const onRefine = vi.fn();
      renderRunDetails({ onRefine });
      const noteField = screen.getByRole("textbox", { name: NOTE_FIELD_NAME });
      const refineButton = screen.getByRole("button", { name: "Refine" });

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

      expect(screen.getByRole("button", { name: "Refine" })).toBeDisabled();
      expect(screen.getByRole("textbox", { name: NOTE_FIELD_NAME })).toBeEnabled();
      expect(screen.queryByRole("progressbar", { name: "Refining script" })).not.toBeInTheDocument();
      expect(screen.queryByText("This can take a few minutes.")).not.toBeInTheDocument();
    });

    it("shows a refine error only once these run details have tried to refine", async () => {
      const user = userEvent.setup();
      const onRefine = vi.fn();
      const { rerender } = renderRunDetails({ onRefine, refineErrorMessage: "Claude is overloaded" });
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Refine" }));
      rerender(
        <ActionScriptRunDetails
          {...buildRunDetailsProps({ onRefine, refineErrorMessage: "Claude is overloaded" })}
        />,
      );

      expect(screen.getByRole("alert")).toHaveTextContent("Could not refine: Claude is overloaded");

      rerender(<ActionScriptRunDetails {...buildRunDetailsProps({ onRefine })} />);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });
});
