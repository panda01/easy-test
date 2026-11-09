import { type ReactElement, type ReactNode, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Link from "@mui/material/Link";
import Typography from "@mui/material/Typography";
import ActionPlanSteps from "../components/ActionPlanSteps";
import ActionScriptRunOutput from "../components/ActionScriptRunOutput";
import { describeRunObjectChanges } from "../components/ActionScriptRunDetails";
import { CheckCircleOutlineIcon, HighlightOffIcon } from "../components/icons";
import LoadStatusNotice from "../components/LoadStatusNotice";
import PageBreadcrumbs from "../components/PageBreadcrumbs";
import PageContainer from "../components/PageContainer";
import ScreenshotThumbnailButton from "../components/ScreenshotThumbnailButton";
import ScreenshotViewerDialog from "../components/ScreenshotViewerDialog";
import { type ActionScriptRunDetailRecord, useActionScriptRun } from "../hooks/useActionScriptRun";
import { useActionScripts } from "../hooks/useActionScripts";
import { useIsNarrowerThan } from "../hooks/useIsNarrowerThan";
import { useNow } from "../hooks/useNow";
import { useRequiredRouteParam } from "../hooks/useRequiredRouteParam";
import { useWebsiteItem } from "../hooks/useWebsiteItems";
import { useWebsite } from "../hooks/useWebsites";
import { MONOSPACE_FONT_FAMILY, nocturneTokens, statusColors } from "../theme/nocturneTheme";
import { readUsedParameterValues } from "../utils/actionParameters";
import { type ActionPlan } from "../utils/actionPlanSteps";
import { type RunScreenshotFrame, buildRunScreenshotFrames } from "../utils/buildRunScreenshotFrames";
import { describeActionScriptRunOutcome } from "../utils/describeActionScriptRun";
import { formatRunDuration } from "../utils/describeScreenshotRun";
import { findVersionNumberOfScriptId } from "../utils/findVersionNumberOfScriptId";
import { formatDayAndTime, formatFullDateTime } from "../utils/formatRelativeTime";
import {
  WEBSITE_LIST_PATH,
  actionDetailPathWithRun,
  actionScriptRunDetailPath,
  websiteDetailPath,
} from "../utils/routePaths";
import { ACTION_KIND } from "../utils/websiteItemKinds";

/** One label / value row of the run's facts. */
interface RunFact {
  /** What the row is, e.g. "Logged in as". */
  label: string;
  /** Its value. */
  value: string;
  /** True for an address, drawn in the monospace font. */
  isAddress: boolean;
}

/**
 * Lists the facts about a run the page shows beside its outcome: when it
 * ran, how long it took, whom it ran as, and the page it ended (or failed)
 * on.
 * @param run - The run
 * @returns The fact rows, in display order
 */
function listRunFacts(run: ActionScriptRunDetailRecord): RunFact[] {
  const facts: RunFact[] = [
    { label: "Ran", value: formatFullDateTime(run.createdAt), isAddress: false },
    { label: "Took", value: formatRunDuration(run.durationMs), isAddress: false },
    { label: "Logged in as", value: run.credentialName ?? "Logged out", isAddress: false },
  ];
  if (run.failingPageUrl !== null) {
    facts.push({ label: "Failed on", value: run.failingPageUrl, isAddress: true });
  } else if (run.finalPageUrl !== null) {
    facts.push({ label: "Ended on", value: run.finalPageUrl, isAddress: true });
  }
  return facts;
}

/** Props for `RunFrameContent`. */
interface RunFrameContentProps {
  /** The frame to show. */
  frame: RunScreenshotFrame;
  /** Called to open the frame full screen (only frames with an image can be opened). */
  onOpen: (frame: RunScreenshotFrame) => void;
  /** True for the phone layout: the thumbnail fills the width. */
  isPhoneLayout: boolean;
}

/**
 * One frame under its step: its thumbnail (click it to open it full screen),
 * or - for a screenshot the run could not take - "Screenshot could not be
 * taken: <reason>" in its place.
 * @param props - The frame, the open callback, and the layout
 * @returns The thumbnail or the reason
 */
function RunFrameContent(props: RunFrameContentProps): ReactElement {
  const { frame, onOpen, isPhoneLayout } = props;
  const { src } = frame;
  if (src === null) {
    return (
      <Typography sx={{ fontSize: 12.5, color: statusColors.stale, mt: "6px", overflowWrap: "anywhere" }}>
        Screenshot could not be taken: {frame.errorMessage ?? "no reason was recorded"}
      </Typography>
    );
  }
  /** Opens this frame full screen. */
  const openThisFrame = (): void => {
    onOpen(frame);
  };
  return (
    <ScreenshotThumbnailButton
      src={src}
      alt={frame.alt}
      onOpen={openThisFrame}
      buttonSx={{ mt: 1, maxWidth: isPhoneLayout ? "100%" : 420 }}
      imageSx={{
        borderRadius: `${String(nocturneTokens.radius.medium)}px`,
        boxShadow: nocturneTokens.shadow.small,
        border: frame.moment === "failure" ? `1px solid ${statusColors.failedStepRing}` : "none",
      }}
    />
  );
}

/**
 * Groups a run's frames by the plan step they belong to, each group drawn
 * as `RunFrameContent`s, for `ActionPlanSteps`' `contentBelowStep`.
 * @param frames - The frames that belong to a step
 * @param renderFrame - Draws one frame
 * @returns The content to show under each step, by 1-based step number
 */
function groupFramesByStep(
  frames: RunScreenshotFrame[],
  renderFrame: (frame: RunScreenshotFrame) => ReactNode,
): ReadonlyMap<number, ReactNode> {
  const framesByStepNumber = new Map<number, RunScreenshotFrame[]>();
  for (const frame of frames) {
    if (frame.stepNumber === null) continue;
    framesByStepNumber.set(frame.stepNumber, [...(framesByStepNumber.get(frame.stepNumber) ?? []), frame]);
  }
  return new Map(
    [...framesByStepNumber.entries()].map(([stepNumber, stepFrames]) => [
      stepNumber,
      <Box key={stepNumber}>{stepFrames.map((frame) => renderFrame(frame))}</Box>,
    ]),
  );
}

/**
 * One action run's own page: what the run did, and the screenshots it took
 * along the way, so the automatic navigation can be followed afterwards.
 *
 * - Breadcrumbs: Websites / the website / the action (opening the action's
 *   page on this version and run) / "Run · <day and time>".
 * - "Version N run", the outcome banner ("Failed at step 3", the error, how
 *   long it took), and the facts: when it ran, how long it took, whom it ran
 *   as, and the page it ended or failed on.
 * - What it did to the record of created objects, links to its cleanup run
 *   or to the Create run it cleaned up after, and the values it used.
 * - "Steps": the screenshots taken before the first step ("Logged in as
 *   …", "Opened the start page"), then the version's steps marked by the run
 *   (reached, failed here, not reached), each with the screenshot taken after
 *   it - the failed step with the failure screenshot. A screenshot the run
 *   could not take shows why in its place. Clicking any screenshot opens the
 *   full-screen viewer, which pages through all of the run's screenshots in
 *   order. Runs from before step screenshots existed say so.
 * - "Output log": the run's step log.
 *
 * Desktop puts the steps beside a column with the facts and the log; the
 * phone layout is one column. The run request decides loading / not found;
 * the website, the action, and the versions are fetched for the breadcrumbs,
 * the version number, and the step descriptions.
 * @returns The rendered run page
 */
export default function ActionScriptRunPage(): ReactElement {
  const websiteId = useRequiredRouteParam("websiteId");
  const actionId = useRequiredRouteParam("itemId");
  const actionScriptId = useRequiredRouteParam("actionScriptId");
  const actionScriptRunId = useRequiredRouteParam("actionScriptRunId");
  const website = useWebsite(websiteId).data;
  const action = useWebsiteItem(ACTION_KIND, websiteId, actionId).data;
  const { scripts, isLoading: scriptsAreLoading } = useActionScripts(websiteId, actionId);
  const runResource = useActionScriptRun(websiteId, actionId, actionScriptId, actionScriptRunId);
  const run = runResource.data;
  const isPhoneLayout = useIsNarrowerThan("md");
  const now = useNow(false);
  const [openViewerIndex, setOpenViewerIndex] = useState<number | null>(null);

  const breadcrumbs = (
    <PageBreadcrumbs
      crumbs={[
        { label: "Websites", to: WEBSITE_LIST_PATH },
        { label: website?.name ?? "Website", to: websiteDetailPath(websiteId) },
        {
          label: action?.title ?? ACTION_KIND.singularTitle,
          to: actionDetailPathWithRun(websiteId, actionId, actionScriptId, actionScriptRunId),
        },
        { label: run === null ? "Run" : `Run · ${formatDayAndTime(run.createdAt, now)}` },
      ]}
    />
  );

  if (run === null) {
    return (
      <PageContainer>
        {breadcrumbs}
        <LoadStatusNotice
          isLoading={runResource.isLoading}
          errorMessage={runResource.errorMessage}
          loadingLabel="Loading run"
        />
      </PageContainer>
    );
  }

  const ranScript = scripts.find((listedScript) => listedScript.id === run.actionScriptId) ?? null;
  const plan: ActionPlan | null = ranScript?.plan ?? null;
  const versionNumber = findVersionNumberOfScriptId(scripts, run.actionScriptId);
  const frames = buildRunScreenshotFrames(run, plan);
  const viewableFrames = frames.filter((frame) => frame.src !== null);
  const viewableScreenshots = viewableFrames.map((frame) => ({
    src: frame.src ?? "",
    alt: frame.alt,
    caption: frame.caption,
  }));
  const framesBeforeTheFirstStep = frames.filter((frame) => frame.stepNumber === null);
  const runHasNoStepScreenshots = run.screenshots.length === 0;
  const planIsStillLoading = plan === null && scriptsAreLoading;
  const usedValues = readUsedParameterValues(run.parameterValues);
  const objectChangeLines = describeRunObjectChanges(run);
  const cleanupRun = run.cleanupRun ?? null;
  const cleanedUpRun = run.cleanedUpRun ?? null;

  /**
   * Opens a frame in the full-screen viewer, at its place among the frames
   * that have an image.
   * @param frame - The clicked frame
   */
  const openFrame = (frame: RunScreenshotFrame): void => {
    const viewerIndex = viewableFrames.indexOf(frame);
    if (viewerIndex !== -1) setOpenViewerIndex(viewerIndex);
  };

  /** Closes the full-screen viewer. */
  const closeViewer = (): void => {
    setOpenViewerIndex(null);
  };

  /**
   * Draws one frame under its step.
   * @param frame - The frame
   * @returns Its thumbnail or the reason it is missing
   */
  const renderFrame = (frame: RunScreenshotFrame): ReactNode => (
    <RunFrameContent key={frame.key} frame={frame} onOpen={openFrame} isPhoneLayout={isPhoneLayout} />
  );

  const outcomeBanner = (
    <Alert
      role="status"
      severity={run.succeeded ? "success" : "error"}
      icon={run.succeeded ? <CheckCircleOutlineIcon /> : <HighlightOffIcon />}
    >
      <Box sx={{ fontSize: 14, fontWeight: 500 }}>{describeActionScriptRunOutcome(run)}</Box>
      {run.errorMessage !== null && (
        <Box sx={{ fontSize: 12.5, opacity: 0.85, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          {run.errorMessage}
        </Box>
      )}
    </Alert>
  );

  const factsList = (
    <Box
      component="dl"
      aria-label="Run facts"
      sx={{ m: 0, display: "grid", gridTemplateColumns: "auto minmax(0,1fr)", gap: "6px 14px", fontSize: 13 }}
    >
      {listRunFacts(run).map((fact) => (
        <Box key={fact.label} sx={{ display: "contents" }}>
          <Box component="dt" sx={{ color: nocturneTokens.neutral[400] }}>
            {fact.label}
          </Box>
          <Box
            component="dd"
            sx={{
              m: 0,
              overflowWrap: "anywhere",
              fontFamily: fact.isAddress ? MONOSPACE_FONT_FAMILY : "inherit",
              fontSize: fact.isAddress ? 12 : 13,
            }}
          >
            {fact.value}
          </Box>
        </Box>
      ))}
    </Box>
  );

  const objectChangesAndCleanupLinks = (objectChangeLines.length > 0 || cleanupRun !== null || cleanedUpRun !== null) && (
    <Box aria-label="Created objects" sx={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: 13 }}>
      {objectChangeLines.map((objectChangeLine) => (
        <Box key={objectChangeLine} sx={{ color: nocturneTokens.neutral[300] }}>
          {objectChangeLine}
        </Box>
      ))}
      {cleanupRun !== null && (
        <Link
          component={RouterLink}
          to={actionScriptRunDetailPath(websiteId, cleanupRun.actionId, cleanupRun.actionScriptId, cleanupRun.id)}
        >
          Open the cleanup run ({cleanupRun.action.title})
        </Link>
      )}
      {cleanedUpRun !== null && (
        <Link
          component={RouterLink}
          to={actionScriptRunDetailPath(websiteId, cleanedUpRun.actionId, cleanedUpRun.actionScriptId, cleanedUpRun.id)}
        >
          Open the run it cleaned up after ({cleanedUpRun.action.title})
        </Link>
      )}
    </Box>
  );

  const valuesUsed = usedValues.length > 0 && (
    <Box component="section" aria-labelledby="run-values-heading">
      <Typography id="run-values-heading" component="h2" sx={{ fontSize: 13.5, fontWeight: 500, mb: 1 }}>
        Values used
      </Typography>
      <Box component="dl" sx={{ m: 0, display: "grid", gridTemplateColumns: "auto minmax(0,1fr)", gap: "4px 12px", fontSize: 13 }}>
        {usedValues.map((usedValue) => (
          <Box key={usedValue.key} sx={{ display: "contents" }}>
            <Box component="dt" sx={{ color: nocturneTokens.neutral[400] }}>
              {usedValue.label}
            </Box>
            <Box component="dd" sx={{ m: 0, overflowWrap: "anywhere" }}>
              {usedValue.value === "" ? "(left blank - its steps were skipped)" : usedValue.value}
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );

  let planStepsArea: ReactNode;
  if (planIsStillLoading) {
    planStepsArea = <CircularProgress size={24} aria-label="Loading steps" />;
  } else if (plan === null) {
    // The version is no longer listed: show the step frames on their own.
    planStepsArea = (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {frames
          .filter((frame) => frame.stepNumber !== null)
          .map((frame) => (
            <Box key={frame.key}>
              <Typography sx={{ fontSize: 14 }}>{frame.caption}</Typography>
              {renderFrame(frame)}
            </Box>
          ))}
      </Box>
    );
  } else {
    planStepsArea = (
      <ActionPlanSteps
        plan={plan}
        highlightedRun={run}
        isCompact={isPhoneLayout}
        contentBelowStep={groupFramesByStep(frames, renderFrame)}
      />
    );
  }

  const stepsSection = (
    <Box component="section" aria-labelledby="run-steps-heading" sx={{ minWidth: 0 }}>
      <Typography id="run-steps-heading" variant="h5" component="h2" sx={{ mb: 1 }}>
        Steps
      </Typography>
      {runHasNoStepScreenshots && (
        <Typography sx={{ fontSize: 13, color: nocturneTokens.neutral[400], mb: 1.5 }}>
          Step screenshots weren&apos;t captured for this run.
        </Typography>
      )}
      {framesBeforeTheFirstStep.length > 0 && (
        <Box
          component="ul"
          aria-label="Before the first step"
          sx={{ m: 0, mb: 2, p: 0, display: "flex", flexDirection: "column", gap: 2 }}
        >
          {framesBeforeTheFirstStep.map((frame) => (
            <Box component="li" key={frame.key} sx={{ listStyle: "none" }}>
              <Typography sx={{ fontSize: 14 }}>{frame.caption}</Typography>
              {renderFrame(frame)}
            </Box>
          ))}
        </Box>
      )}
      {planStepsArea}
    </Box>
  );

  const outputSection = (
    <Box component="section" aria-labelledby="run-output-heading">
      <Typography id="run-output-heading" component="h2" sx={{ fontSize: 13.5, fontWeight: 500, mb: 1 }}>
        Output log
      </Typography>
      <ActionScriptRunOutput run={run} />
    </Box>
  );

  const detailsColumn = (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
      {outcomeBanner}
      {factsList}
      {objectChangesAndCleanupLinks}
      {valuesUsed}
      {!isPhoneLayout && outputSection}
    </Box>
  );

  return (
    <PageContainer>
      {breadcrumbs}

      <Typography
        variant={isPhoneLayout ? "h3" : "h2"}
        component="h1"
        sx={{ mt: isPhoneLayout ? "6px" : 0, mb: isPhoneLayout ? "12px" : 2 }}
      >
        {versionNumber === null ? "Run" : `Version ${String(versionNumber)} run`}
      </Typography>

      {isPhoneLayout ? (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {detailsColumn}
          {stepsSection}
          {outputSection}
        </Box>
      ) : (
        <Box sx={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 400px", gap: 4, alignItems: "start" }}>
          {stepsSection}
          {detailsColumn}
        </Box>
      )}

      <ScreenshotViewerDialog
        screenshots={viewableScreenshots}
        openIndex={openViewerIndex}
        onClose={closeViewer}
        onOpenIndexChange={setOpenViewerIndex}
      />
    </PageContainer>
  );
}
