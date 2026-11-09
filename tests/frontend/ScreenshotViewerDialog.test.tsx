import { describe, it, expect, vi } from "vitest";
import { useState, type ReactElement } from "react";
import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import ScreenshotViewerDialog, { type ViewableScreenshot } from "../../src/components/ScreenshotViewerDialog";

const THREE_SCREENSHOTS: ViewableScreenshot[] = [
  { src: "/shots/start.png", alt: "Screenshot: Opened the start page", caption: "Opened the start page" },
  { src: "/shots/step-1.png", alt: "Screenshot: Step 1 · Click link \"Alpha\"", caption: "Step 1 · Click link \"Alpha\"" },
  { src: "/shots/failure.png", alt: "Failure screenshot: Step 2 · failed here", caption: "Step 2 · failed here" },
];

/** Props for `StatefulViewer`. */
interface StatefulViewerProps {
  /** The screenshots to page through. */
  screenshots: ViewableScreenshot[];
  /** Which one is open first, or null for closed. */
  initialOpenIndex: number | null;
  /** Told when the viewer closes. */
  onClose?: () => void;
}

/**
 * The viewer with its open index held in state, the way a page holds it.
 * @param props - The screenshots, the starting index, and the close spy
 * @returns The rendered viewer
 */
function StatefulViewer(props: StatefulViewerProps): ReactElement {
  const { screenshots, initialOpenIndex, onClose } = props;
  const [openIndex, setOpenIndex] = useState<number | null>(initialOpenIndex);
  /** Closes the viewer and tells the spy. */
  const handleClose = (): void => {
    setOpenIndex(null);
    onClose?.();
  };
  return (
    <ScreenshotViewerDialog
      screenshots={screenshots}
      openIndex={openIndex}
      onClose={handleClose}
      onOpenIndexChange={setOpenIndex}
    />
  );
}

/**
 * Reads the open viewer's "N / total" counter.
 * @returns The counter's text
 */
function readCounter(): string {
  return screen.getByLabelText("Screenshot position").textContent;
}

describe("ScreenshotViewerDialog", () => {
  it("renders nothing while closed", () => {
    render(<StatefulViewer screenshots={THREE_SCREENSHOTS} initialOpenIndex={null} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("shows the open screenshot full screen with its caption as the dialog's name, and a counter", () => {
    render(<StatefulViewer screenshots={THREE_SCREENSHOTS} initialOpenIndex={1} />);

    const viewer = screen.getByRole("dialog", { name: "Step 1 · Click link \"Alpha\"" });
    expect(within(viewer).getByRole("img", { name: "Screenshot: Step 1 · Click link \"Alpha\"" })).toHaveAttribute(
      "src",
      "/shots/step-1.png",
    );
    expect(readCounter()).toBe("2 / 3");
    expect(viewer).toHaveClass("MuiDialog-paperFullScreen");
  });

  it("pages with the previous / next buttons and stops at the first and last screenshot", async () => {
    const user = userEvent.setup();
    render(<StatefulViewer screenshots={THREE_SCREENSHOTS} initialOpenIndex={1} />);

    await user.click(screen.getByRole("button", { name: "Next screenshot" }));
    expect(readCounter()).toBe("3 / 3");
    expect(screen.getByRole("img", { name: "Failure screenshot: Step 2 · failed here" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next screenshot" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Previous screenshot" }));
    await user.click(screen.getByRole("button", { name: "Previous screenshot" }));
    expect(readCounter()).toBe("1 / 3");
    expect(screen.getByRole("button", { name: "Previous screenshot" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next screenshot" })).toBeEnabled();
  });

  it("hands focus to the other paging button when the focused one turns disabled, so it stays in the viewer", async () => {
    const user = userEvent.setup();
    render(<StatefulViewer screenshots={THREE_SCREENSHOTS} initialOpenIndex={1} />);

    await user.click(screen.getByRole("button", { name: "Previous screenshot" }));
    expect(screen.getByRole("button", { name: "Next screenshot" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Next screenshot" }));
    await user.click(screen.getByRole("button", { name: "Next screenshot" }));
    expect(screen.getByRole("button", { name: "Previous screenshot" })).toHaveFocus();
  });

  it("pages with the ← and → keys, stopping at the ends", async () => {
    const user = userEvent.setup();
    render(<StatefulViewer screenshots={THREE_SCREENSHOTS} initialOpenIndex={0} />);

    await user.keyboard("{ArrowLeft}");
    expect(readCounter()).toBe("1 / 3");
    await user.keyboard("{ArrowRight}");
    expect(readCounter()).toBe("2 / 3");
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(readCounter()).toBe("3 / 3");
    await user.keyboard("{ArrowLeft}");
    expect(readCounter()).toBe("2 / 3");
  });

  it("hears the arrow keys even when focus has left the dialog", () => {
    const onOpenIndexChange = vi.fn();
    render(
      <ScreenshotViewerDialog
        screenshots={THREE_SCREENSHOTS}
        openIndex={1}
        onClose={vi.fn()}
        onOpenIndexChange={onOpenIndexChange}
      />,
    );

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

    expect(onOpenIndexChange.mock.calls).toEqual([[2], [0]]);
  });

  it("stops listening for the arrow keys once closed", () => {
    const onOpenIndexChange = vi.fn();
    const { rerender } = render(
      <ScreenshotViewerDialog screenshots={THREE_SCREENSHOTS} openIndex={1} onClose={vi.fn()} onOpenIndexChange={onOpenIndexChange} />,
    );
    rerender(
      <ScreenshotViewerDialog screenshots={THREE_SCREENSHOTS} openIndex={null} onClose={vi.fn()} onOpenIndexChange={onOpenIndexChange} />,
    );

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));

    expect(onOpenIndexChange).not.toHaveBeenCalled();
  });

  it("closes with its close button and with Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<StatefulViewer screenshots={THREE_SCREENSHOTS} initialOpenIndex={0} onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "Close full screen screenshot" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    render(<StatefulViewer screenshots={THREE_SCREENSHOTS} initialOpenIndex={2} onClose={onClose} />);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("shows a single screenshot with no previous / next buttons and no counter", () => {
    render(<StatefulViewer screenshots={THREE_SCREENSHOTS.slice(0, 1)} initialOpenIndex={0} />);

    expect(screen.getByRole("dialog", { name: "Opened the start page" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Previous screenshot" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next screenshot" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Screenshot position")).not.toBeInTheDocument();
  });

  it("stays closed when the open index points past the screenshots", () => {
    render(<StatefulViewer screenshots={THREE_SCREENSHOTS} initialOpenIndex={7} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
