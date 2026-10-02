import { type ReactElement } from "react";
import { Link as RouterLink } from "react-router-dom";
import Breadcrumbs from "@mui/material/Breadcrumbs";
import Link from "@mui/material/Link";
import Typography from "@mui/material/Typography";

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
 * The "Websites › Example › Log in" trail at the top of each page, so the
 * page's place in the hierarchy is always visible and each level is one click
 * away.
 * @param props - The breadcrumb trail
 * @returns The rendered breadcrumb trail
 */
export default function PageBreadcrumbs(props: PageBreadcrumbsProps): ReactElement {
  const { crumbs } = props;

  return (
    <Breadcrumbs aria-label="Breadcrumb" sx={{ mb: 3 }}>
      {crumbs.map((crumb, crumbIndex) => {
        const crumbKey = `${String(crumbIndex)}-${crumb.label}`;
        if (crumb.to === undefined) {
          return (
            <Typography key={crumbKey} color="text.primary">
              {crumb.label}
            </Typography>
          );
        }
        return (
          <Link key={crumbKey} component={RouterLink} to={crumb.to} underline="hover" color="inherit">
            {crumb.label}
          </Link>
        );
      })}
    </Breadcrumbs>
  );
}
