import { useState } from "react";
import { useJsonMutation } from "./useJsonMutation";
import { useReturnNavigation } from "./useReturnNavigation";
import { websiteDetailPath, websiteItemApiUrl } from "../utils/routePaths";
import { type WebsiteItemKind } from "../utils/websiteItemKinds";

/** What `useWebsiteItemDeletion` hands back: the delete dialog's state and handlers. */
export interface WebsiteItemDeletion {
  /** True while the delete confirmation dialog is open. */
  deleteDialogIsOpen: boolean;
  /** True while the DELETE request is in flight. */
  isDeleting: boolean;
  /** Why the last DELETE failed (the server's reason), or null. */
  deleteErrorMessage: string | null;
  /** Opens the delete confirmation dialog. */
  openDeleteDialog: () => void;
  /** Closes the dialog without deleting. */
  closeDeleteDialog: () => void;
  /** Sends the DELETE; on success closes the dialog and returns to the owning website. */
  confirmDelete: () => void;
}

/**
 * The delete flow shared by the use case and action detail pages: a
 * confirmation dialog, the DELETE request, and - when it succeeds - a
 * history-aware return to the owning website's page (see
 * `useReturnNavigation`). On failure the dialog stays open and shows the
 * server's reason.
 * @param itemKind - Which kind of item is being deleted
 * @param websiteId - The owning website's cuid
 * @param itemId - The item's cuid
 * @returns The dialog's state and handlers
 */
export function useWebsiteItemDeletion(
  itemKind: WebsiteItemKind,
  websiteId: string,
  itemId: string,
): WebsiteItemDeletion {
  const { returnTo } = useReturnNavigation();
  const { sendJsonRequest, isSubmitting, errorMessage } = useJsonMutation();
  const [deleteDialogIsOpen, setDeleteDialogIsOpen] = useState(false);

  /** Opens the delete confirmation dialog. */
  const openDeleteDialog = (): void => {
    setDeleteDialogIsOpen(true);
  };

  /** Closes the delete confirmation dialog without deleting. */
  const closeDeleteDialog = (): void => {
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
    returnTo(websiteDetailPath(websiteId));
  };

  /**
   * Starts the delete without returning its promise, because the dialog's
   * `onConfirm` prop expects a plain void callback.
   */
  const confirmDelete = (): void => {
    void deleteItem();
  };

  return {
    deleteDialogIsOpen,
    isDeleting: isSubmitting,
    deleteErrorMessage: errorMessage,
    openDeleteDialog,
    closeDeleteDialog,
    confirmDelete,
  };
}
