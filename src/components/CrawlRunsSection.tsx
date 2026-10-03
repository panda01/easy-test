import { type ChangeEvent, type ReactElement } from "react";
import { Link as RouterLink } from "react-router-dom";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import LoadStatusNotice from "./LoadStatusNotice";
import { type CrawlButtonModeRecord, type CrawlRunRecord } from "../hooks/useCrawlRuns";
import { type CredentialRecord } from "../hooks/useCredentials";
import {
  crawlRunSeverity,
  describeCrawlRunLogin,
  describeCrawlRunStatus,
  formatCrawlButtonModeSuffix,
} from "../utils/describeCrawlRun";
import { crawlRunDetailPath } from "../utils/routePaths";

const HEADING_ID = "crawl-runs-section-heading";
const HISTORY_HEADING_ID = "crawl-run-history-heading";

/**
 * The "Crawl as" picker's value for a crawl as a logged-out visitor. Every
 * other value is a credential's id (a cuid, never empty).
 */
export const CRAWL_LOGGED_OUT_VALUE = "";

/** The "Buttons" picker's starting mode: follow links only, clicking no buttons. */
export const DEFAULT_CRAWL_BUTTON_MODE: CrawlButtonModeRecord = "linksOnly";

/** One option of the "Buttons" picker. */
interface CrawlButtonModeOption {
  /** The mode the option picks. */
  buttonMode: CrawlButtonModeRecord;
  /** The option's text. */
  label: string;
}

/** The "Buttons" picker's options, from the default (no buttons) to the broadest. */
const CRAWL_BUTTON_MODE_OPTIONS: readonly CrawlButtonModeOption[] = [
  { buttonMode: "linksOnly", label: "Links only (no buttons)" },
  { buttonMode: "allButRisky", label: "Buttons, except risky ones" },
  { buttonMode: "openOnly", label: "Only “Open” buttons" },
];

/** The theme colour each crawl severity is written in. */
const SEVERITY_TEXT_COLORS = {
  info: "info.main",
  success: "success.main",
  warning: "warning.main",
  error: "error.main",
} as const;

/** Props for `CrawlRunsSection`. */
export interface CrawlRunsSectionProps {
  /** The owning website's cuid, for the run page links. */
  websiteId: string;
  /** Every crawl run of the website, newest first (see `useCrawlRuns`). */
  runs: CrawlRunRecord[];
  /** True while the run list is loading. */
  isLoading: boolean;
  /** Why the run list could not be fetched, or null. */
  errorMessage: string | null;
  /** True while a "Crawl website" request is in flight. */
  isStartingCrawl: boolean;
  /** Why the last "Crawl website" request failed (e.g. a crawl is already running), or null. */
  startCrawlErrorMessage: string | null;
  /** Called when the user clicks "Crawl website". */
  onCrawlClick: () => void;
  /**
   * True when the "Crawl as" picker is shown: the website or one of its
   * credentials has a login page URL. False hides it, for a website that is
   * only ever crawled logged out.
   */
  crawlAsPickerIsShown: boolean;
  /** The website's credentials, offered in the "Crawl as" picker. */
  credentials: CredentialRecord[];
  /** The picked credential's id, or `CRAWL_LOGGED_OUT_VALUE` to crawl logged out. */
  selectedCredentialId: string;
  /** Called with the newly picked credential's id (or `CRAWL_LOGGED_OUT_VALUE`). */
  onSelectedCredentialChange: (credentialId: string) => void;
  /** Which buttons the next crawl clicks, as picked in the "Buttons" picker. */
  selectedButtonMode: CrawlButtonModeRecord;
  /** Called with the newly picked button mode. */
  onSelectedButtonModeChange: (buttonMode: CrawlButtonModeRecord) => void;
}

/**
 * The "Crawls" section of a website's page: what a crawl does, the "Crawl
 * as" picker (logged out, or logged in as one of the website's credentials;
 * hidden for a website without any login page URL), the "Buttons" picker
 * (links only, every button except risky ones, or only "Open" buttons), the
 * "Crawl website" button, and the "Crawl history" list, where each run says
 * who it crawled as - and which buttons it clicked, unless it followed links
 * only - and links to its own page (the page tree and each page's aria
 * snapshot).
 *
 * The button is disabled while a crawl of this website is already running, as
 * well as while the request to start one is in flight. The section has no
 * `role="status"` region: a run's outcome is shown on its own page.
 * @param props - The runs, the credentials and the picked one, the picked button mode, the request states, and the handlers
 * @returns The rendered section
 */
export default function CrawlRunsSection(props: CrawlRunsSectionProps): ReactElement {
  const {
    websiteId,
    runs,
    isLoading,
    errorMessage,
    isStartingCrawl,
    startCrawlErrorMessage,
    onCrawlClick,
    crawlAsPickerIsShown,
    credentials,
    selectedCredentialId,
    onSelectedCredentialChange,
    selectedButtonMode,
    onSelectedButtonModeChange,
  } = props;

  const aCrawlIsRunning = runs.some((run) => run.status === "running");
  const crawlButtonIsDisabled = isStartingCrawl || aCrawlIsRunning;
  const startCrawlFailed = startCrawlErrorMessage !== null;
  const runListLoadedWithoutError = !isLoading && errorMessage === null;
  const thereAreNoRuns = runs.length === 0;
  const thereAreRuns = !thereAreNoRuns;

  /**
   * Hands the picked "Crawl as" option to the page.
   * @param event - The picker's change event
   */
  const handleCrawlAsChange = (
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ): void => {
    onSelectedCredentialChange(event.target.value);
  };

  /**
   * Hands the picked "Buttons" option's mode to the page.
   * @param event - The picker's change event
   */
  const handleButtonModeChange = (
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ): void => {
    // Every option's value is a button mode, so the picked value is one too.
    onSelectedButtonModeChange(event.target.value as CrawlButtonModeRecord);
  };

  let crawlButtonText = "Crawl website";
  if (isStartingCrawl) {
    crawlButtonText = "Starting crawl…";
  } else if (aCrawlIsRunning) {
    crawlButtonText = "Crawl running…";
  }

  return (
    <Box component="section" aria-labelledby={HEADING_ID} sx={{ mt: 5 }}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        sx={{ justifyContent: "space-between", alignItems: { sm: "center" }, mb: 1 }}
      >
        <Typography id={HEADING_ID} variant="h5" component="h2">
          Crawls
        </Typography>
        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          sx={{ alignItems: "center", flexWrap: "wrap" }}
        >
          {crawlAsPickerIsShown && (
            <TextField
              select
              label="Crawl as"
              value={selectedCredentialId}
              onChange={handleCrawlAsChange}
              size="small"
              // The logged-out option's value is "", which MUI renders as an
              // empty field unless told to display it.
              slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
              sx={{ minWidth: 220 }}
            >
              <MenuItem value={CRAWL_LOGGED_OUT_VALUE}>Logged out (no credential)</MenuItem>
              {credentials.map((credential) => (
                <MenuItem key={credential.id} value={credential.id}>
                  {credential.name}
                </MenuItem>
              ))}
            </TextField>
          )}
          <TextField
            select
            label="Buttons"
            value={selectedButtonMode}
            onChange={handleButtonModeChange}
            size="small"
            slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
            sx={{ minWidth: 220 }}
          >
            {CRAWL_BUTTON_MODE_OPTIONS.map((option) => (
              <MenuItem key={option.buttonMode} value={option.buttonMode}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>
          <Button onClick={onCrawlClick} disabled={crawlButtonIsDisabled} variant="contained">
            {crawlButtonText}
          </Button>
        </Stack>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        A crawl starts at the website&apos;s URL and follows every link to another page on the
        same site, up to 50 pages or 10 minutes. With buttons on, it also clicks buttons and
        follows the ones that open another page on the site; risky ones (create, delete, update,
        log out, pay, confirm, ...) are never clicked. It records each page&apos;s aria snapshot
        and the page it was found on.
        {crawlAsPickerIsShown &&
          " Crawling as a credential logs in first, records nothing until the login works, and never follows logout links."}
      </Typography>

      {startCrawlFailed && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Could not start a crawl: {startCrawlErrorMessage}
        </Alert>
      )}
      <LoadStatusNotice
        isLoading={isLoading}
        errorMessage={errorMessage}
        loadingLabel="Loading crawl runs"
      />
      {runListLoadedWithoutError && thereAreNoRuns && (
        <Typography color="text.secondary">No crawls yet.</Typography>
      )}

      {thereAreRuns && (
        <>
          <Typography id={HISTORY_HEADING_ID} variant="subtitle1" component="h3" sx={{ mb: 1 }}>
            Crawl history
          </Typography>
          <Paper variant="outlined" sx={{ maxHeight: 320, overflow: "auto" }}>
            <List disablePadding aria-labelledby={HISTORY_HEADING_ID}>
              {runs.map((run) => (
                <ListItemButton
                  key={run.id}
                  component={RouterLink}
                  to={crawlRunDetailPath(websiteId, run.id)}
                  divider
                >
                  <ListItemText
                    primary={describeCrawlRunStatus(run)}
                    secondary={`${new Date(run.createdAt).toLocaleString()} · ${describeCrawlRunLogin(run)}${formatCrawlButtonModeSuffix(run.buttonMode)}`}
                    slotProps={{
                      primary: { sx: { color: SEVERITY_TEXT_COLORS[crawlRunSeverity(run.status)] } },
                    }}
                  />
                </ListItemButton>
              ))}
            </List>
          </Paper>
        </>
      )}
    </Box>
  );
}
