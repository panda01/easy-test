import { type ReactElement } from "react";
import { Link as RouterLink } from "react-router-dom";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import { AddIcon, ChevronRightIcon } from "./icons";
import LoadStatusNotice from "./LoadStatusNotice";
import ScriptRunStatusIcon from "./ScriptRunStatusIcon";
import StatusTag from "./StatusTag";
import { type JsonResourceState } from "../hooks/useJsonResource";
import { type WebsiteItemRecord } from "../hooks/useWebsiteItems";
import { type ReturnState } from "../hooks/useReturnNavigation";
import { nocturneTokens, runStatusColors } from "../theme/nocturneTheme";
import {
  countActionStatuses,
  describeActionStatusCounts,
  describeLatestRunLabel,
} from "../utils/describeActionStatus";
import { findScriptRunStatus } from "../utils/describeScriptRunStatus";
import { findChangedActionFields } from "../utils/describeScriptStaleness";
import { newWebsiteItemPath, websiteItemDetailPath } from "../utils/routePaths";
import { ACTION_KIND, type WebsiteItemKind } from "../utils/websiteItemKinds";

/** The desktop action row's columns: status, title and description, runs as, version, and status label. */
const DESKTOP_ACTION_ROW_COLUMNS = "20px minmax(0,1fr) 150px 64px 96px";

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
  /** True for the phone layout, where the section sits in its own tab (the tab names it, so it has no heading). */
  isPhoneLayout: boolean;
}

/** Props for `ActionRow`. */
interface ActionRowProps {
  /** The action, with its newest version (see `WebsiteItemRecord.newestScript`). */
  action: WebsiteItemRecord;
  /** Where the row links to: the action's page. */
  detailPath: string;
  /** History state for the link. */
  returnToHereState: ReturnState;
  /** True for the phone row. */
  isPhoneLayout: boolean;
  /** The current moment, for when the latest run passed. */
  now: Date;
}

/**
 * Tells whether an action's newest version was generated from different
 * text (or a different credential) than the action has now.
 * @param action - The action, with its newest version
 * @returns True when the action has a version and it is out of date
 */
function newestVersionIsOutOfDate(action: WebsiteItemRecord): boolean {
  const newestScript = action.newestScript ?? null;
  if (newestScript === null) return false;
  const changedFields = findChangedActionFields(newestScript, {
    title: action.title,
    description: action.description,
    credentialId: action.credentialId ?? null,
  });
  return changedFields.length > 0;
}

/**
 * One action in the website's action list, as a link to its page: its run
 * status icon; its title, with an "Out of date" tag when its newest version
 * was generated from different text; and its status in words ("12 min ago",
 * "Failed at step 9", "Not run yet") in the status color. Desktop rows also
 * show the description, who it runs as, and its version ("v6"); phone rows
 * show who it runs as after the status, and a chevron.
 * @param props - The action, its link, the layout, and the current moment
 * @returns The rendered row
 */
function ActionRow(props: ActionRowProps): ReactElement {
  const { action, detailPath, returnToHereState, isPhoneLayout, now } = props;
  const latestRun = action.newestScript?.latestRun ?? null;
  const statusColor = runStatusColors[findScriptRunStatus(latestRun)];
  const statusLabel = describeLatestRunLabel(latestRun, now);
  const runsAsText = action.credential?.name ?? "Logged out";
  const versionText =
    action.newestScript === undefined || action.newestScript === null
      ? "—"
      : `v${String(action.newestScript.versionNumber)}`;
  const outOfDateTag = newestVersionIsOutOfDate(action) && (
    <StatusTag label="Out of date" tone="stale" isCompact />
  );

  const rowSx = isPhoneLayout
    ? {
        gridTemplateColumns: "20px minmax(0,1fr) auto",
        gap: "12px",
        padding: "12px 4px",
        minHeight: 56,
        borderBottom: `1px solid ${nocturneTokens.rowRule}`,
      }
    : {
        gridTemplateColumns: DESKTOP_ACTION_ROW_COLUMNS,
        gap: "14px",
        padding: "12px 10px",
        borderRadius: `${String(nocturneTokens.radius.medium)}px`,
        "&:hover": { backgroundColor: nocturneTokens.surface },
      };

  return (
    <Box component="li" sx={{ listStyle: "none" }}>
      <Box
        component={RouterLink}
        to={detailPath}
        state={returnToHereState}
        sx={{ display: "grid", alignItems: "center", color: "inherit", textDecoration: "none", ...rowSx }}
      >
        <Box component="span" sx={{ display: "flex" }}>
          <ScriptRunStatusIcon latestRun={latestRun} />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Box
            sx={{
              fontSize: 14.5,
              fontWeight: 500,
              display: "flex",
              alignItems: "center",
              gap: isPhoneLayout ? "6px" : 1,
              flexWrap: isPhoneLayout ? "wrap" : "nowrap",
            }}
          >
            {action.title}
            {outOfDateTag}
          </Box>
          {isPhoneLayout ? (
            <Box sx={{ fontSize: 12, color: statusColor, mt: "2px" }}>
              {statusLabel} ·{" "}
              <Box component="span" sx={{ color: nocturneTokens.neutral[400] }}>
                {runsAsText}
              </Box>
            </Box>
          ) : (
            <Box
              sx={{
                fontSize: 12.5,
                color: nocturneTokens.neutral[400],
                mt: "2px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {action.description}
            </Box>
          )}
        </Box>
        {isPhoneLayout ? (
          <ChevronRightIcon aria-hidden="true" sx={{ fontSize: 16, color: nocturneTokens.neutral[500] }} />
        ) : (
          <>
            <Box component="span" sx={{ fontSize: 12.5, color: nocturneTokens.neutral[300] }}>
              {runsAsText}
            </Box>
            <Box component="span" sx={{ fontSize: 12.5, color: nocturneTokens.neutral[400] }}>
              {versionText}
            </Box>
            <Box component="span" sx={{ fontSize: 12.5, color: statusColor, textAlign: "right" }}>
              {statusLabel}
            </Box>
          </>
        )}
      </Box>
    </Box>
  );
}

/**
 * One "Actions" or "Use cases" section of a website's page, as the mockups
 * draw them:
 * - Actions: the heading, how many pass, fail, or have not been run ("4
 *   passed · 2 failed · 1 not run"), a "New action" button with a plus, and
 *   one row per action (see `ActionRow`), judged by its newest version's
 *   latest run.
 * - Use cases: the heading, a "New use case" button with a plus, and the use
 *   cases as cards (a "Use case" kicker, the title, the description), two to
 *   a row on desktop.
 *
 * Each item links to its own page; an empty list says so. On a phone the
 * section sits in its own tab, so the tab names it instead of a heading.
 * @param props - The kind, the owning website, the list request, the link state, and the layout
 * @returns The rendered section
 */
export default function WebsiteItemListSection(props: WebsiteItemListSectionProps): ReactElement {
  const { itemKind, websiteId, itemsResource, returnToHereState, isPhoneLayout } = props;
  const items = itemsResource.data;
  const headingId = `${itemKind.kindId}-section-heading`;
  const itemsAreActions = itemKind.kindId === ACTION_KIND.kindId;
  const thereAreItems = items !== null && items.length > 0;
  const thereAreNoItems = items !== null && items.length === 0;
  const now = new Date();
  const actionStatusSummary =
    itemsAreActions && thereAreItems
      ? describeActionStatusCounts(
          countActionStatuses(items.map((item) => item.newestScript?.latestRun ?? null)),
        )
      : null;

  const newItemButton = (
    <Button
      component={RouterLink}
      to={newWebsiteItemPath(itemKind, websiteId)}
      state={returnToHereState}
      variant="outlined"
      color={itemsAreActions ? "primary" : "secondary"}
      startIcon={<AddIcon />}
      sx={{ flex: "none", minHeight: isPhoneLayout ? 40 : 36 }}
    >
      New {itemKind.singularLabel}
    </Button>
  );

  return (
    <Box
      component="section"
      aria-labelledby={isPhoneLayout ? undefined : headingId}
      aria-label={isPhoneLayout ? itemKind.pluralTitle : undefined}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          mb: isPhoneLayout ? "6px" : "12px",
        }}
      >
        {!isPhoneLayout && (
          <Typography id={headingId} variant="h4" component="h2" sx={{ m: 0, mr: "auto" }}>
            {itemKind.pluralTitle}
          </Typography>
        )}
        {actionStatusSummary !== null && (
          <Box
            component="span"
            sx={{
              fontSize: 12.5,
              color: nocturneTokens.neutral[400],
              mr: isPhoneLayout ? "auto" : 0,
            }}
          >
            {actionStatusSummary}
          </Box>
        )}
        {isPhoneLayout && actionStatusSummary === null && <Box sx={{ mr: "auto" }} />}
        {newItemButton}
      </Box>

      <LoadStatusNotice
        isLoading={itemsResource.isLoading}
        errorMessage={itemsResource.errorMessage}
        loadingLabel={`Loading ${itemKind.pluralLabel}`}
      />

      {thereAreNoItems && (
        <Typography color="text.secondary" sx={{ fontSize: 13.5 }}>
          No {itemKind.pluralLabel} yet.
        </Typography>
      )}

      {thereAreItems && itemsAreActions && (
        <Box
          component="ul"
          aria-label={itemKind.pluralTitle}
          sx={{ display: "flex", flexDirection: "column", m: 0, p: 0 }}
        >
          {items.map((item) => (
            <ActionRow
              key={item.id}
              action={item}
              detailPath={websiteItemDetailPath(itemKind, websiteId, item.id)}
              returnToHereState={returnToHereState}
              isPhoneLayout={isPhoneLayout}
              now={now}
            />
          ))}
        </Box>
      )}

      {thereAreItems && !itemsAreActions && (
        <Box
          component="ul"
          aria-label={itemKind.pluralTitle}
          sx={{
            display: "grid",
            gridTemplateColumns: isPhoneLayout ? "1fr" : "1fr 1fr",
            gap: "10px",
            m: 0,
            p: 0,
          }}
        >
          {items.map((item) => (
            <Box component="li" key={item.id} sx={{ listStyle: "none", minWidth: 0 }}>
              <Box
                component={RouterLink}
                to={websiteItemDetailPath(itemKind, websiteId, item.id)}
                state={returnToHereState}
                sx={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "5.6px",
                  height: "100%",
                  padding: "8.4px 11px",
                  borderRadius: `${String(nocturneTokens.radius.medium)}px`,
                  backgroundColor: nocturneTokens.surface,
                  color: "inherit",
                  textDecoration: "none",
                  "&:hover": { boxShadow: nocturneTokens.shadow.small },
                }}
              >
                <Box
                  component="span"
                  sx={{
                    fontSize: 10,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    color: nocturneTokens.accent,
                  }}
                >
                  {itemKind.singularTitle}
                </Box>
                <Box component="span" sx={{ fontSize: 17, fontWeight: 500, lineHeight: 1.2 }}>
                  {item.title}
                </Box>
                <Box component="span" sx={{ fontSize: 13, opacity: 0.8 }}>
                  {item.description}
                </Box>
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
