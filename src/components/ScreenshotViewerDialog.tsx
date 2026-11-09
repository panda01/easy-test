import { type ReactElement, useEffect, useId, useRef } from "react";
import Box from "@mui/material/Box";
import Dialog from "@mui/material/Dialog";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon } from "./icons";
import { MONOSPACE_FONT_FAMILY, nocturneTokens } from "../theme/nocturneTheme";

/** One screenshot the viewer can show full screen. */
export interface ViewableScreenshot {
  /** The image's url. */
  src: string;
  /** The image's alt text. */
  alt: string;
  /** The line shown above it, e.g. "Step 3 · Click button "Save"". */
  caption: string;
}

/** Props for `ScreenshotViewerDialog`. */
export interface ScreenshotViewerDialogProps {
  /** The screenshots to page through, in order (one for a single screenshot). */
  screenshots: readonly ViewableScreenshot[];
  /** Which screenshot is open (0-based), or null when the viewer is closed. */
  openIndex: number | null;
  /** Called when the user closes the viewer (the close button or Escape). */
  onClose: () => void;
  /** Called with the screenshot to show next (the previous / next buttons, or the ← / → keys). */
  onOpenIndexChange: (screenshotIndex: number) => void;
}

/**
 * A full-screen, dark viewer for screenshots: the open screenshot fitted to
 * the window (`object-fit: contain`, so all of it shows), its caption, and a
 * close button; Escape closes it too. With more than one screenshot it is a
 * slideshow - previous / next buttons, the ← / → keys, and an "N / total"
 * counter - that stops at the first and last screenshot rather than
 * wrapping around.
 *
 * Focus never falls out of the viewer: when paging reaches the first or last
 * screenshot, the button that turns disabled hands focus to the opposite
 * one (a disabled button drops focus to the page, where neither Escape nor
 * the arrow keys would reach the dialog). The arrow keys are also heard on
 * the whole window while the viewer is open, not only inside the dialog.
 *
 * Fully controlled: the page owns which screenshot is open. The dialog
 * renders nothing while closed, so a closed viewer adds no image to the page.
 * @param props - The screenshots, which one is open, and the two callbacks
 * @returns The full-screen viewer
 */
export default function ScreenshotViewerDialog(props: ScreenshotViewerDialogProps): ReactElement {
  const { screenshots, openIndex, onClose, onOpenIndexChange } = props;
  const captionId = useId();
  const openScreenshot = openIndex === null ? undefined : screenshots.at(openIndex);
  const viewerIsOpen = openIndex !== null && openScreenshot !== undefined;
  const shownIndex = openIndex ?? 0;
  const viewerHasSeveralScreenshots = screenshots.length > 1;
  const thereIsAPreviousScreenshot = shownIndex > 0;
  const thereIsANextScreenshot = shownIndex < screenshots.length - 1;
  const lastIndex = screenshots.length - 1;
  const previousButtonRef = useRef<HTMLButtonElement>(null);
  const nextButtonRef = useRef<HTMLButtonElement>(null);

  /**
   * Shows the screenshot before the open one, when there is one. Landing on
   * the first one disables "Previous", so focus moves to "Next".
   */
  const showPreviousScreenshot = (): void => {
    if (!thereIsAPreviousScreenshot) return;
    const previousIndex = shownIndex - 1;
    onOpenIndexChange(previousIndex);
    const landedOnTheFirstScreenshot = previousIndex === 0;
    if (landedOnTheFirstScreenshot && document.activeElement === previousButtonRef.current) {
      nextButtonRef.current?.focus();
    }
  };

  /**
   * Shows the screenshot after the open one, when there is one. Landing on
   * the last one disables "Next", so focus moves to "Previous".
   */
  const showNextScreenshot = (): void => {
    if (!thereIsANextScreenshot) return;
    const nextIndex = shownIndex + 1;
    onOpenIndexChange(nextIndex);
    const landedOnTheLastScreenshot = nextIndex === lastIndex;
    if (landedOnTheLastScreenshot && document.activeElement === nextButtonRef.current) {
      previousButtonRef.current?.focus();
    }
  };

  // Page with the ← and → keys anywhere in the window while the viewer is
  // open (Escape is handled by the dialog itself, through `onClose`). The
  // handlers are new each render, so the listener is swapped with them.
  useEffect(() => {
    if (!viewerIsOpen) return undefined;
    /**
     * Pages through the screenshots with the ← and → keys.
     * @param event - A key press anywhere in the window
     */
    const handleWindowKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        showPreviousScreenshot();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        showNextScreenshot();
      }
    };
    window.addEventListener("keydown", handleWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown);
    };
  });

  const pagingButtonSx = {
    flexShrink: 0,
    width: 48,
    height: 48,
    color: nocturneTokens.text,
    backgroundColor: nocturneTokens.surface,
    "&:hover": { backgroundColor: nocturneTokens.neutral[700] },
    "&.Mui-disabled": { opacity: 0.35, color: nocturneTokens.text },
  } as const;

  return (
    <Dialog
      open={viewerIsOpen}
      onClose={onClose}
      fullScreen
      aria-labelledby={captionId}
      slotProps={{
        paper: {
          sx: {
            borderRadius: 0,
            boxShadow: "none",
            backgroundColor: nocturneTokens.background,
            display: "flex",
            flexDirection: "column",
          },
        },
      }}
    >
      {openScreenshot !== undefined && (
        <>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 2,
              px: { xs: 2, md: 3 },
              py: 1.5,
              borderBottom: `1px solid ${nocturneTokens.divider}`,
            }}
          >
            <Typography
              id={captionId}
              component="h2"
              sx={{ fontSize: 15, fontWeight: 500, mr: "auto", minWidth: 0, overflowWrap: "anywhere" }}
            >
              {openScreenshot.caption}
            </Typography>
            {viewerHasSeveralScreenshots && (
              <Box
                component="span"
                aria-label="Screenshot position"
                sx={{ fontFamily: MONOSPACE_FONT_FAMILY, fontSize: 13, color: nocturneTokens.neutral[400], flexShrink: 0 }}
              >
                {shownIndex + 1} / {screenshots.length}
              </Box>
            )}
            <IconButton onClick={onClose} aria-label="Close full screen screenshot" sx={{ flexShrink: 0 }}>
              <CloseIcon />
            </IconButton>
          </Box>
          <Box
            sx={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              alignItems: "center",
              gap: { xs: 1, md: 2 },
              p: { xs: 1, md: 2 },
            }}
          >
            {viewerHasSeveralScreenshots && (
              <IconButton
                ref={previousButtonRef}
                onClick={showPreviousScreenshot}
                disabled={!thereIsAPreviousScreenshot}
                aria-label="Previous screenshot"
                sx={pagingButtonSx}
              >
                <ChevronLeftIcon />
              </IconButton>
            )}
            <Box
              sx={{
                flex: 1,
                minWidth: 0,
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Box
                component="img"
                src={openScreenshot.src}
                alt={openScreenshot.alt}
                sx={{
                  display: "block",
                  maxWidth: "100%",
                  maxHeight: "100%",
                  objectFit: "contain",
                  borderRadius: `${String(nocturneTokens.radius.medium)}px`,
                }}
              />
            </Box>
            {viewerHasSeveralScreenshots && (
              <IconButton
                ref={nextButtonRef}
                onClick={showNextScreenshot}
                disabled={!thereIsANextScreenshot}
                aria-label="Next screenshot"
                sx={pagingButtonSx}
              >
                <ChevronRightIcon />
              </IconButton>
            )}
          </Box>
        </>
      )}
    </Dialog>
  );
}
