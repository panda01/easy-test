import { type ReactElement, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Container from "@mui/material/Container";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import ConfirmDeleteDialog from "../components/ConfirmDeleteDialog";
import LoadStatusNotice from "../components/LoadStatusNotice";
import PageBreadcrumbs from "../components/PageBreadcrumbs";
import ScreenshotRunsSection from "../components/ScreenshotRunsSection";
import WebsiteItemListSection from "../components/WebsiteItemListSection";
import { useJsonMutation } from "../hooks/useJsonMutation";
import { useRequiredRouteParam } from "../hooks/useRequiredRouteParam";
import { useReturnNavigation, useReturnToHereState } from "../hooks/useReturnNavigation";
import { type ScreenshotRunRecord, useScreenshotRuns } from "../hooks/useScreenshotRuns";
import { useWebsiteItems } from "../hooks/useWebsiteItems";
import { useWebsite } from "../hooks/useWebsites";
import { formatCount } from "../utils/formatCount";
import {
  WEBSITE_LIST_PATH,
  screenshotRunsApiUrl,
  websiteApiUrl,
  websiteEditPath,
} from "../utils/routePaths";
import { ACTION_KIND, USE_CASE_KIND } from "../utils/websiteItemKinds";

/**
 * A website's own page (`/websites/:websiteId`): its URL, description, and
 * timestamps, Take screenshot / Edit / Delete buttons, the website's
 * screenshot timing settings and screenshot runs, and a section each for its
 * use cases and actions.
 *
 * "Take screenshot" POSTs to the Playwright controller, which visits the
 * website's URL with a headless browser on the server's machine and records
 * the run. The request lasts as long as the visit (up to 30 seconds), so the
 * button is disabled and a progress bar shows meanwhile. The recorded run is
 * added to the top of the run list and selected.
 *
 * The page fetches the website, both item lists, AND the screenshot runs
 * itself (rather than letting each section fetch), so the delete dialog can
 * say exactly how many use cases, actions, and screenshot runs will be
 * deleted along with the website.
 *
 * After a delete it returns to the website list history-aware (see
 * `useReturnNavigation`); a later Forward onto this deleted website shows the
 * server's "Website not found".
 * @returns The rendered website detail page
 */
export default function WebsiteDetailPage(): ReactElement {
  const websiteId = useRequiredRouteParam("websiteId");
  const websiteResource = useWebsite(websiteId);
  const useCasesResource = useWebsiteItems(USE_CASE_KIND, websiteId);
  const actionsResource = useWebsiteItems(ACTION_KIND, websiteId);
  const screenshotRuns = useScreenshotRuns(websiteId);
  const { addTakenRun } = screenshotRuns;
  const website = websiteResource.data;

  const returnToHereState = useReturnToHereState();
  const { returnTo } = useReturnNavigation();
  const { sendJsonRequest, isSubmitting, errorMessage: deleteErrorMessage } = useJsonMutation();
  const [deleteDialogIsOpen, setDeleteDialogIsOpen] = useState(false);
  const {
    sendJsonRequest: sendScreenshotRequest,
    isSubmitting: screenshotIsInFlight,
    errorMessage: screenshotErrorMessage,
  } = useJsonMutation();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const useCaseCount = useCasesResource.data?.length ?? 0;
  const actionCount = actionsResource.data?.length ?? 0;
  const useCaseCountText = formatCount(
    useCaseCount,
    USE_CASE_KIND.singularLabel,
    USE_CASE_KIND.pluralLabel,
  );
  const actionCountText = formatCount(
    actionCount,
    ACTION_KIND.singularLabel,
    ACTION_KIND.pluralLabel,
  );
  const screenshotRunCountText = formatCount(
    screenshotRuns.runs.length,
    "screenshot run",
    "screenshot runs",
  );

  /**
   * POSTs a new screenshot run for this website and, when the server recorded
   * it, puts it at the top of the run list and selects it. A failed VISIT
   * (e.g. HTTP 404, connection refused) is still a recorded run; only a
   * request failure shows the error alert in the Screenshots section.
   * @returns Resolves once the request is done
   */
  const takeScreenshot = async (): Promise<void> => {
    const result = await sendScreenshotRequest("POST", screenshotRunsApiUrl(websiteId));
    if (!result.succeeded) return;
    // The API is the contract for this shape, as in the typed resource hooks.
    const takenRun = result.data as ScreenshotRunRecord;
    addTakenRun(takenRun);
    setSelectedRunId(takenRun.id);
  };

  /**
   * Starts a screenshot run without returning its promise, because a button's
   * `onClick` expects a plain void callback.
   */
  const handleTakeScreenshotClick = (): void => {
    void takeScreenshot();
  };

  /** Opens the delete confirmation dialog. */
  const handleDeleteClick = (): void => {
    setDeleteDialogIsOpen(true);
  };

  /** Closes the delete confirmation dialog without deleting. */
  const handleDeleteCancel = (): void => {
    setDeleteDialogIsOpen(false);
  };

  /**
   * DELETEs the website (the server soft deletes its use cases and actions
   * with it) and, when that succeeds, returns to the website list. On failure
   * the dialog stays open and shows the server's reason.
   * @returns Resolves once the request (and any navigation) is done
   */
  const deleteWebsite = async (): Promise<void> => {
    const result = await sendJsonRequest("DELETE", websiteApiUrl(websiteId));
    if (!result.succeeded) return;
    setDeleteDialogIsOpen(false);
    returnTo(WEBSITE_LIST_PATH);
  };

  /**
   * Starts the delete without returning its promise, because the dialog's
   * `onConfirm` prop expects a plain void callback.
   */
  const handleDeleteConfirm = (): void => {
    void deleteWebsite();
  };

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <PageBreadcrumbs
        crumbs={[{ label: "Websites", to: WEBSITE_LIST_PATH }, { label: website?.name ?? "Website" }]}
      />

      <LoadStatusNotice
        isLoading={websiteResource.isLoading}
        errorMessage={websiteResource.errorMessage}
        loadingLabel="Loading website"
      />

      {website !== null && (
        <>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={2}
            sx={{ justifyContent: "space-between", alignItems: { sm: "flex-start" } }}
          >
            <Box>
              <Typography variant="h4" component="h1">
                {website.name}
              </Typography>
              <Link href={website.url} target="_blank" rel="noopener noreferrer">
                {website.url}
              </Link>
            </Box>
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
              <Button
                onClick={handleTakeScreenshotClick}
                disabled={screenshotIsInFlight}
                variant="contained"
              >
                {screenshotIsInFlight ? "Taking screenshot…" : "Take screenshot"}
              </Button>
              <Button
                component={RouterLink}
                to={websiteEditPath(website.id)}
                state={returnToHereState}
                variant="outlined"
              >
                Edit
              </Button>
              <Button onClick={handleDeleteClick} color="error" variant="outlined">
                Delete
              </Button>
            </Stack>
          </Stack>

          <Typography sx={{ mt: 3, whiteSpace: "pre-wrap" }}>
            {website.description ?? "No description."}
          </Typography>
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
            Created {new Date(website.createdAt).toLocaleString()} · Updated{" "}
            {new Date(website.updatedAt).toLocaleString()}
          </Typography>

          <ScreenshotRunsSection
            websiteId={website.id}
            networkIdleTimeoutMs={website.networkIdleTimeoutMs}
            screenshotMinimumWaitMs={website.screenshotMinimumWaitMs}
            runs={screenshotRuns.runs}
            isLoading={screenshotRuns.isLoading}
            errorMessage={screenshotRuns.errorMessage}
            selectedRunId={selectedRunId}
            onSelectRun={setSelectedRunId}
            isTakingScreenshot={screenshotIsInFlight}
            takeScreenshotErrorMessage={screenshotErrorMessage}
          />

          <WebsiteItemListSection
            itemKind={USE_CASE_KIND}
            websiteId={website.id}
            itemsResource={useCasesResource}
            returnToHereState={returnToHereState}
          />
          <WebsiteItemListSection
            itemKind={ACTION_KIND}
            websiteId={website.id}
            itemsResource={actionsResource}
            returnToHereState={returnToHereState}
          />

          <ConfirmDeleteDialog
            isOpen={deleteDialogIsOpen}
            title="Delete website?"
            message={`"${website.name}" will be deleted, along with its ${useCaseCountText}, ${actionCountText}, and ${screenshotRunCountText}.`}
            isDeleting={isSubmitting}
            errorMessage={deleteErrorMessage}
            onCancel={handleDeleteCancel}
            onConfirm={handleDeleteConfirm}
          />
        </>
      )}
    </Container>
  );
}
