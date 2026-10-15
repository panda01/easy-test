import { type ReactElement, type ReactNode, useId, useState } from "react";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Collapse from "@mui/material/Collapse";
import { ChevronRightIcon } from "./icons";
import { nocturneTokens } from "../theme/nocturneTheme";

/** Props for `DisclosureRow`. */
export interface DisclosureRowProps {
  /** What the row opens, e.g. "Assumptions". */
  label: string;
  /** A muted count or note after the label, e.g. "2" (shown as "· 2"); omit for none. */
  detail?: string;
  /** What the row shows once opened. */
  children: ReactNode;
}

/**
 * A collapsed row the mockups use for secondary detail ("› Assumptions · 2",
 * "› Plan JSON", "› Output log · 42 lines"): a full-width button with a
 * chevron that turns when open, above a rule. Its content is only mounted
 * while open, so a long log or JSON costs nothing until it is asked for.
 * The button says whether it is open (`aria-expanded`) and, while open,
 * which region it controls (`aria-controls`).
 * @param props - The label, the muted detail, and the content
 * @returns The row and, when open, its content
 */
export default function DisclosureRow(props: DisclosureRowProps): ReactElement {
  const { label, detail, children } = props;
  const [isOpen, setIsOpen] = useState(false);
  const contentId = useId();
  const thereIsADetail = detail !== undefined;

  /** Opens the row when it is closed, and closes it when it is open. */
  const handleToggleClick = (): void => {
    setIsOpen((rowWasOpen) => !rowWasOpen);
  };

  return (
    <Box sx={{ borderTop: `1px solid ${nocturneTokens.divider}` }}>
      <ButtonBase
        onClick={handleToggleClick}
        aria-expanded={isOpen}
        // The content is only mounted while open, so it is only named then.
        aria-controls={isOpen ? contentId : undefined}
        sx={{
          width: "100%",
          minHeight: 44,
          justifyContent: "flex-start",
          gap: 1,
          fontSize: 13.5,
          fontFamily: "inherit",
          color: nocturneTokens.neutral[300],
          textAlign: "left",
          borderRadius: `${String(nocturneTokens.radius.small)}px`,
        }}
      >
        <ChevronRightIcon
          aria-hidden="true"
          sx={{
            fontSize: 16,
            transition: "transform 150ms",
            transform: isOpen ? "rotate(90deg)" : "none",
          }}
        />
        {label}
        {/* Keeps a space between the label and its detail in the button's accessible name. */}
        {thereIsADetail && " "}
        {thereIsADetail && (
          <Box component="span" sx={{ color: nocturneTokens.neutral[500] }}>
            · {detail}
          </Box>
        )}
      </ButtonBase>
      <Collapse in={isOpen} unmountOnExit>
        <Box id={contentId} sx={{ pb: 2 }}>
          {children}
        </Box>
      </Collapse>
    </Box>
  );
}
