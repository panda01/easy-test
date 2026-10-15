import { type ReactElement } from "react";
import { Link as RouterLink } from "react-router-dom";
import Box from "@mui/material/Box";
import LinearProgress from "@mui/material/LinearProgress";
import Link from "@mui/material/Link";
import StatusDot from "./StatusDot";
import { nocturneTokens, statusColors } from "../theme/nocturneTheme";
import { type CrawlRunProgressFields, describeCrawlRunProgress } from "../utils/describeCrawlRun";
import { formatElapsed } from "../utils/formatRelativeTime";

/** The parts of a running crawl the card is built from. */
export interface CrawlProgressCardRun extends CrawlRunProgressFields {
  /** When the crawl started, as the API sends it (an ISO string). */
  createdAt: string;
}

/** Props for `CrawlProgressCard`. */
export interface CrawlProgressCardProps {
  /** The running crawl. */
  run: CrawlProgressCardRun;
  /** The card's heading, e.g. "Crawl running" (website page) or "Running" (crawl page). */
  title: string;
  /** The current moment, ticking, for the elapsed time. */
  now: Date;
  /** Where "Watch" goes (the crawl's own page); omit to leave the link out. */
  watchPath?: string;
}

/**
 * A running crawl, as the mockups draw it in an accent-outlined card: a
 * glowing dot, the heading, the time it has run ("2:14"), a progress bar of
 * the pages visited against the page limit, "12 of up to 50 pages · 8
 * waiting", and a "Watch" link to the crawl's own page. It is a
 * `role="status"` region: it reports progress, it asks nothing.
 * @param props - The crawl, the heading, the current time, and where Watch goes
 * @returns The progress card
 */
export default function CrawlProgressCard(props: CrawlProgressCardProps): ReactElement {
  const { run, title, now, watchPath } = props;
  const elapsedMs = now.getTime() - new Date(run.createdAt).getTime();
  const visitedPercent = Math.min(100, (run.visitedPageCount / Math.max(1, run.pageLimit)) * 100);
  const watchLinkIsShown = watchPath !== undefined;

  return (
    <Box
      role="status"
      sx={{
        padding: "12px 14px",
        borderRadius: `${String(nocturneTokens.radius.medium)}px`,
        boxShadow: `inset 0 0 0 1px ${nocturneTokens.accentRamp[700]}`,
        backgroundColor: nocturneTokens.accentRamp[900],
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, fontSize: 13.5, mb: "10px" }}>
        <StatusDot color={statusColors.running} isGlowing />
        <Box component="span" sx={{ fontWeight: 500 }}>
          {title}
        </Box>
        <Box
          component="span"
          sx={{
            ml: "auto",
            fontSize: 12,
            color: nocturneTokens.accentRamp[300],
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {formatElapsed(elapsedMs)}
        </Box>
      </Box>
      <LinearProgress
        variant="determinate"
        value={visitedPercent}
        aria-label="Pages crawled"
        sx={{ mb: 1 }}
      />
      <Box sx={{ display: "flex", gap: 1, fontSize: 12.5, color: nocturneTokens.accentRamp[200] }}>
        <Box component="span" sx={{ mr: "auto" }}>
          {describeCrawlRunProgress(run)}
        </Box>
        {watchLinkIsShown && (
          <Link component={RouterLink} to={watchPath}>
            Watch
          </Link>
        )}
      </Box>
    </Box>
  );
}
