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
import WebsiteItemListSection from "../components/WebsiteItemListSection";
import { useJsonMutation } from "../hooks/useJsonMutation";
import { useRequiredRouteParam } from "../hooks/useRequiredRouteParam";
import { useReturnNavigation, useReturnToHereState } from "../hooks/useReturnNavigation";
import { useWebsiteItems } from "../hooks/useWebsiteItems";
import { useWebsite } from "../hooks/useWebsites";
import { formatCount } from "../utils/formatCount";
import { WEBSITE_LIST_PATH, websiteApiUrl, websiteEditPath } from "../utils/routePaths";
import { ACTION_KIND, USE_CASE_KIND } from "../utils/websiteItemKinds";

/**
 * A website's own page (`/websites/:websiteId`): its URL, description, and
 * timestamps, Edit and Delete buttons, and a section each for the website's
 * use cases and actions.
 *
 * The page fetches the website AND both item lists itself (rather than letting
 * each section fetch), so the delete dialog can say exactly how many use cases
 * and actions will be deleted along with the website.
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
  const website = websiteResource.data;

  const returnToHereState = useReturnToHereState();
  const { returnTo } = useReturnNavigation();
  const { sendJsonRequest, isSubmitting, errorMessage: deleteErrorMessage } = useJsonMutation();
  const [deleteDialogIsOpen, setDeleteDialogIsOpen] = useState(false);

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
            <Stack direction="row" spacing={1}>
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
            message={`"${website.name}" will be deleted, along with its ${useCaseCountText} and ${actionCountText}.`}
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
