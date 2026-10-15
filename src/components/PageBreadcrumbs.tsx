import { type ReactElement } from "react";
import { Link as RouterLink } from "react-router-dom";
import Box from "@mui/material/Box";
import Breadcrumbs from "@mui/material/Breadcrumbs";
import Link from "@mui/material/Link";
import { ChevronLeftIcon } from "./icons";
import { useIsNarrowerThan } from "../hooks/useIsNarrowerThan";
import { nocturneTokens } from "../theme/nocturneTheme";

/** One step in the breadcrumb trail. */
export interface BreadcrumbItem {
  /** The text shown for this step. */
  label: string;
  /** Where the step links to; omit for the current page, which is plain text. */
  to?: string;
}

/** Props for `PageBreadcrumbs`. */
export interface PageBreadcrumbsProps {
  /** The trail from the top level down to the current page, in order. */
  crumbs: BreadcrumbItem[];
}

/**
 * Finds the nearest level above the current page: the last crumb that links
 * somewhere.
 * @param crumbs - The trail, top level first
 * @returns The parent crumb, or undefined when no crumb links anywhere
 */
function findParentCrumb(crumbs: BreadcrumbItem[]): BreadcrumbItem | undefined {
  for (let crumbIndex = crumbs.length - 1; crumbIndex >= 0; crumbIndex -= 1) {
    const crumb = crumbs[crumbIndex];
    const crumbLinksSomewhere = crumb.to !== undefined;
    if (crumbLinksSomewhere) {
      return crumb;
    }
  }
  return undefined;
}

/**
 * The "Websites / Example / Log in" trail at the top of each page, so the
 * page's place in the hierarchy is always visible and each level is one click
 * away. On a phone it shrinks to one back link to the level above
 * ("‹ Example"), as the mobile mockups do.
 * @param props - The breadcrumb trail
 * @returns The rendered breadcrumb trail, or null on a phone when nothing links anywhere
 */
export default function PageBreadcrumbs(props: PageBreadcrumbsProps): ReactElement | null {
  const { crumbs } = props;
  const isPhoneLayout = useIsNarrowerThan("md");

  if (isPhoneLayout) {
    const parentCrumb = findParentCrumb(crumbs);
    if (parentCrumb?.to === undefined) return null;
    return (
      <Box component="nav" aria-label="Breadcrumb">
        <Link
          component={RouterLink}
          to={parentCrumb.to}
          underline="none"
          sx={{ fontSize: 13, display: "inline-flex", alignItems: "center", gap: "4px", minHeight: 32 }}
        >
          <ChevronLeftIcon aria-hidden="true" sx={{ fontSize: 16 }} />
          {parentCrumb.label}
        </Link>
      </Box>
    );
  }

  return (
    <Breadcrumbs
      aria-label="Breadcrumb"
      separator="/"
      sx={{
        mb: "14px",
        fontSize: 13,
        color: nocturneTokens.neutral[400],
        "& .MuiBreadcrumbs-separator": { mx: 1 },
      }}
    >
      {crumbs.map((crumb, crumbIndex) => {
        const crumbKey = `${String(crumbIndex)}-${crumb.label}`;
        if (crumb.to === undefined) {
          return (
            <Box key={crumbKey} component="span" sx={{ color: "text.primary" }}>
              {crumb.label}
            </Box>
          );
        }
        return (
          <Link key={crumbKey} component={RouterLink} to={crumb.to} underline="none">
            {crumb.label}
          </Link>
        );
      })}
    </Breadcrumbs>
  );
}
