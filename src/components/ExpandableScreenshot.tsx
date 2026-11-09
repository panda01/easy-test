import { type ReactElement, useState } from "react";
import ScreenshotThumbnailButton, { type SingleSxStyle } from "./ScreenshotThumbnailButton";
import ScreenshotViewerDialog from "./ScreenshotViewerDialog";

/** Props for `ExpandableScreenshot`. */
export interface ExpandableScreenshotProps {
  /** The image's url. */
  src: string;
  /** The image's alt text. */
  alt: string;
  /** The line shown above it full screen; the alt text when omitted. */
  caption?: string;
  /** Styles for the button around the image (its width, margins). */
  buttonSx?: SingleSxStyle;
  /** Styles for the image itself (its border, shadow, aspect ratio). */
  imageSx?: SingleSxStyle;
}

/**
 * One screenshot that opens on its own in the full-screen viewer when
 * clicked - a `ScreenshotThumbnailButton` with its own
 * `ScreenshotViewerDialog` of a single screenshot (no previous / next).
 * @param props - The image, its caption, and the button and image styles
 * @returns The clickable screenshot and its viewer
 */
export default function ExpandableScreenshot(props: ExpandableScreenshotProps): ReactElement {
  const { src, alt, caption, buttonSx, imageSx } = props;
  const [viewerIsOpen, setViewerIsOpen] = useState(false);
  const viewableScreenshots = [{ src, alt, caption: caption ?? alt }];

  /** Opens the screenshot full screen. */
  const openViewer = (): void => {
    setViewerIsOpen(true);
  };

  /** Closes the full-screen viewer. */
  const closeViewer = (): void => {
    setViewerIsOpen(false);
  };

  /** A single screenshot has nothing to page to; the viewer only ever asks for index 0. */
  const keepTheOnlyScreenshotOpen = (): void => {
    setViewerIsOpen(true);
  };

  return (
    <>
      <ScreenshotThumbnailButton src={src} alt={alt} onOpen={openViewer} buttonSx={buttonSx} imageSx={imageSx} />
      <ScreenshotViewerDialog
        screenshots={viewableScreenshots}
        openIndex={viewerIsOpen ? 0 : null}
        onClose={closeViewer}
        onOpenIndexChange={keepTheOnlyScreenshotOpen}
      />
    </>
  );
}
