import { type ReactElement } from "react";
import { Link as RouterLink } from "react-router-dom";
import Button from "@mui/material/Button";
import Container from "@mui/material/Container";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import LoadStatusNotice from "../components/LoadStatusNotice";
import PageBreadcrumbs from "../components/PageBreadcrumbs";
import { useReturnToHereState } from "../hooks/useReturnNavigation";
import { useWebsites } from "../hooks/useWebsites";
import { NEW_WEBSITE_PATH, websiteDetailPath } from "../utils/routePaths";

/**
 * The website list (`/websites`): every active website, newest first, each
 * linking to its detail page, plus a "New website" button. The list is
 * fetched on every mount, so coming Back here after a create, edit, or delete
 * shows the current data.
 * @returns The rendered website list page
 */
export default function WebsiteListPage(): ReactElement {
  const { data: websites, isLoading, errorMessage } = useWebsites();
  const returnToHereState = useReturnToHereState();

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <PageBreadcrumbs crumbs={[{ label: "Websites" }]} />

      <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center", mb: 3 }}>
        <Typography variant="h4" component="h1">
          Websites
        </Typography>
        <Button
          component={RouterLink}
          to={NEW_WEBSITE_PATH}
          state={returnToHereState}
          variant="contained"
        >
          New website
        </Button>
      </Stack>

      <LoadStatusNotice
        isLoading={isLoading}
        errorMessage={errorMessage}
        loadingLabel="Loading websites"
      />

      {websites !== null && websites.length === 0 && (
        <Typography color="text.secondary">
          No websites yet. Add one to start describing what to test.
        </Typography>
      )}

      {websites !== null && websites.length > 0 && (
        <Paper variant="outlined">
          <List disablePadding aria-label="Websites">
            {websites.map((website) => (
              <ListItemButton
                key={website.id}
                component={RouterLink}
                to={websiteDetailPath(website.id)}
                state={returnToHereState}
                divider
              >
                <ListItemText primary={website.name} secondary={website.url} />
              </ListItemButton>
            ))}
          </List>
        </Paper>
      )}
    </Container>
  );
}
