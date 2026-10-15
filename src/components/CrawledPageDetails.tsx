import { type ReactElement, type ReactNode } from "react";
import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import Typography from "@mui/material/Typography";
import CodeBlock from "./CodeBlock";
import LoadStatusNotice from "./LoadStatusNotice";
import { type CrawledPageRecord } from "../hooks/useCrawledPage";
import { type CrawledPageSummaryRecord } from "../hooks/useCrawlRunProgress";
import { type JsonResourceState } from "../hooks/useJsonResource";
import { MONOSPACE_FONT_FAMILY, nocturneTokens, statusColors } from "../theme/nocturneTheme";
import { describeRedirectFact, formatCrawledPagePath } from "../utils/describeCrawlRun";

const HEADING_ID = "crawled-page-details-heading";

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

/** Props for `CrawledUrlCard`. */
interface CrawledUrlCardProps {
  /** The card's kicker, without the count, e.g. "Links". */
  kicker: string;
  /** The identity URLs to list, in order. */
  urls: string[];
  /** Every visited page of the run by its identity URL, to select the visited ones. */
  visitedPagesByUrl: ReadonlyMap<string, CrawledPageSummaryRecord>;
  /** Called with a visited page's id when the user picks it. */
  onSelectPage: (crawledPageId: string) => void;
  /** True to put the button that led to each visited page before its path (“Open Yoga” → /calendar/open-yoga). */
  namesTheButtons: boolean;
}

/**
 * One of the page's two cards - "Links · 14" or "Buttons led to · 3" - listing
 * same-site page URLs by their path: a page the crawl visited is a button
 * that selects it, and one it never reached (e.g. the page limit) is plain
 * text marked "(not visited)".
 * @param props - The kicker, the URLs, the run's pages by URL, the select handler, and whether to name the buttons
 * @returns The rendered card
 */
function CrawledUrlCard(props: CrawledUrlCardProps): ReactElement {
  const { kicker, urls, visitedPagesByUrl, onSelectPage, namesTheButtons } = props;
  const thereAreNoUrls = urls.length === 0;
  const kickerText = `${kicker} · ${String(urls.length)}`;

  return (
    <Box
      component="section"
      aria-label={kickerText}
      sx={{
        display: "flex",
        flexDirection: "column",
        gap: "5.6px",
        padding: "8.4px 11px",
        borderRadius: `${String(nocturneTokens.radius.medium)}px`,
        backgroundColor: nocturneTokens.surface,
        minWidth: 0,
      }}
    >
      <Box
        component="h3"
        sx={{
          m: 0,
          fontSize: 10,
          fontWeight: 400,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: nocturneTokens.accent,
        }}
      >
        {kickerText}
      </Box>
      {thereAreNoUrls ? (
        <Typography sx={{ fontSize: 12.5, color: nocturneTokens.neutral[500] }}>None</Typography>
      ) : (
        <Box
          component="ul"
          sx={{
            m: 0,
            p: 0,
            fontFamily: MONOSPACE_FONT_FAMILY,
            fontSize: 12.5,
            lineHeight: 1.8,
            color: nocturneTokens.neutral[300],
            maxHeight: 220,
            overflow: "auto",
          }}
        >
          {urls.map((url) => {
            const visitedPage = visitedPagesByUrl.get(url);
            const urlPath = formatCrawledPagePath(url);
            const buttonText = visitedPage?.foundByButtonText ?? null;
            const buttonPrefix = namesTheButtons && buttonText !== null ? `“${buttonText}” → ` : "";
            return (
              <Box component="li" key={url} sx={{ listStyle: "none", overflowWrap: "anywhere" }}>
                {visitedPage === undefined ? (
                  <Box component="span" sx={{ color: nocturneTokens.neutral[500] }}>
                    {urlPath} (not visited)
                  </Box>
                ) : (
                  <Link
                    component="button"
                    type="button"
                    onClick={() => {
                      onSelectPage(visitedPage.id);
                    }}
                    underline="hover"
                    sx={{ font: "inherit", textAlign: "left", color: nocturneTokens.neutral[300] }}
                  >
                    {buttonPrefix}
                    {urlPath}
                  </Link>
                )}
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}

/**
 * Counts the lines of an aria snapshot, for "212 lines" beside its heading.
 * @param ariaSnapshot - The snapshot text
 * @returns The line count with its noun
 */
function describeSnapshotLineCount(ariaSnapshot: string): string {
  const lineCount = ariaSnapshot.split("\n").length;
  return lineCount === 1 ? "1 line" : `${String(lineCount)} lines`;
}

/**
 * One crawled page in full, as the mockup's details pane draws it: its path
 * as the heading; a row of facts - its HTTP status (green when it loaded, red
 * when it did not), its title, its redirect ("Redirected from /"), and where
 * it was found ("Found on /", and the button when one led here; "Start page"
 * for the first); a failed page's error; two cards for the same-site links on
 * it and the pages its buttons led to; and its Playwright aria snapshot. The
 * parent and every visited link or button target are buttons that select
 * that page; one the crawl never reached (the page limit) is plain text.
 * @param props - The page, its full record's request state, the run's pages, and the select handler
 * @returns The rendered page details
 */
export default function CrawledPageDetails(props: CrawledPageDetailsProps): ReactElement {
  const { page, pageResource, visitedPagesByUrl, visitedPagesById, onSelectPage } = props;
  const fullPage = pageResource.data;
  const pageHasErrorMessage = page.errorMessage !== null;
  const pageIsTheStartPage = page.parentPageId === null;
  const parentPage =
    page.parentPageId === null ? undefined : visitedPagesById.get(page.parentPageId);
  const { foundByButtonText } = page;
  const foundByButtonSuffix =
    foundByButtonText === null ? "" : ` via “${foundByButtonText}”`;
  const redirectFact = describeRedirectFact(page);
  const httpStatusText = page.httpStatus === null ? "No response" : `HTTP ${String(page.httpStatus)}`;

  let foundOnFact: ReactNode = "Found on a page no longer listed";
  if (pageIsTheStartPage) {
    foundOnFact = "Start page";
  } else if (parentPage !== undefined) {
    foundOnFact = (
      <>
        Found on{" "}
        <Link
          component="button"
          type="button"
          onClick={() => {
            onSelectPage(parentPage.id);
          }}
          sx={{ font: "inherit", verticalAlign: "baseline" }}
        >
          {formatCrawledPagePath(parentPage.url)}
        </Link>
        {foundByButtonSuffix}
      </>
    );
  }

  return (
    <Box component="section" aria-labelledby={HEADING_ID} sx={{ minWidth: 0 }}>
      <Typography
        id={HEADING_ID}
        component="h2"
        sx={{ fontFamily: MONOSPACE_FONT_FAMILY, fontSize: 20, mb: "6px", overflowWrap: "anywhere" }}
      >
        {formatCrawledPagePath(page.url)}
      </Typography>
      <Box
        sx={{
          display: "flex",
          gap: 2,
          flexWrap: "wrap",
          fontSize: 13,
          color: nocturneTokens.neutral[400],
          mb: pageHasErrorMessage ? 1 : "20px",
        }}
      >
        <Box component="span" sx={{ color: page.succeeded ? statusColors.httpOk : statusColors.failed }}>
          {httpStatusText}
        </Box>
        {page.title !== null && <span>{page.title}</span>}
        {redirectFact !== null && <span>{redirectFact}</span>}
        <span>{foundOnFact}</span>
      </Box>
      {pageHasErrorMessage && (
        <Typography sx={{ fontSize: 13, color: statusColors.failedStepNote, mb: "20px", overflowWrap: "anywhere" }}>
          {page.errorMessage}
        </Typography>
      )}

      <LoadStatusNotice
        isLoading={pageResource.isLoading}
        errorMessage={pageResource.errorMessage}
        loadingLabel="Loading page"
      />

      {fullPage !== null && (
        <>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
              gap: "12px",
              mb: "20px",
            }}
          >
            <CrawledUrlCard
              kicker="Links"
              urls={fullPage.linkedUrls}
              visitedPagesByUrl={visitedPagesByUrl}
              onSelectPage={onSelectPage}
              namesTheButtons={false}
            />
            <CrawledUrlCard
              kicker="Buttons led to"
              urls={fullPage.buttonUrls}
              visitedPagesByUrl={visitedPagesByUrl}
              onSelectPage={onSelectPage}
              namesTheButtons
            />
          </Box>

          <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
            <Typography variant="h5" component="h3" sx={{ m: 0, mr: "auto" }}>
              Aria snapshot
            </Typography>
            {fullPage.ariaSnapshot !== null && (
              <Box component="span" sx={{ fontSize: 12, color: nocturneTokens.neutral[500] }}>
                {describeSnapshotLineCount(fullPage.ariaSnapshot)}
              </Box>
            )}
          </Box>
          {fullPage.ariaSnapshot === null ? (
            <Typography color="text.secondary" sx={{ fontSize: 13.5 }}>
              No aria snapshot was taken for this page.
            </Typography>
          ) : (
            <CodeBlock code={fullPage.ariaSnapshot} label="Aria snapshot" />
          )}
        </>
      )}
    </Box>
  );
}
