import { type ReactElement } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import LinearProgress from "@mui/material/LinearProgress";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import CodeBlock from "./CodeBlock";
import ExpandableScreenshot from "./ExpandableScreenshot";
import LoadStatusNotice from "./LoadStatusNotice";
import StatusDot from "./StatusDot";
import { type CredentialOption } from "./TitleDescriptionForm";
import { type LoginRunRecord } from "../hooks/useLoginRuns";
import { nocturneTokens, runStatusColors } from "../theme/nocturneTheme";
import { formatElapsed, formatFullDateTime, formatRelativeTime } from "../utils/formatRelativeTime";
import { loginRunScreenshotApiUrl } from "../utils/routePaths";

const LATEST_LOGIN_RUN_HEADING_ID = "latest-login-run-heading";
const LOGIN_RUN_HISTORY_HEADING_ID = "login-run-history-heading";

/** Props for `LoginActionSection`. */
export interface LoginActionSectionProps {
  /** The owning website's cuid, for the screenshot urls. */
  websiteId: string;
  /** The Login action's cuid, for the screenshot urls. */
  actionId: string;
  /** The Login action's login runs, newest first, or null until they have loaded. */
  runs: LoginRunRecord[] | null;
  /** True while the run list is loading. */
  isLoading: boolean;
  /** Why the run list could not be fetched, or null. */
  errorMessage: string | null;
  /**
   * Why "Run login" cannot run right now (e.g. the website has no
   * credential), shown beside the disabled button; null when it can.
   */
  runBlockedReason: string | null;
  /** The website's credentials, offered in the "Log in as" select. */
  credentials: CredentialOption[];
  /** The credential "Run login" logs in as, or null when none can be picked. */
  selectedCredentialId: string | null;
  /** Called with the cuid of the credential picked in "Log in as". */
  onSelectedCredentialChange: (credentialId: string) => void;
  /** True while a "Run login" request is in flight. */
  isRunning: boolean;
  /** Why the last "Run login" request failed (not a failed login - that is a recorded run), or null. */
  runErrorMessage: string | null;
  /** Called when the user clicks "Run login". */
  onRunLogin: () => void;
  /** The current moment, for how long ago each run was. */
  now: Date;
}

/**
 * Words how one login run went, for its line in the history.
 * @param run - The login run
 * @returns "Logged in" or "Login failed"
 */
export function describeLoginRunOutcome(run: LoginRunRecord): string {
  return run.succeeded ? "Logged in" : "Login failed";
}

/**
 * The body of the Login action's page, in place of the versions, steps, and
 * runs every other action has (the Login action has no steps - it logs in
 * with the built-in login routine):
 * - "Log in as": which of the website's credentials "Run login" logs in as;
 * - "Run login": logs in once, on its own, to test the Login action (a
 *   browser on the server's machine opens the login page and types the
 *   picked credential's username and password). Disabled - with the reason -
 *   while it cannot run, and while a run is in flight, when a progress bar
 *   shows;
 * - the latest run: whether it logged in, as whom and where, when, how long
 *   it took, its error, its screenshot (opens full screen), and its log;
 * - the history of the older runs, each with a dot, the outcome, and when.
 * @param props - The runs, the request states, the run handler, and the current time
 * @returns The rendered section
 */
export default function LoginActionSection(props: LoginActionSectionProps): ReactElement {
  const {
    websiteId,
    actionId,
    runs,
    isLoading,
    errorMessage,
    runBlockedReason,
    credentials,
    selectedCredentialId,
    onSelectedCredentialChange,
    isRunning,
    runErrorMessage,
    onRunLogin,
    now,
  } = props;
  const latestRun = runs?.at(0) ?? null;
  const olderRuns = runs?.slice(1) ?? [];
  const runIsBlocked = runBlockedReason !== null;
  const runButtonIsDisabled = runIsBlocked || isRunning;
  const runRequestFailed = runErrorMessage !== null;
  const runsHaveLoaded = runs !== null;
  const noRunHasBeenMade = runsHaveLoaded && latestRun === null;
  const credentialSelectIsShown = credentials.length > 0 && selectedCredentialId !== null;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2, maxWidth: 760 }}>
      <Typography sx={{ fontSize: 13, color: nocturneTokens.neutral[400] }}>
        The login action has no steps: it opens its login page, finds the username and password fields and the
        sign-in button on its own, types a credential&apos;s username and password, and submits. Actions and
        crawls that log in as a credential go through it before they start.
      </Typography>
      <Box sx={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
        {credentialSelectIsShown && (
          <TextField
            select
            size="small"
            label="Log in as"
            value={selectedCredentialId}
            onChange={(event) => {
              onSelectedCredentialChange(event.target.value);
            }}
            disabled={isRunning}
            sx={{ minWidth: 220 }}
          >
            {credentials.map((credential) => (
              <MenuItem key={credential.id} value={credential.id}>
                {credential.name}
              </MenuItem>
            ))}
          </TextField>
        )}
        <Button variant="contained" onClick={onRunLogin} disabled={runButtonIsDisabled}>
          {isRunning ? "Logging in…" : "Run login"}
        </Button>
        {runIsBlocked && (
          <Typography component="span" sx={{ fontSize: 12.5, color: nocturneTokens.neutral[400] }}>
            {runBlockedReason}
          </Typography>
        )}
      </Box>
      {isRunning && <LinearProgress aria-label="Logging in" />}
      {runRequestFailed && <Alert severity="error">{runErrorMessage}</Alert>}

      <LoadStatusNotice isLoading={isLoading} errorMessage={errorMessage} loadingLabel="Loading login runs" />

      {noRunHasBeenMade && (
        <Typography sx={{ fontSize: 13, color: nocturneTokens.neutral[400] }}>
          Not run yet. Run the login to check it works.
        </Typography>
      )}

      {latestRun !== null && (
        <Box component="section" aria-labelledby={LATEST_LOGIN_RUN_HEADING_ID} sx={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <Typography variant="h3" component="h2" id={LATEST_LOGIN_RUN_HEADING_ID}>
            Latest run
          </Typography>
          <Alert severity={latestRun.succeeded ? "success" : "error"}>
            {latestRun.succeeded
              ? `Logged in as “${latestRun.credentialName}”`
              : `Could not log in as “${latestRun.credentialName}”: ${latestRun.errorMessage ?? "no reason was given"}`}
          </Alert>
          <Typography sx={{ fontSize: 12.5, color: nocturneTokens.neutral[400] }}>
            <Box component="span" title={formatFullDateTime(latestRun.createdAt)}>
              {formatRelativeTime(latestRun.createdAt, now)}
            </Box>
            {` · took ${formatElapsed(latestRun.durationMs)} · login page ${latestRun.loginUrl}`}
            {latestRun.finalPageUrl !== null && ` · ended on ${latestRun.finalPageUrl}`}
          </Typography>
          {latestRun.screenshotFileName !== null && (
            <ExpandableScreenshot
              src={loginRunScreenshotApiUrl(websiteId, actionId, latestRun.id)}
              alt={latestRun.succeeded ? "The page after logging in" : "What the page showed when the login failed"}
              buttonSx={{ maxWidth: 520 }}
            />
          )}
          <CodeBlock code={latestRun.output} label="Login run log" />
        </Box>
      )}

      {olderRuns.length > 0 && (
        <Box component="section" aria-labelledby={LOGIN_RUN_HISTORY_HEADING_ID}>
          <Typography variant="h3" component="h2" id={LOGIN_RUN_HISTORY_HEADING_ID} sx={{ mb: "8px" }}>
            History
          </Typography>
          <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
            {olderRuns.map((run) => (
              <Box component="li" key={run.id} sx={{ display: "flex", alignItems: "center", gap: "8px", fontSize: 13 }}>
                <StatusDot color={run.succeeded ? runStatusColors.passed : runStatusColors.failed} />
                <span>{describeLoginRunOutcome(run)}</span>
                <Box component="span" title={formatFullDateTime(run.createdAt)} sx={{ color: nocturneTokens.neutral[400] }}>
                  {formatRelativeTime(run.createdAt, now)}
                </Box>
                {run.errorMessage !== null && (
                  <Box component="span" sx={{ color: nocturneTokens.neutral[400], minWidth: 0, overflowWrap: "anywhere" }}>
                    — {run.errorMessage}
                  </Box>
                )}
              </Box>
            ))}
          </Box>
        </Box>
      )}
    </Box>
  );
}
