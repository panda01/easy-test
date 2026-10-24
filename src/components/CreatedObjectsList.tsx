import { type ReactElement } from "react";
import { Link as RouterLink } from "react-router-dom";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Link from "@mui/material/Link";
import Typography from "@mui/material/Typography";
import { DeleteOutlineIcon } from "./icons";
import StatusTag from "./StatusTag";
import { type CreatedObjectRecord } from "../hooks/useCreatedObjects";
import { nocturneTokens } from "../theme/nocturneTheme";
import { formatFullDateTime, formatRelativeTime } from "../utils/formatRelativeTime";
import { websiteItemDetailPath } from "../utils/routePaths";
import { ACTION_KIND } from "../utils/websiteItemKinds";

/** Props for `CreatedObjectsList`. */
export interface CreatedObjectsListProps {
  /** The owning website's cuid, for the links to the actions. */
  websiteId: string;
  /** The created objects to list, newest first. */
  createdObjects: CreatedObjectRecord[];
  /** What the list is called, for screen readers. */
  label: string;
  /** True while a remove request is in flight. */
  isRemoving: boolean;
  /** Called with a created object's id when the user clicks Remove. */
  onRemove: (createdObjectId: string) => void;
}

/**
 * Says what the record knows about an object now: deleted by a run, not
 * seen by a crawl, seen by a crawl, or not crawled since it was made.
 * @param createdObject - The created object
 * @returns The status text, and the tag tone that goes with it
 */
export function describeCreatedObjectStatus(createdObject: CreatedObjectRecord): {
  text: string;
  tone: "failed" | "stale" | "loggedIn" | "neutral";
} {
  const deletingRun = createdObject.deletedByActionScriptRun;
  if (createdObject.deletedOnSiteAt !== null) {
    const byText = deletingRun === null ? "a run" : `a run of ${deletingRun.action.title}`;
    return { text: `Deleted by ${byText} on ${formatFullDateTime(createdObject.deletedOnSiteAt)}`, tone: "failed" };
  }
  if (createdObject.notSeenSince !== null) {
    return { text: `Not seen since ${formatFullDateTime(createdObject.notSeenSince)}`, tone: "stale" };
  }
  if (createdObject.lastSeenAt !== null) {
    return { text: `Seen on the crawl of ${formatFullDateTime(createdObject.lastSeenAt)}`, tone: "loggedIn" };
  }
  return { text: "Not crawled since it was made", tone: "neutral" };
}

/**
 * A list of created objects - the record of what the website's Create
 * actions made, so they can be cleaned up or used again. Each row shows the
 * object's name (linked to its own page when it has one), the action that
 * made it (linked, unless it was deleted since) and when, what the record
 * knows now (see `describeCreatedObjectStatus`), and Remove, which only
 * takes it off the record - the object stays on the website.
 * @param props - The website, the objects, the list's name, and the remove wiring
 * @returns The rendered list
 */
export default function CreatedObjectsList(props: CreatedObjectsListProps): ReactElement {
  const { websiteId, createdObjects, label, isRemoving, onRemove } = props;
  return (
    <Box component="ul" aria-label={label} sx={{ m: 0, p: 0 }}>
      {createdObjects.map((createdObject) => {
        const status = describeCreatedObjectStatus(createdObject);
        const actionWasDeleted = createdObject.action.deletedAt !== null;
        return (
          <Box
            component="li"
            key={createdObject.id}
            sx={{ listStyle: "none", py: "6px", display: "flex", alignItems: "flex-start", gap: 1 }}
          >
            <Box sx={{ minWidth: 0, mr: "auto" }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                {createdObject.url === null ? (
                  <Typography component="span" sx={{ fontSize: 13.5, fontWeight: 500 }}>
                    {createdObject.name}
                  </Typography>
                ) : (
                  <Link href={createdObject.url} target="_blank" rel="noreferrer" sx={{ fontSize: 13.5, fontWeight: 500 }}>
                    {createdObject.name}
                  </Link>
                )}
                <StatusTag label={status.text} tone={status.tone} isCompact />
              </Box>
              <Typography sx={{ fontSize: 12, color: nocturneTokens.neutral[400] }}>
                Made by{" "}
                {actionWasDeleted ? (
                  `${createdObject.action.title} (deleted)`
                ) : (
                  <Link
                    component={RouterLink}
                    to={websiteItemDetailPath(ACTION_KIND, websiteId, createdObject.action.id)}
                  >
                    {createdObject.action.title}
                  </Link>
                )}{" "}
                · <span title={formatFullDateTime(createdObject.createdAt)}>{formatRelativeTime(createdObject.createdAt, new Date())}</span>
              </Typography>
            </Box>
            <IconButton
              size="small"
              aria-label={`Remove ${createdObject.name} from the record`}
              disabled={isRemoving}
              onClick={() => {
                onRemove(createdObject.id);
              }}
              sx={{ p: "4px" }}
            >
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </Box>
        );
      })}
    </Box>
  );
}
