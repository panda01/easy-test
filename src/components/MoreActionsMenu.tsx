import { type MouseEvent, type ReactElement, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import { MoreHorizIcon } from "./icons";
import { type ReturnState } from "../hooks/useReturnNavigation";
import { nocturneTokens } from "../theme/nocturneTheme";

/** Props for `MoreActionsMenu`. */
export interface MoreActionsMenuProps {
  /** Where "Edit" goes: the record's edit form. */
  editPath: string;
  /** History state for the Edit link, so the form can return here. */
  editLinkState: ReturnState;
  /** Called when the user picks "Delete" (the page opens its confirmation dialog). */
  onDeleteClick: () => void;
}

/**
 * The phone layout's "⋯" button (44 px, as the mockups' hit targets are),
 * holding a page's Edit and Delete so the title keeps the width. Picking
 * either closes the menu.
 * @param props - Where Edit goes and what Delete does
 * @returns The button and its menu
 */
export default function MoreActionsMenu(props: MoreActionsMenuProps): ReactElement {
  const { editPath, editLinkState, onDeleteClick } = props;
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const menuIsOpen = menuAnchor !== null;

  /**
   * Opens the menu under its button.
   * @param event - The button's click event
   */
  const handleMenuOpen = (event: MouseEvent<HTMLElement>): void => {
    setMenuAnchor(event.currentTarget);
  };

  /** Closes the menu without picking anything. */
  const handleMenuClose = (): void => {
    setMenuAnchor(null);
  };

  /** Closes the menu and hands "Delete" to the page. */
  const handleDeleteClick = (): void => {
    setMenuAnchor(null);
    onDeleteClick();
  };

  return (
    <>
      <IconButton
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={menuIsOpen}
        onClick={handleMenuOpen}
        sx={{ width: 44, height: 44, flex: "none", border: `1px solid ${nocturneTokens.divider}` }}
      >
        <MoreHorizIcon />
      </IconButton>
      <Menu anchorEl={menuAnchor} open={menuIsOpen} onClose={handleMenuClose}>
        <MenuItem component={RouterLink} to={editPath} state={editLinkState} sx={{ minHeight: 44 }}>
          Edit
        </MenuItem>
        <MenuItem onClick={handleDeleteClick} sx={{ minHeight: 44 }}>
          Delete
        </MenuItem>
      </Menu>
    </>
  );
}
