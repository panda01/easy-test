import { type ActionScriptRunDetailRecord } from "../hooks/useActionScriptRun";
import { type ActionPlan, describePlanStep } from "./actionPlanSteps";
import { actionScriptRunFailureScreenshotApiUrl, actionScriptRunScreenshotApiUrl } from "./routePaths";

/** When a run-page frame was taken: one of the step screenshot moments, or the failure screenshot. */
export type RunScreenshotFrameMoment = "loggedIn" | "startPage" | "step" | "failure";

/**
 * One frame of a run's screenshots, as the run page shows it: a step
 * screenshot, or the run's failure screenshot. A step screenshot the run
 * could not take is still a frame - with no image (`src` null) and the
 * reason (`errorMessage`) - so the page can say why at its step.
 */
export interface RunScreenshotFrame {
  /** Unique within the run, for React keys. */
  key: string;
  /** When it was taken. */
  moment: RunScreenshotFrameMoment;
  /** The 1-based plan step it belongs to, or null for frames from before the first step. */
  stepNumber: number | null;
  /** What it shows, e.g. "Step 3 · Click button "Save"" or "Step 4 · failed here". */
  caption: string;
  /** The image's url, or null when the screenshot could not be taken. */
  src: string | null;
  /** The image's alt text. */
  alt: string;
  /** Why the screenshot could not be taken, or null when it was. */
  errorMessage: string | null;
  /** The address the browser was on, or null when it is not known. */
  pageUrl: string | null;
}

/**
 * Writes a step frame's caption: the step's number and, when the version's
 * plan is at hand, what the step does.
 * @param stepNumber - The step's 1-based number
 * @param plan - The version's plan, or null when it could not be read
 * @returns E.g. "Step 3 · Click button "Save"", or "Step 3"
 */
function captionStep(stepNumber: number, plan: ActionPlan | null): string {
  const planStep = plan?.steps.at(stepNumber - 1);
  return planStep === undefined ? `Step ${String(stepNumber)}` : `Step ${String(stepNumber)} · ${describePlanStep(planStep)}`;
}

/**
 * Puts a run's screenshots in the order the run took them, as frames for the
 * run page: its step screenshots by `position` ("Logged in as Admin",
 * "Opened the start page", then "Step N · <what the step does>"), then - when
 * the run failed and saved one - its failure screenshot, at the step it
 * failed at ("Step N · failed here") or before the first step ("Before the
 * first step · failed"). A step screenshot the run could not take keeps its
 * place, with no image and its reason.
 * @param run - The run, with its step screenshots
 * @param plan - The plan of the version that was run, for the captions, or null when it could not be read
 * @returns The frames, in the order they were taken
 */
export function buildRunScreenshotFrames(run: ActionScriptRunDetailRecord, plan: ActionPlan | null): RunScreenshotFrame[] {
  const stepScreenshotFrames = run.screenshots.map((screenshot): RunScreenshotFrame => {
    let caption: string;
    if (screenshot.moment === "loggedIn") {
      caption = `Logged in as ${run.credentialName ?? "its credential"}`;
    } else if (screenshot.moment === "startPage") {
      caption = "Opened the start page";
    } else {
      caption = captionStep(screenshot.stepNumber ?? 0, plan);
    }
    const screenshotWasTaken = screenshot.fileName !== null;
    return {
      key: screenshot.id,
      moment: screenshot.moment,
      stepNumber: screenshot.moment === "step" ? screenshot.stepNumber : null,
      caption,
      src: screenshotWasTaken
        ? actionScriptRunScreenshotApiUrl(run.websiteId, run.actionId, run.actionScriptId, run.id, screenshot.id)
        : null,
      alt: `Screenshot: ${caption}`,
      errorMessage: screenshot.errorMessage,
      pageUrl: screenshot.pageUrl,
    };
  });

  const runSavedAFailureScreenshot = run.failureScreenshotFileName !== null;
  if (!runSavedAFailureScreenshot) return stepScreenshotFrames;

  const failedBeforeTheFirstStep = run.failedStepNumber === null;
  const failureCaption = failedBeforeTheFirstStep
    ? "Before the first step · failed"
    : `Step ${String(run.failedStepNumber)} · failed here`;
  const failureFrame: RunScreenshotFrame = {
    key: "failure",
    moment: "failure",
    stepNumber: run.failedStepNumber,
    caption: failureCaption,
    src: actionScriptRunFailureScreenshotApiUrl(run.websiteId, run.actionId, run.actionScriptId, run.id),
    alt: `Failure screenshot: ${failureCaption}`,
    errorMessage: null,
    pageUrl: run.failingPageUrl,
  };
  return [...stepScreenshotFrames, failureFrame];
}
