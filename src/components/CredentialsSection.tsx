import { type ReactElement } from "react";
import { Link as RouterLink } from "react-router-dom";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import { AddIcon } from "./icons";
import LoadStatusNotice from "./LoadStatusNotice";
import { type CredentialRecord } from "../hooks/useCredentials";
import { type JsonResourceState } from "../hooks/useJsonResource";
import { type ReturnState } from "../hooks/useReturnNavigation";
import { nocturneTokens } from "../theme/nocturneTheme";
import { credentialEditPath, newCredentialPath } from "../utils/routePaths";

/** Props for `CredentialsSection`. */
export interface CredentialsSectionProps {
  /** The owning website's cuid. */
  websiteId: string;
  /** The credential list request, fetched by the page so the crawl section can offer the same credentials. */
  credentialsResource: JsonResourceState<CredentialRecord[]>;
  /** History state for the links, so the opened form can return here cleanly. */
  returnToHereState: ReturnState;
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
 * The "Credentials" tab of a website's page: a "New credential" button with
 * a plus and the website's credentials (name, then username and description), each
 * linking to its edit page - or an empty-state line when there are none.
 * Passwords are never shown: the server never sends them. The tab names the
 * section, so it has no heading of its own.
 * @param props - The owning website, the list request, and the link state
 * @returns The rendered tab content
 */
export default function CredentialsSection(props: CredentialsSectionProps): ReactElement {
  const { websiteId, credentialsResource, returnToHereState } = props;
  const credentials = credentialsResource.data;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <Typography sx={{ fontSize: 12, color: nocturneTokens.neutral[400], mr: "auto" }}>
          Logins for this website. Pick one under Crawls to crawl the site logged in.
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
