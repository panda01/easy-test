import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter, Route } from "react-router-dom";
import ActionScriptRunHistory from "../../src/components/ActionScriptRunHistory";
import ActionScriptRunOutput, {
  countOutputLines,
  describeOutputLineCount,
} from "../../src/components/ActionScriptRunOutput";
import ActionStatusBar from "../../src/components/ActionStatusBar";
import CrawlProgressCard from "../../src/components/CrawlProgressCard";
import DisclosureRow from "../../src/components/DisclosureRow";
import MoreActionsMenu from "../../src/components/MoreActionsMenu";
import PageContainer from "../../src/components/PageContainer";
import StatusDot from "../../src/components/StatusDot";
import StatusTag from "../../src/components/StatusTag";
import { nocturneTokens, statusColors } from "../../src/theme/nocturneTheme";
import {
  buildActionScriptRunRecord,
  readProbeAfterLanding,
  renderPageRoutes,
} from "./support/frontendTestHelpers";

/*
 * Covers the small shared pieces the redesign is built from: StatusDot,
 * StatusTag, ActionStatusBar, DisclosureRow, CrawlProgressCard,
 * MoreActionsMenu, PageContainer, ActionScriptRunHistory, and
 * ActionScriptRunOutput.
 */

describe("StatusDot", () => {
  it("is a hidden decoration in the color it is given", () => {
    const { container } = render(<StatusDot color={statusColors.failed} />);

    const dot = container.firstElementChild;
    expect(dot).toHaveAttribute("aria-hidden", "true");
    expect(dot).toHaveStyle({ backgroundColor: statusColors.failed, width: "7px" });
  });

  it("glows for something in progress and can be drawn hollow", () => {
    const { container, rerender } = render(<StatusDot color={statusColors.running} isGlowing />);
    expect(container.firstElementChild).toHaveStyle({
      boxShadow: `0 0 0 4px ${nocturneTokens.accentRamp[800]}`,
    });

    rerender(<StatusDot color={statusColors.notRun} isHollow size={6} />);
    const hollowDot = container.firstElementChild;
    if (hollowDot === null) throw new Error("The dot did not render");
    expect(hollowDot).toHaveStyle({ width: "6px" });
    // Hollow: only its outline takes the color, never its fill.
    expect(getComputedStyle(hollowDot).backgroundColor).not.toBe("rgb(147, 151, 171)");
  });
});

describe("StatusTag", () => {
  it("shows its text in the tone's tint", () => {
    render(<StatusTag label="Out of date" tone="stale" isCompact />);

    const tag = screen.getByText("Out of date").closest(".MuiChip-root");
    expect(tag).toHaveStyle({
      backgroundColor: statusColors.staleTagBackground,
      color: statusColors.staleTagText,
    });
  });

  it.each([
    { tone: "loggedIn" as const, backgroundColor: statusColors.loggedInTagBackground },
    { tone: "failed" as const, backgroundColor: statusColors.failedBannerBackground },
    { tone: "accent" as const, backgroundColor: nocturneTokens.accentRamp[800] },
    { tone: "neutral" as const, backgroundColor: nocturneTokens.neutral[800] },
  ])("tints the $tone tone", ({ tone, backgroundColor }) => {
    render(<StatusTag label="Tag" tone={tone} />);

    expect(screen.getByText("Tag").closest(".MuiChip-root")).toHaveStyle({ backgroundColor });
  });
});

describe("ActionStatusBar", () => {
  it("draws a segment per status that has actions and says every count in words", () => {
    const { container } = render(
      <ActionStatusBar counts={{ passed: 4, failed: 0, notRun: 1 }} legendHasDots />,
    );

    const bar = container.querySelector('[aria-hidden="true"]');
    expect(bar?.children).toHaveLength(2);
    expect(screen.getByText("4 passed")).toBeInTheDocument();
    expect(screen.getByText("0 failed")).toBeInTheDocument();
    expect(screen.getByText("1 not run")).toBeInTheDocument();
  });

  it("puts a dot before each legend entry only when asked", () => {
    const { container, rerender } = render(
      <ActionStatusBar counts={{ passed: 1, failed: 1, notRun: 1 }} legendHasDots />,
    );
    expect(container.querySelectorAll('span[aria-hidden="true"]')).toHaveLength(3);

    rerender(<ActionStatusBar counts={{ passed: 1, failed: 1, notRun: 1 }} legendHasDots={false} />);
    expect(container.querySelectorAll('span[aria-hidden="true"]')).toHaveLength(0);
  });
});

describe("DisclosureRow", () => {
  it("starts closed, with its label and muted detail, and mounts its content only once opened", async () => {
    const user = userEvent.setup();
    render(
      <DisclosureRow label="Assumptions" detail="2">
        <p>The first assumption</p>
      </DisclosureRow>,
    );

    const toggle = screen.getByRole("button", { name: "Assumptions · 2" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).not.toHaveAttribute("aria-controls");
    expect(screen.queryByText("The first assumption")).not.toBeInTheDocument();

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const content = screen.getByText("The first assumption");
    expect(toggle).toHaveAttribute("aria-controls", content.parentElement?.id);
  });

  it("closes again on a second click", async () => {
    const user = userEvent.setup();
    render(
      <DisclosureRow label="Plan JSON">
        <p>{"{}"}</p>
      </DisclosureRow>,
    );
    const toggle = screen.getByRole("button", { name: "Plan JSON" });

    await user.click(toggle);
    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });
});

describe("CrawlProgressCard", () => {
  const runningRun = {
    status: "running",
    visitedPageCount: 12,
    pageLimit: 50,
    waitingUrlCount: 8,
    createdAt: "2026-10-13T14:27:46.000Z",
  };
  const now = new Date("2026-10-13T14:30:00.000Z");

  it("reports the crawl's progress: its title, elapsed time, pages, and a progress bar", () => {
    render(<CrawlProgressCard run={runningRun} title="Crawl running" now={now} />, { wrapper: MemoryRouter });

    const card = screen.getByRole("status");
    expect(within(card).getByText("Crawl running")).toBeInTheDocument();
    expect(within(card).getByText("2:14")).toBeInTheDocument();
    expect(within(card).getByText("12 of up to 50 pages · 8 waiting")).toBeInTheDocument();
    expect(within(card).getByRole("progressbar", { name: "Pages crawled" })).toHaveAttribute(
      "aria-valuenow",
      "24",
    );
    expect(within(card).queryByRole("link", { name: "Watch" })).not.toBeInTheDocument();
  });

  it("links Watch to the crawl's own page when given one", () => {
    render(
      <CrawlProgressCard
        run={runningRun}
        title="Crawl running"
        now={now}
        watchPath="/websites/website-1/crawl-runs/crawl-run-1"
      />,
      { wrapper: MemoryRouter },
    );

    expect(screen.getByRole("link", { name: "Watch" })).toHaveAttribute(
      "href",
      "/websites/website-1/crawl-runs/crawl-run-1",
    );
  });

  it("caps the bar at full, even past the limit", () => {
    render(
      <CrawlProgressCard run={{ ...runningRun, visitedPageCount: 60 }} title="Running" now={now} />,
      { wrapper: MemoryRouter },
    );

    expect(screen.getByRole("progressbar", { name: "Pages crawled" })).toHaveAttribute("aria-valuenow", "100");
  });
});

describe("MoreActionsMenu", () => {
  it("opens a menu whose Edit goes to the edit form and whose Delete calls back", async () => {
    const user = userEvent.setup();
    const handleDeleteClick = vi.fn();
    renderPageRoutes(
      <Route
        path="/websites/:websiteId"
        element={
          <MoreActionsMenu
            editPath="/websites/website-1/edit"
            editLinkState={{ returnTo: "/websites/website-1" }}
            onDeleteClick={handleDeleteClick}
          />
        }
      />,
      { initialEntries: ["/websites/website-1"] },
    );
    const moreButton = screen.getByRole("button", { name: "More actions" });
    expect(moreButton).toHaveAttribute("aria-expanded", "false");

    await user.click(moreButton);
    expect(moreButton).toHaveAttribute("aria-expanded", "true");
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));

    expect(handleDeleteClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    await user.click(moreButton);
    await user.click(screen.getByRole("menuitem", { name: "Edit" }));
    const probe = await readProbeAfterLanding("/websites/website-1/edit");
    expect(probe.state).toBe(JSON.stringify({ returnTo: "/websites/website-1" }));
  });

  it("closes without picking anything on Escape", async () => {
    const user = userEvent.setup();
    render(
      <MoreActionsMenu
        editPath="/edit"
        editLinkState={{ returnTo: "/" }}
        onDeleteClick={vi.fn()}
      />,
      { wrapper: MemoryRouter },
    );

    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.keyboard("{Escape}");

    expect(screen.getByRole("button", { name: "More actions" })).toHaveAttribute("aria-expanded", "false");
  });
});

describe("PageContainer", () => {
  it("frames the page in a main landmark, as wide as allowed", () => {
    render(
      <PageContainer maxWidth={1080}>
        <p>Content</p>
      </PageContainer>,
    );

    const main = screen.getByRole("main");
    expect(main).toHaveTextContent("Content");
    expect(main).toHaveStyle({ maxWidth: "1080px" });
  });

  it("centers a capped frame in the window, with even margins on both sides", () => {
    render(
      <PageContainer maxWidth={1080}>
        <p>Content</p>
      </PageContainer>,
    );

    expect(screen.getByRole("main")).toHaveStyle({ marginLeft: "auto", marginRight: "auto" });
  });
});

describe("ActionScriptRunHistory", () => {
  const failedRun = buildActionScriptRunRecord({
    id: "run-2",
    succeeded: false,
    failedStepNumber: 9,
    createdAt: "2026-04-03T04:00:00.000Z",
  });
  const passedRun = buildActionScriptRunRecord({ id: "run-1" });

  it("lists each run's outcome, marks the shown one, and picks another on click", async () => {
    const user = userEvent.setup();
    const handleSelectRun = vi.fn();
    render(
      <ActionScriptRunHistory
        runs={[failedRun, passedRun]}
        selectedRunId="run-2"
        onSelectRun={handleSelectRun}
        label="Runs of version 5"
      />,
    );

    const runList = screen.getByRole("list", { name: "Runs of version 5" });
    const runButtons = within(runList).getAllByRole("button");
    expect(runButtons[0]).toHaveTextContent("Failed at step 9");
    expect(runButtons[0]).toHaveAttribute("aria-current", "true");
    expect(runButtons[1]).toHaveTextContent("Passed");
    expect(runButtons[1]).not.toHaveAttribute("aria-current");

    await user.click(runButtons[1]);

    expect(handleSelectRun).toHaveBeenCalledWith("run-1");
  });
});

describe("ActionScriptRunOutput", () => {
  it("shows the step log, noting when its start was dropped", () => {
    render(<ActionScriptRunOutput run={{ output: "line one\nline two", outputWasTruncated: true }} />);

    expect(screen.getByLabelText("Run output")).toHaveTextContent("line one line two");
    expect(screen.getByText("The output was long, so only its end is kept.")).toBeInTheDocument();
  });

  it("says when the run logged nothing", () => {
    render(<ActionScriptRunOutput run={{ output: "", outputWasTruncated: false }} />);

    expect(screen.getByText("The run logged nothing.")).toBeInTheDocument();
    expect(screen.queryByText(/only its end is kept/)).not.toBeInTheDocument();
  });

  it("counts the log's lines for its row", () => {
    expect(countOutputLines("")).toBe(0);
    expect(countOutputLines("one")).toBe(1);
    expect(countOutputLines("one\ntwo\nthree")).toBe(3);
    expect(countOutputLines("one\ntwo\n")).toBe(2);
    expect(countOutputLines("\n")).toBe(0);
    expect(describeOutputLineCount("one")).toBe("1 line");
    expect(describeOutputLineCount("one\ntwo")).toBe("2 lines");
  });
});
