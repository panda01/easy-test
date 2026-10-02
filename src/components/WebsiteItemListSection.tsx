import { type ReactElement } from "react";
import { Link as RouterLink } from "react-router-dom";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import LoadStatusNotice from "./LoadStatusNotice";
import { type JsonResourceState } from "../hooks/useJsonResource";
import { type WebsiteItemRecord } from "../hooks/useWebsiteItems";
import { type ReturnState } from "../hooks/useReturnNavigation";
import { newWebsiteItemPath, websiteItemDetailPath } from "../utils/routePaths";
import { type WebsiteItemKind } from "../utils/websiteItemKinds";

/** Props for `WebsiteItemListSection`. */
export interface WebsiteItemListSectionProps {
  /** Which kind of item this section lists (use cases or actions). */
  itemKind: WebsiteItemKind;
  /** The owning website's cuid. */
  websiteId: string;
  /** The item list request, fetched by the page so it can also count the items. */
  itemsResource: JsonResourceState<WebsiteItemRecord[]>;
  /** History state for the links, so the opened page can return here cleanly. */
  returnToHereState: ReturnState;
}

/**
 * One "Use cases" or "Actions" section of a website's detail page: a heading,
 * a "New ..." button, and the items as links to their own detail pages (or an
 * empty-state line when there are none).
 * @param props - The kind, the owning website, the list request, and the link state
 * @returns The rendered section
 */
export default function WebsiteItemListSection(props: WebsiteItemListSectionProps): ReactElement {
  const { itemKind, websiteId, itemsResource, returnToHereState } = props;
  const items = itemsResource.data;
  const headingId = `${itemKind.kindId}-section-heading`;

  return (
    <Box component="section" aria-labelledby={headingId} sx={{ mt: 5 }}>
      <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center", mb: 2 }}>
        <Typography id={headingId} variant="h5" component="h2">
          {itemKind.pluralTitle}
        </Typography>
        <Button
          component={RouterLink}
          to={newWebsiteItemPath(itemKind, websiteId)}
          state={returnToHereState}
          variant="outlined"
        >
          New {itemKind.singularLabel}
        </Button>
      </Stack>

      <LoadStatusNotice
        isLoading={itemsResource.isLoading}
        errorMessage={itemsResource.errorMessage}
        loadingLabel={`Loading ${itemKind.pluralLabel}`}
      />

      {items !== null && items.length === 0 && (
        <Typography color="text.secondary">No {itemKind.pluralLabel} yet.</Typography>
      )}

      {items !== null && items.length > 0 && (
        <Paper variant="outlined">
          <List disablePadding aria-label={itemKind.pluralTitle}>
            {items.map((item) => (
              <ListItemButton
                key={item.id}
                component={RouterLink}
                to={websiteItemDetailPath(itemKind, websiteId, item.id)}
                state={returnToHereState}
                divider
              >
                <ListItemText
                  primary={item.title}
                  secondary={item.description}
                  slotProps={{ secondary: { noWrap: true } }}
                />
              </ListItemButton>
            ))}
          </List>
        </Paper>
      )}
    </Box>
  );
}
