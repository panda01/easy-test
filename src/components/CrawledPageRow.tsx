import { type ReactElement } from "react";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import StatusDot from "./StatusDot";
import { type CrawledPageSummaryRecord } from "../hooks/useCrawlRunProgress";
import { MONOSPACE_FONT_FAMILY, nocturneTokens, statusColors } from "../theme/nocturneTheme";
import { describeSiteMapNote, formatCrawledPagePath } from "../utils/describeCrawlRun";

/** How far each level of a site map is indented, in px. */
export const INDENT_PER_TREE_LEVEL_PX = 18;

/** Props for `CrawledPageRow`. */
export interface CrawledPageRowProps {
  /** The page the row shows. */
  page: CrawledPageSummaryRecord;
  /** How many levels the row is indented: 0 at the left edge. */
  indentLevel: number;
  /** True when this page is the one shown in full beside the map. */
  isSelected: boolean;
  /** Called with the page's id when the user picks it. */
  onSelectPage: (crawledPageId: string) => void;
  /** True for the phone layout: rows 44 px tall. */
  isPhoneLayout: boolean;
}

/**
 * One page of a crawl's site map, as a list item holding a plain button: a
 * green or red dot (whether the page loaded), the page's path, and a short
 * note - its status when it failed, its redirect, or the button that led to
 * it (see `describeSiteMapNote`). The selected page is highlighted and marked
 * `aria-current`. Both the Tree and the Objects views of the site map draw
 * their pages with it.
 * @param props - The page, its indent, whether it is selected, the select handler, and the layout
 * @returns The rendered row
 */
export default function CrawledPageRow(props: CrawledPageRowProps): ReactElement {
  const { page, indentLevel, isSelected, onSelectPage, isPhoneLayout } = props;
  const noteText = describeSiteMapNote(page);

  return (
    <Box component="li" sx={{ listStyle: "none" }}>
      <ButtonBase
        aria-current={isSelected ? "true" : undefined}
        onClick={() => {
          onSelectPage(page.id);
        }}
        sx={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-start",
          gap: 1,
          minHeight: isPhoneLayout ? 44 : 34,
          paddingTop: isPhoneLayout ? 0 : "7px",
          paddingBottom: isPhoneLayout ? 0 : "7px",
          paddingRight: "8px",
          paddingLeft: `${String(8 + indentLevel * INDENT_PER_TREE_LEVEL_PX)}px`,
          fontFamily: "inherit",
          textAlign: "left",
          borderRadius: `${String(nocturneTokens.radius.small)}px`,
          backgroundColor: isSelected ? nocturneTokens.accentRamp[900] : "transparent",
          boxShadow: isSelected ? `inset 0 0 0 1px ${nocturneTokens.accentRamp[700]}` : "none",
          "&:hover": {
            backgroundColor: isSelected ? nocturneTokens.accentRamp[900] : nocturneTokens.rowRule,
          },
        }}
      >
        <StatusDot color={page.succeeded ? statusColors.passed : statusColors.failed} size={6} />
        <Box
          component="span"
          sx={{
            fontFamily: MONOSPACE_FONT_FAMILY,
            fontSize: 13,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            minWidth: 0,
          }}
        >
          {formatCrawledPagePath(page.url)}
        </Box>
        {noteText !== "" && (
          <Box
            component="span"
            sx={{
              fontSize: isPhoneLayout ? 11.5 : 12,
              color: nocturneTokens.neutral[500],
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              ml: "auto",
              flexShrink: 0,
              maxWidth: "45%",
            }}
          >
            {noteText}
          </Box>
        )}
      </ButtonBase>
    </Box>
  );
}
