import { type ReactElement } from "react";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { type CrawledPageSummaryRecord } from "../hooks/useCrawlRunProgress";
import { buildCrawlSiteTree, flattenCrawlSiteTree } from "../utils/buildCrawlSiteTree";
import { formatCrawledPagePath } from "../utils/describeCrawlRun";
import { describeScreenshotRunOutcome } from "../utils/describeScreenshotRun";

const HEADING_ID = "crawl-site-map-heading";

/** How far each tree level is indented, in theme spacing units. */
const INDENT_PER_TREE_LEVEL = 2.5;

/** Props for `CrawlSiteMap`. */
export interface CrawlSiteMapProps {
  /** The crawl's pages, in visiting order. */
  pages: CrawledPageSummaryRecord[];
  /** The page shown in full beside the map, or null. */
  selectedPageId: string | null;
  /** Called with a page's id when the user picks it. */
  onSelectPage: (crawledPageId: string) => void;
}

/**
 * The "Site map": every page the crawl found, as a tree - each page indented
 * under the page whose link first led to it, the start page at the top. Each
 * row shows the page's path and how it answered ("Succeeded · HTTP 200"),
 * coloured green or red, and picking a row shows that page in full.
 *
 * Drawn as one indented list (not nested lists), so every row is a plain
 * button a keyboard or screen reader can reach in reading order.
 * @param props - The pages, the selection, and the select handler
 * @returns The rendered site map
 */
export default function CrawlSiteMap(props: CrawlSiteMapProps): ReactElement {
  const { pages, selectedPageId, onSelectPage } = props;
  const treeRows = flattenCrawlSiteTree(buildCrawlSiteTree(pages));
  const thereAreNoPages = treeRows.length === 0;

  return (
    <section aria-labelledby={HEADING_ID}>
      <Typography id={HEADING_ID} variant="h6" component="h2" sx={{ mb: 1 }}>
        Site map
      </Typography>
      {thereAreNoPages ? (
        <Typography color="text.secondary">No pages yet.</Typography>
      ) : (
        <Paper variant="outlined" sx={{ maxHeight: 640, overflow: "auto" }}>
          <List dense disablePadding aria-labelledby={HEADING_ID}>
            {treeRows.map(({ page, treeDepth }) => {
              const pageIsSelected = page.id === selectedPageId;
              const pageTitleText = page.title === null ? "" : ` · ${page.title}`;
              return (
                <ListItemButton
                  key={page.id}
                  selected={pageIsSelected}
                  aria-current={pageIsSelected ? "true" : undefined}
                  onClick={() => {
                    onSelectPage(page.id);
                  }}
                  sx={{ pl: 2 + treeDepth * INDENT_PER_TREE_LEVEL }}
                  divider
                >
                  <ListItemText
                    primary={formatCrawledPagePath(page.url)}
                    secondary={`${describeScreenshotRunOutcome(page)}${pageTitleText}`}
                    slotProps={{
                      primary: { sx: { wordBreak: "break-all" } },
                      secondary: { sx: { color: page.succeeded ? "success.main" : "error.main" } },
                    }}
                  />
                </ListItemButton>
              );
            })}
          </List>
        </Paper>
      )}
    </section>
  );
}
