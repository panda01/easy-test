import { type ReactElement } from "react";
import { Link as RouterLink, useLocation } from "react-router-dom";
import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import { CheckIcon } from "./icons";
import { nocturneTokens } from "../theme/nocturneTheme";
import { WEBSITE_LIST_PATH } from "../utils/routePaths";

/**
 * The bar across the top of every page: the Easy Test mark and name (links
 * to the dashboard) and a "Websites" link, which is marked as the current page
 * while the dashboard is open. Rendered once in `App.tsx`, outside
 * `<Routes>`, so it never remounts while navigating.
 * @returns The application header
 */
export default function AppHeader(): ReactElement {
  const { pathname } = useLocation();
  const dashboardIsOpen = pathname === WEBSITE_LIST_PATH;

  return (
    <Box
      component="header"
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 3,
        px: { xs: "18px", md: "28px" },
        py: "14px",
        borderBottom: `1px solid ${nocturneTokens.divider}`,
      }}
    >
      <Link
        component={RouterLink}
        to="/"
        color="inherit"
        underline="none"
        sx={{ display: "flex", alignItems: "center", gap: "10px", mr: "auto", "&:hover": { color: "inherit" } }}
      >
        <Box
          aria-hidden="true"
          sx={{
            width: 22,
            height: 22,
            borderRadius: "6px",
            border: `1.5px solid ${nocturneTokens.accent}`,
            display: "grid",
            placeItems: "center",
          }}
        >
          <CheckIcon sx={{ fontSize: 15, color: nocturneTokens.accent }} />
        </Box>
        <Box component="span" sx={{ fontSize: 16, fontWeight: 500 }}>
          Easy Test
        </Box>
      </Link>
      <Link
        component={RouterLink}
        to={WEBSITE_LIST_PATH}
        underline="none"
        aria-current={dashboardIsOpen ? "page" : undefined}
        sx={{ fontSize: 14, py: "10px" }}
      >
        Websites
      </Link>
    </Box>
  );
}
