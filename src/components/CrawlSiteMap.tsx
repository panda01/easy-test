import { type ReactElement } from "react";
import Box from "@mui/material/Box";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import CrawledPageRow from "./CrawledPageRow";
import CrawlWebObjectMap from "./CrawlWebObjectMap";
import {
  type CrawlPageGroupingRecord,
  type CrawlPageGroupingWebObjectRecord,
  type CrawledPageSummaryRecord,
} from "../hooks/useCrawlRunProgress";
import { nocturneTokens } from "../theme/nocturneTheme";
import { buildCrawlSiteTree, flattenCrawlSiteTree } from "../utils/buildCrawlSiteTree";

const HEADING_ID = "crawl-site-map-heading";

/** The two ways the site map draws a crawl's pages: as the link tree, or grouped into web objects. */
export type CrawlSiteMapView = "tree" | "objects";

/** What the site map needs to offer its Objects view. */
export interface CrawlSiteMapObjectsView {
  /** Which view is shown. */
  siteMapView: CrawlSiteMapView;
  /** Called with the view the user picks. */
  onSiteMapViewChange: (siteMapView: CrawlSiteMapView) => void;
  /** The crawl's pages grouped into web objects, with this visit's renames applied. */
  pageGrouping: CrawlPageGroupingRecord;
  /** Called when the user asks to rename a saved web object. */
  onRenameWebObject: (webObject: CrawlPageGroupingWebObjectRecord) => void;
}

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
  /** The Objects view and its Tree / Objects switch; left out, only the tree is drawn. */
  objectsView?: CrawlSiteMapObjectsView;
}

/**
 * The "Site map": every page the crawl found, drawn one of two ways, picked
 * with a Tree / Objects switch in its header:
 * - Tree: each page indented under the page whose link first led to it, the
 *   start page at the top;
 * - Objects: the pages grouped into web objects by their URL patterns (see
 *   `CrawlWebObjectMap`).
 * Each page row shows a green or red dot (whether the page loaded), the
 * page's path, and a short note (see `CrawledPageRow`). Picking a row shows
 * that page in full; the shown page is highlighted. On desktop a long map
 * scrolls inside its panel (at most 640 px tall).
 *
 * The tree is drawn as one indented list (not nested lists), so every row is
 * a plain button a keyboard or screen reader can reach in reading order.
 * @param props - The pages, the selection, the select handler, the layout, and the Objects view
 * @returns The rendered site map
 */
export default function CrawlSiteMap(props: CrawlSiteMapProps): ReactElement {
  const { pages, selectedPageId, onSelectPage, isPhoneLayout, objectsView } = props;
  const treeRows = flattenCrawlSiteTree(buildCrawlSiteTree(pages));
  const thereAreNoPages = treeRows.length === 0;
  const objectsViewIsShown = objectsView?.siteMapView === "objects";
  const scrollingListSx = isPhoneLayout ? {} : { maxHeight: 640, overflowY: "auto" };

  /**
   * Switches the view. A click on the view already shown hands back null
   * (MUI's exclusive toggle), which keeps that view.
   * @param _event - The click (unused)
   * @param pickedView - The view picked, or null
   */
  const handleViewChange = (_event: unknown, pickedView: CrawlSiteMapView | null): void => {
    if (pickedView !== null) {
      objectsView?.onSiteMapViewChange(pickedView);
    }
  };

  let siteMapContent: ReactElement;
  if (thereAreNoPages) {
    siteMapContent = (
      <Typography color="text.secondary" sx={{ fontSize: 13.5, px: isPhoneLayout ? 0 : 1 }}>
        No pages yet.
      </Typography>
    );
  } else if (objectsViewIsShown) {
    siteMapContent = (
      <Box sx={scrollingListSx}>
        <CrawlWebObjectMap
          pageGrouping={objectsView.pageGrouping}
          pages={pages}
          selectedPageId={selectedPageId}
          onSelectPage={onSelectPage}
          isPhoneLayout={isPhoneLayout}
          onRenameWebObject={objectsView.onRenameWebObject}
        />
      </Box>
    );
  } else {
    siteMapContent = (
      <Box
        component="ul"
        aria-labelledby={HEADING_ID}
        // On desktop a long map scrolls inside its panel, beside the page details.
        sx={{ m: 0, p: 0, ...scrollingListSx }}
      >
        {treeRows.map(({ page, treeDepth }) => (
          <CrawledPageRow
            key={page.id}
            page={page}
            indentLevel={treeDepth}
            isSelected={page.id === selectedPageId}
            onSelectPage={onSelectPage}
            isPhoneLayout={isPhoneLayout}
          />
        ))}
      </Box>
    );
  }

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
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          padding: isPhoneLayout ? "0 0 4px" : "6px 8px 8px",
        }}
      >
        <Box
          id={HEADING_ID}
          component="h2"
          sx={{
            m: 0,
            mr: "auto",
            fontSize: 11,
            fontWeight: 400,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: nocturneTokens.neutral[500],
          }}
        >
          Site map
        </Box>
        {objectsView !== undefined && (
          <ToggleButtonGroup
            value={objectsView.siteMapView}
            exclusive
            onChange={handleViewChange}
            size="small"
            aria-label="Site map view"
          >
            <ToggleButton value="tree" sx={{ py: "2px", px: "10px", fontSize: 12 }}>
              Tree
            </ToggleButton>
            <ToggleButton value="objects" sx={{ py: "2px", px: "10px", fontSize: 12 }}>
              Objects
            </ToggleButton>
          </ToggleButtonGroup>
        )}
      </Box>
      {siteMapContent}
    </Box>
  );
}
