/**
 * Every icon the app draws, in one place. This is the only module that
 * imports `@mui/icons-material`, and it imports each icon by its own path
 * (`@mui/icons-material/Add`), never the package root, so the bundle only
 * carries the icons listed here rather than the whole library.
 *
 * Components import icons from this file:
 * `import { AddIcon } from "./icons";`
 */
import { createSvgIcon } from "@mui/material/utils";

export { default as AddIcon } from "@mui/icons-material/Add";
export { default as ArrowDownwardIcon } from "@mui/icons-material/ArrowDownward";
export { default as ArrowUpwardIcon } from "@mui/icons-material/ArrowUpward";
export { default as CheckIcon } from "@mui/icons-material/Check";
export { default as CheckCircleOutlineIcon } from "@mui/icons-material/CheckCircleOutline";
export { default as ChevronLeftIcon } from "@mui/icons-material/ChevronLeft";
export { default as ChevronRightIcon } from "@mui/icons-material/ChevronRight";
export { default as DeleteOutlineIcon } from "@mui/icons-material/DeleteOutline";
export { default as DragIndicatorIcon } from "@mui/icons-material/DragIndicator";
export { default as EditOutlinedIcon } from "@mui/icons-material/EditOutlined";
export { default as ExpandMoreIcon } from "@mui/icons-material/ExpandMore";
export { default as HighlightOffIcon } from "@mui/icons-material/HighlightOff";
export { default as MoreHorizIcon } from "@mui/icons-material/MoreHoriz";
export { default as PlayArrowIcon } from "@mui/icons-material/PlayArrow";

/**
 * The "not run yet" status icon: a dashed circle, the mockups' mark for a
 * version or action with no runs. MUI has no dashed circle, so it is drawn
 * here with MUI's own `createSvgIcon`, which makes it size, color, and take
 * `titleAccess` like every other icon.
 */
export const NotRunIcon = createSvgIcon(
  <circle
    cx="12"
    cy="12"
    r="9"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeDasharray="3.3 3.3"
  />,
  "NotRun",
);
