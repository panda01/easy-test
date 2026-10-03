import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import SideBySideDiff from "../../src/components/SideBySideDiff";

describe("SideBySideDiff", () => {
  it("names the section and says No differences for identical texts", () => {
    render(<SideBySideDiff label="Description" leftText="Same text" rightText="Same text" />);

    const section = screen.getByRole("region", { name: "Description" });
    expect(within(section).getByRole("heading", { name: "Description" })).toBeInTheDocument();
    expect(within(section).getByText("No differences.")).toBeInTheDocument();
    expect(within(section).getAllByText("Same text")).toHaveLength(2);
  });

  it("marks removed and added lines, the changed words, and the filler", () => {
    const { container } = render(
      <SideBySideDiff label="Code" leftText={"a\nold line\n"} rightText={"a\nnew line\nextra\n"} />,
    );

    expect(screen.queryByText("No differences.")).not.toBeInTheDocument();
    expect(container.querySelectorAll("[data-diff-row]")).toHaveLength(3);
    expect(container.querySelectorAll('[data-diff-kind="removed"]').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('[data-diff-kind="added"]').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('[data-diff-kind="empty"]').length).toBeGreaterThan(0);
    const changedWords = Array.from(container.querySelectorAll('[data-changed-word="true"]')).map(
      (changedWord) => changedWord.textContent,
    );
    expect(changedWords).toEqual(["old", "new"]);
  });
});
