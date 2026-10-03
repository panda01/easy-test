import { type ReactElement } from "react";
import { Link as RouterLink } from "react-router-dom";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import ConfirmDeleteDialog from "./ConfirmDeleteDialog";
import { type WebsiteItemRecord } from "../hooks/useWebsiteItems";
import { type ReturnState } from "../hooks/useReturnNavigation";
import { type WebsiteItemDeletion } from "../hooks/useWebsiteItemDeletion";
import { websiteItemEditPath } from "../utils/routePaths";
import { type WebsiteItemKind } from "../utils/websiteItemKinds";

/** Props for `WebsiteItemSummary`. */
export interface WebsiteItemSummaryProps {
  /** Which kind of item this is, for the labels and the edit link. */
  itemKind: WebsiteItemKind;
  /** The owning website's cuid. */
  websiteId: string;
  /** The use case or action to show. */
  item: WebsiteItemRecord;
  /** History state for the Edit link, so the edit page can return here. */
  editLinkState: ReturnState;
  /** The delete dialog's state and handlers (see `useWebsiteItemDeletion`). */
  deletion: WebsiteItemDeletion;
}

/**
 * The top of a use case's or an action's detail page: the kind, the title
 * with Edit and Delete buttons, the description, the timestamps, and the
 * delete confirmation dialog. Shared by `UseCaseDetailPage` and
 * `ActionDetailPage`, which own the data and the delete flow.
 * @param props - The item, its kind, and the edit / delete wiring
 * @returns The rendered summary
 */
export default function WebsiteItemSummary(props: WebsiteItemSummaryProps): ReactElement {
  const { itemKind, websiteId, item, editLinkState, deletion } = props;

  return (
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
            state={editLinkState}
            variant="outlined"
          >
            Edit
          </Button>
          <Button onClick={deletion.openDeleteDialog} color="error" variant="outlined">
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
        isOpen={deletion.deleteDialogIsOpen}
        title={`Delete ${itemKind.singularLabel}?`}
        message={`"${item.title}" will be deleted.`}
        isDeleting={deletion.isDeleting}
        errorMessage={deletion.deleteErrorMessage}
        onCancel={deletion.closeDeleteDialog}
        onConfirm={deletion.confirmDelete}
      />
    </>
  );
}
