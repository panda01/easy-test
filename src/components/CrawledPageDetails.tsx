import { type ReactElement, type ReactNode } from "react";
import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import Typography from "@mui/material/Typography";
import CodeBlock from "./CodeBlock";
import LoadStatusNotice from "./LoadStatusNotice";
import { type CrawledPageRecord } from "../hooks/useCrawledPage";
import { type CrawledPageSummaryRecord } from "../hooks/useCrawlRunProgress";
import { type JsonResourceState } from "../hooks/useJsonResource";
import { formatCrawledPagePath } from "../utils/describeCrawlRun";
import { describeScreenshotRunOutcome, formatRunDuration } from "../utils/describeScreenshotRun";
import { formatCount } from "../utils/formatCount";

const HEADING_ID = "crawled-page-details-heading";
const LINKS_HEADING_ID = "crawled-page-links-heading";

/** Props for `CrawledPageDetails`. */
export interface CrawledPageDetailsProps {
  /** The selected page's summary, from the run's page list. */
  page: CrawledPageSummaryRecord;
  /** The selected page in full (snapshot and links), fetched separately. */
  pageResource: JsonResourceState<CrawledPageRecord>;
  /** Every visited page of the run by its identity URL, to link parents and links to them. */
  visitedPagesByUrl: ReadonlyMap<string, CrawledPageSummaryRecord>;
  /** Every visited page of the run by its id, to find the parent. */
  visitedPagesById: ReadonlyMap<string, CrawledPageSummaryRecord>;
  /** Called with a page's id when the user picks another page from here. */
  onSelectPage: (crawledPageId: string) => void;
}

/** Props for `DetailRow`. */
interface DetailRowProps {
  /** What the row is, e.g. "Loaded". */
  label: string;
  /** The row's value. */
  children: ReactNode;
}

/**
 * One "Label: value" line of the page's facts.
 * @param props - The label and the value
 * @returns The rendered line
 */
function DetailRow(props: DetailRowProps): ReactElement {
  const { label, children } = props;
  return (
    <Typography variant="body2" sx={{ wordBreak: "break-all" }}>
      <Box component="span" sx={{ color: "text.secondary" }}>
        {label}:
      </Box>{" "}
      {children}
    </Typography>
  );
}

/**
 * One crawled page in full: its path and outcome ("Failed · HTTP 404 ·
 * 1.2 s") with any error, where it was loaded from and ended up, its title,
 * the page it was found on, its Playwright aria snapshot, and the same-origin
 * links on it. The parent and every visited link are buttons that select
 * that page; a link the crawl never reached (the page limit) is plain text.
 * @param props - The page, its full record's request state, the run's pages, and the select handler
 * @returns The rendered page details
 */
export default function CrawledPageDetails(props: CrawledPageDetailsProps): ReactElement {
  const { page, pageResource, visitedPagesByUrl, visitedPagesById, onSelectPage } = props;
  const fullPage = pageResource.data;
  const pageHasErrorMessage = page.errorMessage !== null;
  const pageWasRedirected = page.finalUrl !== page.requestedUrl;
  const pageIsTheStartPage = page.parentPageId === null;
  const parentPage =
    page.parentPageId === null ? undefined : visitedPagesById.get(page.parentPageId);

  let foundOnContent: ReactNode = "a page no longer listed";
  if (pageIsTheStartPage) {
    foundOnContent = "this is where the crawl started";
  } else if (parentPage !== undefined) {
    foundOnContent = (
      <Link
        component="button"
        type="button"
        onClick={() => {
          onSelectPage(parentPage.id);
        }}
      >
        {formatCrawledPagePath(parentPage.url)}
      </Link>
    );
  }

  return (
    <Box component="section" aria-labelledby={HEADING_ID}>
      <Typography
        id={HEADING_ID}
        variant="h6"
        component="h2"
        sx={{ wordBreak: "break-all", mb: 0.5 }}
      >
        {formatCrawledPagePath(page.url)}
      </Typography>
      <Typography sx={{ color: page.succeeded ? "success.main" : "error.main" }}>
        {describeScreenshotRunOutcome(page)} · {formatRunDuration(page.durationMs)}
      </Typography>
      {pageHasErrorMessage && (
        <Typography variant="body2" color="error" sx={{ mt: 0.5 }}>
          {page.errorMessage}
        </Typography>
      )}

      <Box sx={{ mt: 2, display: "grid", gap: 0.5 }}>
        <DetailRow label="Loaded">{page.requestedUrl}</DetailRow>
        {pageWasRedirected && <DetailRow label="Ended up at">{page.finalUrl}</DetailRow>}
        <DetailRow label="Title">{page.title ?? "none"}</DetailRow>
        <DetailRow label="Found on">{foundOnContent}</DetailRow>
        <DetailRow label="Links followed to get here">{String(page.depth)}</DetailRow>
      </Box>

      <Typography variant="subtitle1" component="h3" sx={{ mt: 3, mb: 1 }}>
        Aria snapshot
      </Typography>
      <LoadStatusNotice
        isLoading={pageResource.isLoading}
        errorMessage={pageResource.errorMessage}
        loadingLabel="Loading page"
      />
      {fullPage !== null &&
        (fullPage.ariaSnapshot === null ? (
          <Typography color="text.secondary">
            No aria snapshot was taken for this page.
          </Typography>
        ) : (
          <CodeBlock code={fullPage.ariaSnapshot} label="Aria snapshot" />
        ))}

      {fullPage !== null && (
        <>
          <Typography id={LINKS_HEADING_ID} variant="subtitle1" component="h3" sx={{ mt: 3 }}>
            Links on this page
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {formatCount(fullPage.linkedUrls.length, "same-site link", "same-site links")}
          </Typography>
          {fullPage.linkedUrls.length > 0 && (
            <List dense disablePadding aria-labelledby={LINKS_HEADING_ID}>
              {fullPage.linkedUrls.map((linkedUrl) => {
                const linkedPage = visitedPagesByUrl.get(linkedUrl);
                const linkedPath = formatCrawledPagePath(linkedUrl);
                return (
                  <ListItem key={linkedUrl} disableGutters sx={{ wordBreak: "break-all" }}>
                    {linkedPage === undefined ? (
                      <Typography variant="body2" color="text.secondary">
                        {linkedPath} (not visited)
                      </Typography>
                    ) : (
                      <Link
                        component="button"
                        type="button"
                        variant="body2"
                        onClick={() => {
                          onSelectPage(linkedPage.id);
                        }}
                      >
                        {linkedPath}
                      </Link>
                    )}
                  </ListItem>
                );
              })}
            </List>
          )}
        </>
      )}
    </Box>
  );
}
