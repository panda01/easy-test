import { type ReactElement } from "react";
import { Link as RouterLink } from "react-router-dom";
import AppBar from "@mui/material/AppBar";
import Button from "@mui/material/Button";
import Link from "@mui/material/Link";
import Toolbar from "@mui/material/Toolbar";
import { WEBSITE_LIST_PATH } from "../utils/routePaths";

/**
 * The bar across the top of every page: the app name (links home) and a
 * Websites link. Rendered once in `App.tsx`, outside `<Routes>`, so it never
 * remounts while navigating.
 * @returns The application header
 */
export default function AppHeader(): ReactElement {
  return (
    <AppBar position="static" color="default" elevation={0}>
      <Toolbar>
        <Link
          component={RouterLink}
          to="/"
          variant="h6"
          color="inherit"
          underline="none"
          sx={{ flexGrow: 1 }}
        >
          easy-test
        </Link>
        <Button component={RouterLink} to={WEBSITE_LIST_PATH} color="inherit">
          Websites
        </Button>
      </Toolbar>
    </AppBar>
  );
}
