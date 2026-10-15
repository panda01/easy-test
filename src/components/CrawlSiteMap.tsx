import { type ReactElement } from "react";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Typography from "@mui/material/Typography";
import StatusDot from "./StatusDot";
import { type CrawledPageSummaryRecord } from "../hooks/useCrawlRunProgress";
import { MONOSPACE_FONT_FAMILY, nocturneTokens, statusColors } from "../theme/nocturneTheme";
import { buildCrawlSiteTree, flattenCrawlSiteTree } from "../utils/buildCrawlSiteTree";
import { describeSiteMapNote, formatCrawledPagePath } from "../utils/describeCrawlRun";

const HEADING_ID = "crawl-site-map-heading";

/** How far each tree level is indented, in px. */
const INDENT_PER_TREE_LEVEL_PX = 18;

/** Props for `CrawlSiteMap`. */
export interface CrawlSiteMapProps {
  /** The crawl's pages, in visiting order. */
  pages: CrawledPageSummaryRecord[];
  /** The page shown in full beside the map, or null. */
  selectedPageId: string | null;
  /** Called with a page's id when the user picks it. */
  onSelectPage: (crawledPageId: string) => void;
  /** True for the phone layout: rows on the page ground at 44 px, instead of a panel. */
  isPhoneLayout: boolean;
}

/**
 * The "Site map": every page the crawl found, as a tree - each page indented
 * under the page whose link first led to it, the start page at the top. Each
 * row shows a green or red dot (whether the page loaded), the page's path,
 * and a short note: its status when it failed ("HTTP 404"), its redirect
 * ("from /", "→ /calendar"), or the button that led to it ("via “Open
 * Yoga”") - see `describeSiteMapNote`. Picking a row shows that page in full;
 * the shown page is highlighted. On desktop a long map scrolls inside its
 * panel (at most 640 px tall).
 *
 * Drawn as one indented list (not nested lists), so every row is a plain
 * button a keyboard or screen reader can reach in reading order.
 * @param props - The pages, the selection, the select handler, and the layout
 * @returns The rendered site map
 */
export default function CrawlSiteMap(props: CrawlSiteMapProps): ReactElement {
  const { pages, selectedPageId, onSelectPage, isPhoneLayout } = props;
  const treeRows = flattenCrawlSiteTree(buildCrawlSiteTree(pages));
  const thereAreNoPages = treeRows.length === 0;

  return (
    <Box
      component="section"
      aria-labelledby={HEADING_ID}
      sx={
        isPhoneLayout
          ? {}
          : {
              backgroundColor: nocturneTokens.surface,
              borderRadius: `${String(nocturneTokens.radius.large)}px`,
              padding: "10px",
            }
      }
    >
      <Box
        id={HEADING_ID}
        component="h2"
        sx={{
          m: 0,
          padding: isPhoneLayout ? "0 0 4px" : "6px 8px 8px",
          fontSize: 11,
          fontWeight: 400,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: nocturneTokens.neutral[500],
        }}
      >
        Site map
      </Box>
      {thereAreNoPages ? (
        <Typography color="text.secondary" sx={{ fontSize: 13.5, px: isPhoneLayout ? 0 : 1 }}>
          No pages yet.
        </Typography>
      ) : (
        <Box
          component="ul"
          aria-labelledby={HEADING_ID}
          // On desktop a long map scrolls inside its panel, beside the page details.
          sx={{ m: 0, p: 0, ...(isPhoneLayout ? {} : { maxHeight: 640, overflowY: "auto" }) }}
        >
          {treeRows.map(({ page, treeDepth }) => {
            const pageIsSelected = page.id === selectedPageId;
            const noteText = describeSiteMapNote(page);
            return (
              <Box component="li" key={page.id} sx={{ listStyle: "none" }}>
                <ButtonBase
                  aria-current={pageIsSelected ? "true" : undefined}
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
                    paddingLeft: `${String(8 + treeDepth * INDENT_PER_TREE_LEVEL_PX)}px`,
                    fontFamily: "inherit",
                    textAlign: "left",
                    borderRadius: `${String(nocturneTokens.radius.small)}px`,
                    backgroundColor: pageIsSelected ? nocturneTokens.accentRamp[900] : "transparent",
                    boxShadow: pageIsSelected ? `inset 0 0 0 1px ${nocturneTokens.accentRamp[700]}` : "none",
                    "&:hover": {
                      backgroundColor: pageIsSelected
                        ? nocturneTokens.accentRamp[900]
                        : nocturneTokens.rowRule,
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
          })}
        </Box>
      )}
    </Box>
  );
}
