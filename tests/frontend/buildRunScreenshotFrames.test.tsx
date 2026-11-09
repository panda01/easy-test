import { describe, it, expect } from "vitest";
import { buildRunScreenshotFrames } from "../../src/utils/buildRunScreenshotFrames";
import { type ActionPlan } from "../../src/utils/actionPlanSteps";
import { buildActionScriptRunDetailRecord, buildActionScriptRunScreenshotRecord } from "./support/frontendTestHelpers";

const RUN_API_URL = "/api/websites/website-1/actions/item-1/scripts/script-1/runs/script-run-1";

/** The plan the run ran: two clicks. */
const TWO_CLICK_PLAN: ActionPlan = {
  name: "Open Alpha",
  startUrl: "https://example.com/",
  steps: [
    { action: "click", target: { role: "link", name: "Alpha" }, value: null },
    { action: "click", target: { role: "button", name: "Save" }, value: null },
  ],
};

const loggedInScreenshot = buildActionScriptRunScreenshotRecord({
  id: "shot-logged-in",
  position: 1,
  moment: "loggedIn",
  stepNumber: null,
  fileName: "website-1/run-folder/logged-in.png",
});
const startPageScreenshot = buildActionScriptRunScreenshotRecord({
  id: "shot-start",
  position: 2,
  moment: "startPage",
  stepNumber: null,
  fileName: "website-1/run-folder/start-page.png",
});
const stepOneScreenshot = buildActionScriptRunScreenshotRecord({ id: "shot-step-1", position: 3, stepNumber: 1 });

describe("buildRunScreenshotFrames", () => {
  it("puts the step screenshots in the order taken, captioned by what they show, each with its image url", () => {
    const run = buildActionScriptRunDetailRecord({
      credentialName: "Admin",
      screenshots: [loggedInScreenshot, startPageScreenshot, stepOneScreenshot],
    });

    const frames = buildRunScreenshotFrames(run, TWO_CLICK_PLAN);

    expect(frames.map(({ caption, stepNumber, moment }) => ({ caption, stepNumber, moment }))).toEqual([
      { caption: "Logged in as Admin", stepNumber: null, moment: "loggedIn" },
      { caption: "Opened the start page", stepNumber: null, moment: "startPage" },
      { caption: 'Step 1 · Click link "Alpha"', stepNumber: 1, moment: "step" },
    ]);
    expect(frames[2]).toMatchObject({
      key: "shot-step-1",
      src: `${RUN_API_URL}/screenshots/shot-step-1`,
      alt: 'Screenshot: Step 1 · Click link "Alpha"',
      errorMessage: null,
      pageUrl: "https://example.com/",
    });
  });

  it("adds the failure screenshot last, at the step the run failed at", () => {
    const run = buildActionScriptRunDetailRecord({
      succeeded: false,
      failedStepNumber: 2,
      failureScreenshotFileName: "website-1/run-folder/failure.png",
      failingPageUrl: "https://example.com/alpha",
      screenshots: [startPageScreenshot, stepOneScreenshot],
    });

    const failureFrame = buildRunScreenshotFrames(run, TWO_CLICK_PLAN).at(-1);

    expect(failureFrame).toEqual({
      key: "failure",
      moment: "failure",
      stepNumber: 2,
      caption: "Step 2 · failed here",
      src: `${RUN_API_URL}/failure-screenshot`,
      alt: "Failure screenshot: Step 2 · failed here",
      errorMessage: null,
      pageUrl: "https://example.com/alpha",
    });
  });

  it("puts a failure before the first step before the steps", () => {
    const run = buildActionScriptRunDetailRecord({
      succeeded: false,
      failedStepNumber: null,
      failureScreenshotFileName: "website-1/run-folder/failure.png",
    });

    const frames = buildRunScreenshotFrames(run, TWO_CLICK_PLAN);

    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ stepNumber: null, caption: "Before the first step · failed" });
  });

  it("keeps a screenshot that could not be taken, with no image and its reason", () => {
    const run = buildActionScriptRunDetailRecord({
      screenshots: [{ ...stepOneScreenshot, fileName: null, errorMessage: "Timeout 10000ms exceeded" }],
    });

    const [missedFrame] = buildRunScreenshotFrames(run, TWO_CLICK_PLAN);

    expect(missedFrame).toMatchObject({ src: null, errorMessage: "Timeout 10000ms exceeded", stepNumber: 1 });
  });

  it("captions steps by number alone when the plan cannot be read, and names a missing credential", () => {
    const run = buildActionScriptRunDetailRecord({
      credentialName: null,
      screenshots: [loggedInScreenshot, buildActionScriptRunScreenshotRecord({ id: "shot-step-9", stepNumber: 9 })],
    });

    const frames = buildRunScreenshotFrames(run, null);

    expect(frames.map((frame) => frame.caption)).toEqual(["Logged in as its credential", "Step 9"]);
  });

  it("captions a step the plan no longer has by its number", () => {
    const run = buildActionScriptRunDetailRecord({
      screenshots: [buildActionScriptRunScreenshotRecord({ id: "shot-step-5", stepNumber: 5 })],
    });

    expect(buildRunScreenshotFrames(run, TWO_CLICK_PLAN)[0].caption).toBe("Step 5");
  });

  it("gives an old run with no screenshots no frames", () => {
    expect(buildRunScreenshotFrames(buildActionScriptRunDetailRecord(), TWO_CLICK_PLAN)).toEqual([]);
  });
});
