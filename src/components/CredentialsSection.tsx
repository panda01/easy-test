import { type ReactElement } from "react";
import { Link as RouterLink } from "react-router-dom";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import LinearProgress from "@mui/material/LinearProgress";
import Typography from "@mui/material/Typography";
import { AddIcon } from "./icons";
import LoadStatusNotice from "./LoadStatusNotice";
import { type CredentialRecord } from "../hooks/useCredentials";
import { type JsonResourceState } from "../hooks/useJsonResource";
import { type ReturnState } from "../hooks/useReturnNavigation";
import { nocturneTokens } from "../theme/nocturneTheme";
import { type LoginCheckRecord } from "../hooks/useWebsites";
import { ACTION_KIND } from "../utils/websiteItemKinds";
import { credentialEditPath, newCredentialPath, websiteItemDetailPath } from "../utils/routePaths";

/** The website's Login action, as the Credentials tab names it. */
export interface CredentialsLoginAction {
  /** The Login action's cuid. */
  id: string;
  /** Its title. */
  title: string;
  /** The page it logs in on (its own, or the website's), or null when neither has one. */
  loginUrl: string | null;
}

/** Props for `CredentialsSection`. */
export interface CredentialsSectionProps {
  /** The owning website's cuid. */
  websiteId: string;
  /** The credential list request, fetched by the page so the crawl section can offer the same credentials. */
  credentialsResource: JsonResourceState<CredentialRecord[]>;
  /** History state for the links, so the opened form can return here cleanly. */
  returnToHereState: ReturnState;
  /** The website's Login action, or null when it has none (or the action list has not loaded). */
  loginAction: CredentialsLoginAction | null;
  /** True once the action list has loaded, so "no Login action" is known rather than not yet read. */
  loginActionIsKnown: boolean;
  /** True right after website create found a login form, to say so. */
  loginFormWasJustFound: boolean;
  /** True while a "Look for a login form" request is in flight. */
  isCheckingForLoginForm: boolean;
  /** Why the last "Look for a login form" request failed, or null. */
  loginCheckErrorMessage: string | null;
  /** What the last "Look for a login form" found, or null before one is made. */
  lastLoginCheck: LoginCheckRecord | null;
  /** Called when the user clicks "Look for a login form". */
  onLookForLoginForm: () => void;
}

/**
 * Words what a "Look for a login form" that made no Login action found.
 * @param loginCheck - The check's result
 * @returns The sentence, or null when the check made the Login action (nothing to say)
 */
export function describeLoginCheckWithoutLoginAction(loginCheck: LoginCheckRecord): string | null {
  if (loginCheck.outcome === "notFound") {
    return "No login form was found on the website's page or behind a “Log in” / “Sign in” link. If it logs in some other way (in a pop-up, or with single sign-on), add an action with the kind Login.";
  }
  if (loginCheck.outcome === "failed") {
    return `Could not look for a login form: ${loginCheck.message ?? "no reason was given"}`;
  }
  return null;
}

/**
 * Words the alert that asks for credentials: the website has its Login
 * action but no account to log in as.
 * @param loginAction - The website's Login action
 * @param loginFormWasJustFound - True right after website create found the form
 * @returns The sentence
 */
export function describeCredentialsNeeded(loginAction: CredentialsLoginAction, loginFormWasJustFound: boolean): string {
  const loginPageText = loginAction.loginUrl ?? "its login page";
  const whatHappened = loginFormWasJustFound
    ? `Found a login form at ${loginPageText}, and added the login action “${loginAction.title}”.`
    : `This website logs in at ${loginPageText} with the login action “${loginAction.title}”.`;
  return `${whatHappened} Add the accounts your actions should log in as.`;
}

/**
 * Words the second line of a credential's row: its username, then its
 * description when it has one.
 * @param credential - The credential to describe
 * @returns e.g. "admin@example.com · The site's admin account"
 */
function describeCredentialRow(credential: CredentialRecord): string {
  const { username, description } = credential;
  const credentialHasDescription = description !== null;
  return credentialHasDescription ? `${username} · ${description}` : username;
}

/**
 * The "Credentials" tab of a website's page: how the website logs in, a
 * "New credential" button with a plus, and the website's credentials (name,
 * then username and description), each linking to its edit page - or an
 * empty-state line when there are none. Passwords are never shown: the
 * server never sends them. The tab names the section, so it has no heading
 * of its own.
 *
 * How the website logs in, above the list:
 * - no Login action: "No login form found on this website yet" with
 *   **Look for a login form** (a progress bar while it looks, and what it
 *   found when it made no Login action);
 * - a Login action but no credentials: an alert asking for them (saying the
 *   form was just found, right after website create), with **Add
 *   credential**;
 * - a Login action and credentials: one line naming the Login action (a
 *   link to it) and its login page.
 * @param props - The owning website, the list request, the link state, the Login action, and the login-form check's state and handler
 * @returns The rendered tab content
 */
export default function CredentialsSection(props: CredentialsSectionProps): ReactElement {
  const {
    websiteId,
    credentialsResource,
    returnToHereState,
    loginAction,
    loginActionIsKnown,
    loginFormWasJustFound,
    isCheckingForLoginForm,
    loginCheckErrorMessage,
    lastLoginCheck,
    onLookForLoginForm,
  } = props;
  const credentials = credentialsResource.data;
  const websiteHasNoLoginAction = loginActionIsKnown && loginAction === null;
  const credentialsHaveLoaded = credentials !== null;
  const credentialsAreNeeded = loginAction !== null && credentialsHaveLoaded && credentials.length === 0;
  const loginActionIsInUse = loginAction !== null && credentialsHaveLoaded && credentials.length > 0;
  const lastLoginCheckText = lastLoginCheck === null ? null : describeLoginCheckWithoutLoginAction(lastLoginCheck);
  const loginCheckRequestFailed = loginCheckErrorMessage !== null;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {websiteHasNoLoginAction && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
            <Typography sx={{ fontSize: 13.5, mr: "auto" }}>No login form found on this website yet.</Typography>
            <Button
              variant="outlined"
              color="secondary"
              onClick={onLookForLoginForm}
              disabled={isCheckingForLoginForm}
              sx={{ flex: "none" }}
            >
              {isCheckingForLoginForm ? "Looking for a login form…" : "Look for a login form"}
            </Button>
          </Box>
          {isCheckingForLoginForm && <LinearProgress aria-label="Looking for a login form" />}
          {lastLoginCheckText !== null && (
            <Alert severity={lastLoginCheck?.outcome === "failed" ? "error" : "info"}>{lastLoginCheckText}</Alert>
          )}
          {loginCheckRequestFailed && <Alert severity="error">{loginCheckErrorMessage}</Alert>}
        </Box>
      )}

      {credentialsAreNeeded && (
        <Alert
          severity="info"
          action={
            <Button
              component={RouterLink}
              to={newCredentialPath(websiteId)}
              state={returnToHereState}
              color="inherit"
              size="small"
              startIcon={<AddIcon />}
            >
              Add credential
            </Button>
          }
        >
          {describeCredentialsNeeded(loginAction, loginFormWasJustFound)}
        </Alert>
      )}

      {loginActionIsInUse && (
        <Typography sx={{ fontSize: 12.5, color: nocturneTokens.neutral[400] }}>
          Logs in with the login action{" "}
          <Box
            component={RouterLink}
            to={websiteItemDetailPath(ACTION_KIND, websiteId, loginAction.id)}
            state={returnToHereState}
            sx={{ color: nocturneTokens.accentRamp[300] }}
          >
            {loginAction.title}
          </Box>
          {loginAction.loginUrl === null ? " (it has no login page yet)" : ` at ${loginAction.loginUrl}`}
        </Typography>
      )}

      <Box sx={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <Typography sx={{ fontSize: 12, color: nocturneTokens.neutral[400], mr: "auto" }}>
          Accounts for this website. Pick one as an action&apos;s &ldquo;Log in as&rdquo; or under Crawls to run logged in; the website&apos;s login action types its username and password.
        </Typography>
        <Button
          component={RouterLink}
          to={newCredentialPath(websiteId)}
          state={returnToHereState}
          variant="outlined"
          color="secondary"
          startIcon={<AddIcon />}
          sx={{ flex: "none" }}
        >
          New credential
        </Button>
      </Box>

      <LoadStatusNotice
        isLoading={credentialsResource.isLoading}
        errorMessage={credentialsResource.errorMessage}
        loadingLabel="Loading credentials"
      />

      {credentials !== null && credentials.length === 0 && (
        <Typography color="text.secondary" sx={{ fontSize: 13.5 }}>
          No credentials yet.
        </Typography>
      )}

      {credentials !== null && credentials.length > 0 && (
        <Box component="ul" aria-label="Credentials" sx={{ m: 0, p: 0 }}>
          {credentials.map((credential) => (
            <Box component="li" key={credential.id} sx={{ listStyle: "none" }}>
              <Box
                component={RouterLink}
                to={credentialEditPath(websiteId, credential.id)}
                state={returnToHereState}
                sx={{
                  display: "block",
                  py: "9px",
                  color: "inherit",
                  textDecoration: "none",
                  borderBottom: `1px solid ${nocturneTokens.rowRule}`,
                  "&:hover": { color: nocturneTokens.accentRamp[300] },
                }}
              >
                <Box component="span" sx={{ display: "block", fontSize: 13.5, fontWeight: 500 }}>
                  {credential.name}
                </Box>
                <Box
                  component="span"
                  sx={{
                    display: "block",
                    fontSize: 12,
                    color: nocturneTokens.neutral[400],
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {describeCredentialRow(credential)}
                </Box>
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
