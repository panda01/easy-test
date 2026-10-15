import { alpha, createTheme, type Theme } from "@mui/material/styles";

/**
 * The Nocturne design system's tokens (from its `styles.css`): a dark
 * blue-grey ground, one blurple accent, and tonal ramps on a shared
 * lightness scale. Every color the app paints comes from here or from
 * `statusColors`, never from a hex written in a component.
 */
export const nocturneTokens = {
  background: "#161826",
  surface: "#232532",
  text: "#e9e9ed",
  accent: "#9184d9",
  divider: alpha("#e9e9ed", 0.16),
  /** A row rule lighter than `divider`, for the lines between list rows. */
  rowRule: alpha("#e9e9ed", 0.06),
  neutral: {
    100: "#f3f5fe",
    200: "#e4e7f5",
    300: "#cfd3e5",
    400: "#b2b6ca",
    500: "#9397ab",
    600: "#75798c",
    700: "#595d6c",
    800: "#3f424d",
    900: "#292b31",
  },
  accentRamp: {
    100: "#f5f4ff",
    200: "#e7e5fe",
    300: "#d2cefd",
    400: "#b5abfc",
    500: "#968ae0",
    600: "#796cbf",
    700: "#5d5294",
    800: "#423a6a",
    900: "#2b2741",
  },
  radius: { small: 4, medium: 8, large: 14 },
  shadow: {
    small: "0 0 0 1px #3f424d",
    medium: "0 0 0 1px #595d6c, 0 6px 18px rgba(0,0,0,0.55)",
    large: "0 0 0 1px #9397ab, 0 16px 40px rgba(0,0,0,0.65)",
  },
} as const;

/**
 * The one status language the mockups use everywhere (passed, failed, not
 * run, running, out of date), plus the tints its banners, tags, and failed
 * step use. The mockups write these in OKLCH; they are converted to hex once
 * here so MUI's color helpers (which cannot parse OKLCH) can work with them.
 */
export const statusColors = {
  passed: "#6dc88f",
  failed: "#f07f77",
  notRun: nocturneTokens.neutral[500],
  running: nocturneTokens.accent,
  stale: "#e3b667",
  staleTagBackground: "#4e3914",
  staleTagText: "#f7e2b8",
  passedBannerBackground: "#152c1e",
  passedBannerText: "#c5e8d0",
  failedBannerBackground: "#381e1c",
  failedBannerText: "#fed2cd",
  staleBannerBackground: "#31240e",
  staleBannerText: "#f0dbb9",
  failedStepBackground: "#311b19",
  failedStepRing: "#803f3b",
  failedStepNote: "#f8a49d",
  loggedInTagBackground: "#173523",
  loggedInTagText: "#c6f1d3",
  httpOk: "#88d1a2",
} as const;

/**
 * The color each script run status (`ScriptRunStatus`) is drawn in: its
 * icon, its label, and its segment of a status bar.
 */
export const runStatusColors = {
  passed: statusColors.passed,
  failed: statusColors.failed,
  notRun: statusColors.notRun,
} as const;

/**
 * The color each crawl severity (`CrawlRunSeverity`) is drawn in: a running
 * crawl in the accent, a finished one green, one stopped at a limit amber,
 * and a failed one red.
 */
export const crawlSeverityColors = {
  info: statusColors.running,
  success: statusColors.passed,
  warning: statusColors.stale,
  error: statusColors.failed,
} as const;

/** The monospace stack the mockups set URLs, paths, and step numbers in. */
export const MONOSPACE_FONT_FAMILY = "ui-monospace, Menlo, monospace";

/** Nocturne's heading treatment: medium weight, tight leading, slightly negative tracking. */
const HEADING_STYLE = { fontWeight: 500, lineHeight: 1.12, letterSpacing: "-0.015em" } as const;

/** The 2px accent ring every focusable control shows for keyboard focus. */
const FOCUS_RING = { outline: `2px solid ${nocturneTokens.accent}`, outlineOffset: 2 } as const;

/**
 * The application's MUI theme, built from Nocturne: dark only, Inter at
 * medium weight for headings, 8px radii, and buttons that are outlines rather
 * than fills.
 *
 * Buttons map the design system's three kinds onto MUI variants:
 * - `contained` and `outlined` + `primary` are Nocturne's primary button: an
 *   accent outline on a transparent ground. `contained` is restyled the same
 *   way, so the screens the redesign did not touch match without edits.
 * - `outlined` + `secondary` is the secondary button: a divider outline in the
 *   text color.
 * - `text` is the ghost button: accent text, no outline.
 */
export const nocturneTheme: Theme = createTheme({
  palette: {
    mode: "dark",
    primary: {
      main: nocturneTokens.accent,
      light: nocturneTokens.accentRamp[400],
      dark: nocturneTokens.accentRamp[600],
      contrastText: nocturneTokens.background,
    },
    secondary: { main: nocturneTokens.text, contrastText: nocturneTokens.background },
    success: { main: statusColors.passed, contrastText: nocturneTokens.background },
    error: { main: statusColors.failed, contrastText: nocturneTokens.background },
    warning: { main: statusColors.stale, contrastText: nocturneTokens.background },
    info: { main: nocturneTokens.accent, contrastText: nocturneTokens.background },
    background: { default: nocturneTokens.background, paper: nocturneTokens.surface },
    text: {
      primary: nocturneTokens.text,
      secondary: nocturneTokens.neutral[400],
      disabled: nocturneTokens.neutral[600],
    },
    divider: nocturneTokens.divider,
  },
  shape: { borderRadius: nocturneTokens.radius.medium },
  typography: {
    fontFamily: '"Inter", system-ui, sans-serif',
    h1: { ...HEADING_STYLE, fontSize: 42 },
    h2: { ...HEADING_STYLE, fontSize: 32 },
    h3: { ...HEADING_STYLE, fontSize: 25 },
    h4: { ...HEADING_STYLE, fontSize: 20 },
    h5: { ...HEADING_STYLE, fontSize: 16 },
    h6: { ...HEADING_STYLE, fontSize: 13, letterSpacing: "0.08em", textTransform: "uppercase" },
    subtitle1: { fontSize: 15, fontWeight: 500, lineHeight: 1.4 },
    subtitle2: { fontSize: 13.5, fontWeight: 500, lineHeight: 1.4 },
    body1: { fontSize: 15, lineHeight: 1.55 },
    body2: { fontSize: 13.5, lineHeight: 1.5 },
    caption: { fontSize: 12, lineHeight: 1.45 },
    overline: { fontSize: 11, letterSpacing: "0.08em", lineHeight: 1.5 },
    button: { fontWeight: 500, textTransform: "none" },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: nocturneTokens.background,
          color: nocturneTokens.text,
          fontSize: 15,
          lineHeight: 1.55,
        },
        ":focus-visible": FOCUS_RING,
        "::selection": { backgroundColor: alpha(nocturneTokens.accent, 0.3) },
      },
    },
    MuiTypography: {
      styleOverrides: {
        // Nocturne's headings are smaller than MUI's, so the default 0.35em gutter
        // leaves a form's floating label touching the title above it; a fixed
        // gutter keeps the form pages (which only take the theme) readable.
        gutterBottom: { marginBottom: 16 },
      },
    },
    MuiButtonBase: {
      styleOverrides: { root: { "&.Mui-focusVisible": FOCUS_RING } },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          textTransform: "none",
          fontSize: 14,
          lineHeight: 1.2,
          minHeight: 36,
          padding: "6px 12px",
          borderRadius: nocturneTokens.radius.medium,
          "&.Mui-disabled": { opacity: 0.45 },
        },
        contained: ({ ownerState, theme }) => {
          const outlineColor =
            ownerState.color === undefined || ownerState.color === "inherit"
              ? theme.palette.primary.main
              : theme.palette[ownerState.color].main;
          return {
            backgroundColor: "transparent",
            color: outlineColor,
            border: `1px solid ${outlineColor}`,
            boxShadow: "none",
            "&:hover": { backgroundColor: alpha(outlineColor, 0.12), boxShadow: "none" },
            "&:active": { backgroundColor: alpha(outlineColor, 0.22) },
            "&.Mui-disabled": {
              backgroundColor: "transparent",
              color: outlineColor,
              borderColor: outlineColor,
            },
          };
        },
        outlined: ({ ownerState, theme }) => {
          const buttonIsSecondary = ownerState.color === "secondary";
          const outlineColor = buttonIsSecondary ? nocturneTokens.divider : undefined;
          const hoverTint =
            ownerState.color === undefined || ownerState.color === "inherit" || buttonIsSecondary
              ? alpha(nocturneTokens.text, 0.07)
              : alpha(theme.palette[ownerState.color].main, 0.12);
          return {
            ...(outlineColor === undefined ? {} : { borderColor: outlineColor }),
            "&:hover": {
              backgroundColor: hoverTint,
              ...(outlineColor === undefined ? {} : { borderColor: outlineColor }),
            },
            "&.Mui-disabled": {
              color: buttonIsSecondary ? nocturneTokens.text : undefined,
              ...(outlineColor === undefined ? {} : { borderColor: outlineColor }),
            },
          };
        },
        text: { paddingLeft: 6, paddingRight: 6 },
      },
    },
    MuiIconButton: {
      styleOverrides: { root: { borderRadius: nocturneTokens.radius.medium } },
    },
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: "none" },
        outlined: { borderColor: nocturneTokens.divider },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          backgroundColor: nocturneTokens.surface,
          borderRadius: nocturneTokens.radius.medium,
          fontSize: 14,
          "& .MuiOutlinedInput-notchedOutline": { borderColor: nocturneTokens.divider },
          "&:hover .MuiOutlinedInput-notchedOutline": {
            borderColor: alpha(nocturneTokens.text, 0.45),
          },
          "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
            borderColor: nocturneTokens.accent,
            borderWidth: 1,
          },
        },
        input: { caretColor: nocturneTokens.accent },
        // A small field matches Nocturne's 36px controls, so it lines up with the buttons beside it.
        inputSizeSmall: { paddingTop: 7, paddingBottom: 7 },
      },
    },
    MuiInputLabel: {
      styleOverrides: { root: { fontSize: 14 } },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          height: "auto",
          fontSize: 11,
          letterSpacing: "0.02em",
          borderRadius: nocturneTokens.radius.medium * 0.75,
        },
        label: { paddingTop: 3, paddingBottom: 3, paddingLeft: 10, paddingRight: 10 },
      },
    },
    MuiTabs: {
      styleOverrides: {
        root: { minHeight: 44, borderBottom: `1px solid ${nocturneTokens.divider}` },
        list: { gap: 20 },
        indicator: { height: 2 },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          textTransform: "none",
          fontSize: 13.5,
          fontWeight: 400,
          minWidth: 0,
          minHeight: 44,
          padding: "12px 0",
          color: nocturneTokens.neutral[400],
          "&.Mui-selected": { color: nocturneTokens.accent },
        },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: { borderRadius: nocturneTokens.radius.medium, fontSize: 13.5 },
        standardError: {
          backgroundColor: statusColors.failedBannerBackground,
          color: statusColors.failedBannerText,
          "& .MuiAlert-icon": { color: statusColors.failed },
        },
        standardSuccess: {
          backgroundColor: statusColors.passedBannerBackground,
          color: statusColors.passedBannerText,
          "& .MuiAlert-icon": { color: statusColors.passed },
        },
        standardWarning: {
          backgroundColor: statusColors.staleBannerBackground,
          color: statusColors.staleBannerText,
          "& .MuiAlert-icon": { color: statusColors.stale },
        },
        standardInfo: {
          backgroundColor: nocturneTokens.accentRamp[900],
          color: nocturneTokens.accentRamp[200],
          boxShadow: `inset 0 0 0 1px ${nocturneTokens.accentRamp[700]}`,
          "& .MuiAlert-icon": { color: nocturneTokens.accent },
        },
      },
    },
    MuiLinearProgress: {
      styleOverrides: {
        root: {
          height: 3,
          borderRadius: 2,
          backgroundColor: nocturneTokens.accentRamp[800],
        },
        bar: { borderRadius: 2, backgroundColor: nocturneTokens.accent },
      },
    },
    MuiLink: {
      defaultProps: { underline: "hover" },
      styleOverrides: {
        root: { textUnderlineOffset: 3, "&:hover": { color: nocturneTokens.accentRamp[400] } },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          "&.Mui-selected, &.Mui-selected:hover": {
            backgroundColor: nocturneTokens.accentRamp[900],
            boxShadow: `inset 0 0 0 1px ${nocturneTokens.accentRamp[700]}`,
          },
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          backgroundColor: nocturneTokens.surface,
          borderRadius: nocturneTokens.radius.large,
          boxShadow: nocturneTokens.shadow.large,
        },
      },
    },
    MuiMenu: {
      styleOverrides: {
        paper: { backgroundColor: nocturneTokens.surface, boxShadow: nocturneTokens.shadow.medium },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: { backgroundColor: nocturneTokens.neutral[800], fontSize: 12 },
      },
    },
  },
});
