import { type ReactElement } from "react";
import { Link as RouterLink } from "react-router-dom";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import LoadStatusNotice from "./LoadStatusNotice";
import { type CredentialRecord } from "../hooks/useCredentials";
import { type JsonResourceState } from "../hooks/useJsonResource";
import { type ReturnState } from "../hooks/useReturnNavigation";
import { credentialEditPath, newCredentialPath } from "../utils/routePaths";

const HEADING_ID = "credentials-section-heading";

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
 * The "Credentials" section of a website's page: a heading, a "New
 * credential" button, and the website's credentials (name, then username and
 * description), each linking to its edit page - or an empty-state line when
 * there are none. Passwords are never shown: the server never sends them.
 * @param props - The owning website, the list request, and the link state
 * @returns The rendered section
 */
export default function CredentialsSection(props: CredentialsSectionProps): ReactElement {
  const { websiteId, credentialsResource, returnToHereState } = props;
  const credentials = credentialsResource.data;

  return (
    <Box component="section" aria-labelledby={HEADING_ID} sx={{ mt: 5 }}>
      <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center", mb: 1 }}>
        <Typography id={HEADING_ID} variant="h5" component="h2">
          Credentials
        </Typography>
        <Button
          component={RouterLink}
          to={newCredentialPath(websiteId)}
          state={returnToHereState}
          variant="outlined"
        >
          New credential
        </Button>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Logins for this website. Pick one under Crawls to crawl the site logged in.
      </Typography>

      <LoadStatusNotice
        isLoading={credentialsResource.isLoading}
        errorMessage={credentialsResource.errorMessage}
        loadingLabel="Loading credentials"
      />

      {credentials !== null && credentials.length === 0 && (
        <Typography color="text.secondary">No credentials yet.</Typography>
      )}

      {credentials !== null && credentials.length > 0 && (
        <Paper variant="outlined">
          <List disablePadding aria-label="Credentials">
            {credentials.map((credential) => (
              <ListItemButton
                key={credential.id}
                component={RouterLink}
                to={credentialEditPath(websiteId, credential.id)}
                state={returnToHereState}
                divider
              >
                <ListItemText
                  primary={credential.name}
                  secondary={describeCredentialRow(credential)}
                  slotProps={{ secondary: { noWrap: true } }}
                />
              </ListItemButton>
            ))}
          </List>
        </Paper>
      )}
    </Box>
  );
}
