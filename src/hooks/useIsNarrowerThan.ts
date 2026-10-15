import useMediaQuery from "@mui/material/useMediaQuery";
import { type Breakpoint, useTheme } from "@mui/material/styles";

/**
 * Tells whether the window is narrower than one of the theme's breakpoints,
 * for the screens whose STRUCTURE changes on a phone (tabs instead of a side
 * panel, a select instead of a list) rather than just their spacing.
 *
 * Read synchronously (`noSsr`), so the first render already has the right
 * layout instead of flashing the desktop one. Where `matchMedia` does not
 * exist (jsdom in the unit tests) it reports false: the desktop layout.
 * @param breakpoint - The breakpoint to compare with, e.g. "md" (900 px) or "lg" (1200 px)
 * @returns True when the window is narrower than the breakpoint
 */
export function useIsNarrowerThan(breakpoint: Breakpoint): boolean {
  const theme = useTheme();
  return useMediaQuery(theme.breakpoints.down(breakpoint), { noSsr: true });
}
