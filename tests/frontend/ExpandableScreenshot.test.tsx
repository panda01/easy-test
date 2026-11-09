import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import ExpandableScreenshot from "../../src/components/ExpandableScreenshot";
import ScreenshotThumbnailButton from "../../src/components/ScreenshotThumbnailButton";

describe("ScreenshotThumbnailButton", () => {
  it("shows the image inside a button labelled to open it full screen, and reports the click", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<ScreenshotThumbnailButton src="/shots/a.png" alt="Screenshot: Step 1" onOpen={onOpen} imageSx={{ border: 1 }} />);

    expect(screen.getByRole("img", { name: "Screenshot: Step 1" })).toHaveAttribute("src", "/shots/a.png");
    await user.click(screen.getByRole("button", { name: "View full screen: Screenshot: Step 1" }));

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("can be opened from the keyboard", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<ScreenshotThumbnailButton src="/shots/a.png" alt="Screenshot: Step 1" onOpen={onOpen} />);

    await user.tab();
    await user.keyboard("{Enter}");

    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe("ExpandableScreenshot", () => {
  it("opens the screenshot on its own, full screen, with its caption, and closes it with Escape", async () => {
    const user = userEvent.setup();
    render(<ExpandableScreenshot src="/shots/a.png" alt="Login failure screenshot" caption="What the browser showed" />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "View full screen: Login failure screenshot" }));

    const viewer = screen.getByRole("dialog", { name: "What the browser showed" });
    // The page behind the open viewer is hidden from assistive technology: only the viewer's image is reachable.
    expect(screen.getAllByRole("img", { name: "Login failure screenshot" })).toEqual([
      within(viewer).getByRole("img", { name: "Login failure screenshot" }),
    ]);
    expect(within(viewer).getByRole("img")).toHaveAttribute("src", "/shots/a.png");
    expect(screen.queryByRole("button", { name: "Next screenshot" })).not.toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("captions the full-screen view with the alt text when no caption is given, and closes with its button", async () => {
    const user = userEvent.setup();
    render(<ExpandableScreenshot src="/shots/a.png" alt="Screenshot of https://example.com" />);

    await user.click(screen.getByRole("button", { name: "View full screen: Screenshot of https://example.com" }));
    expect(screen.getByRole("dialog", { name: "Screenshot of https://example.com" })).toBeInTheDocument();

    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close full screen screenshot" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});
