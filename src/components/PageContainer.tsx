import { type ReactElement, type ReactNode } from "react";
import Box from "@mui/material/Box";

/** Props for `PageContainer`. */
export interface PageContainerProps {
  /** The page. */
  children: ReactNode;
  /** The widest the content may grow, in px; omit to fill the window. */
  maxWidth?: number;
}

/**
 * The frame of each redesigned screen: 28 px gutters on desktop and 18 px on
 * a phone, as the mockups do. A frame capped by `maxWidth` is centered in the
 * window, with the whitespace split evenly on both sides; an uncapped frame
 * fills the window, so the centering changes nothing for it.
 * @param props - The page and its widest width
 * @returns The page in its frame
 */
export default function PageContainer(props: PageContainerProps): ReactElement {
  const { children, maxWidth } = props;
  return (
    <Box
      component="main"
      sx={{
        px: { xs: "18px", md: "28px" },
        pt: { xs: "18px", md: "24px" },
        pb: { xs: "28px", md: "40px" },
        // Centers a capped frame; an uncapped one is already full width.
        mx: "auto",
        maxWidth,
        minWidth: 0,
      }}
    >
      {children}
    </Box>
  );
}
