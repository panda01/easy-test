import { type ReactElement, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import Button from "@mui/material/Button";
import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import ConfirmDeleteDialog from "../components/ConfirmDeleteDialog";
import LoadStatusNotice from "../components/LoadStatusNotice";
import PageBreadcrumbs from "../components/PageBreadcrumbs";
import { useJsonMutation } from "../hooks/useJsonMutation";
import { useRequiredRouteParam } from "../hooks/useRequiredRouteParam";
import { useReturnNavigation, useReturnToHereState } from "../hooks/useReturnNavigation";
import { useWebsiteItem } from "../hooks/useWebsiteItems";
import { useWebsite } from "../hooks/useWebsites";
import {
  WEBSITE_LIST_PATH,
  websiteDetailPath,
  websiteItemApiUrl,
  websiteItemEditPath,
} from "../utils/routePaths";
import { type WebsiteItemPageProps } from "../utils/websiteItemKinds";

/**
 * A use case's or an action's own page
 * (`/websites/:websiteId/<use-cases|actions>/:itemId`): its title,
 * description, and timestamps, with Edit and Delete buttons.
 *
 * The owning website is fetched only for the breadcrumb; the item request
 * alone decides loading / not-found, because the server already answers 404
 * for an item whose website is gone. After a delete it returns to the website
 * history-aware (see `useReturnNavigation`).
 * @param props - Which kind of item the page shows
 * @returns The rendered item detail page
 */
export default function WebsiteItemDetailPage(props: WebsiteItemPageProps): ReactElement {
  const { itemKind } = props;
  const websiteId = useRequiredRouteParam("websiteId");
  const itemId = useRequiredRouteParam("itemId");
  const websiteResource = useWebsite(websiteId);
  const itemResource = useWebsiteItem(itemKind, websiteId, itemId);
  const website = websiteResource.data;
  const item = itemResource.data;
  const websitePath = websiteDetailPath(websiteId);

  const returnToHereState = useReturnToHereState();
  const { returnTo } = useReturnNavigation();
  const { sendJsonRequest, isSubmitting, errorMessage: deleteErrorMessage } = useJsonMutation();
  const [deleteDialogIsOpen, setDeleteDialogIsOpen] = useState(false);

  /** Opens the delete confirmation dialog. */
  const handleDeleteClick = (): void => {
    setDeleteDialogIsOpen(true);
  };

  /** Closes the delete confirmation dialog without deleting. */
  const handleDeleteCancel = (): void => {
    setDeleteDialogIsOpen(false);
  };

  /**
   * DELETEs the item and, when that succeeds, returns to the owning website's
   * page. On failure the dialog stays open and shows the server's reason.
   * @returns Resolves once the request (and any navigation) is done
   */
  const deleteItem = async (): Promise<void> => {
    const result = await sendJsonRequest("DELETE", websiteItemApiUrl(itemKind, websiteId, itemId));
    if (!result.succeeded) return;
    setDeleteDialogIsOpen(false);
    returnTo(websitePath);
  };

  /**
   * Starts the delete without returning its promise, because the dialog's
   * `onConfirm` prop expects a plain void callback.
   */
  const handleDeleteConfirm = (): void => {
    void deleteItem();
  };

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <PageBreadcrumbs
        crumbs={[
          { label: "Websites", to: WEBSITE_LIST_PATH },
          { label: website?.name ?? "Website", to: websitePath },
          { label: item?.title ?? itemKind.singularTitle },
        ]}
      />

      <LoadStatusNotice
        isLoading={itemResource.isLoading}
        errorMessage={itemResource.errorMessage}
        loadingLabel={`Loading ${itemKind.singularLabel}`}
      />

      {item !== null && (
        <>
          <Typography variant="overline" color="text.secondary" component="p">
            {itemKind.singularTitle}
          </Typography>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={2}
            sx={{ justifyContent: "space-between", alignItems: { sm: "flex-start" } }}
          >
            <Typography variant="h4" component="h1">
              {item.title}
            </Typography>
            <Stack direction="row" spacing={1}>
              <Button
                component={RouterLink}
                to={websiteItemEditPath(itemKind, websiteId, item.id)}
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

          <Typography sx={{ mt: 3, whiteSpace: "pre-wrap" }}>{item.description}</Typography>
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
            Created {new Date(item.createdAt).toLocaleString()} · Updated{" "}
            {new Date(item.updatedAt).toLocaleString()}
          </Typography>

          <ConfirmDeleteDialog
            isOpen={deleteDialogIsOpen}
            title={`Delete ${itemKind.singularLabel}?`}
            message={`"${item.title}" will be deleted.`}
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
