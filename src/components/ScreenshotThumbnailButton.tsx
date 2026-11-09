import { type ReactElement } from "react";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import { type SxProps, type Theme } from "@mui/material/styles";
import { nocturneTokens } from "../theme/nocturneTheme";

/**
 * One `sx` style - an object or a theme callback, not a list - so the
 * component can put it after its own defaults in one `sx` list.
 */
export type SingleSxStyle = Exclude<SxProps<Theme>, readonly unknown[]>;

/** Props for `ScreenshotThumbnailButton`. */
export interface ScreenshotThumbnailButtonProps {
  /** The image's url. */
  src: string;
  /** The image's alt text; the button is labelled "View full screen: <alt>". */
  alt: string;
  /** Called when the screenshot is clicked (or activated from the keyboard), to open it full screen. */
  onOpen: () => void;
  /** Styles for the button around the image (its width, margins); it fills its container by default. */
  buttonSx?: SingleSxStyle;
  /** Styles for the image itself (its border, shadow, aspect ratio). */
  imageSx?: SingleSxStyle;
}

/**
 * A screenshot that opens full screen when clicked: the image inside a
 * button labelled "View full screen: <alt>", with a zoom-in cursor and the
 * app's focus ring, so it works from the keyboard too. The image keeps its
 * own alt text. It only reports the click (`onOpen`); whoever renders it
 * owns the viewer (see `ExpandableScreenshot` for one with its own).
 * @param props - The image, the open callback, and the button and image styles
 * @returns The clickable screenshot
 */
export default function ScreenshotThumbnailButton(props: ScreenshotThumbnailButtonProps): ReactElement {
  const { src, alt, onOpen, buttonSx, imageSx } = props;
  return (
    <ButtonBase
      onClick={onOpen}
      aria-label={`View full screen: ${alt}`}
      sx={[
        {
          display: "block",
          width: "100%",
          p: 0,
          textAlign: "inherit",
          cursor: "zoom-in",
          borderRadius: `${String(nocturneTokens.radius.medium)}px`,
        },
        buttonSx ?? false,
      ]}
    >
      <Box
        component="img"
        src={src}
        alt={alt}
        sx={[
          { display: "block", width: "100%", height: "auto" },
          imageSx ?? false,
        ]}
      />
    </ButtonBase>
  );
}
