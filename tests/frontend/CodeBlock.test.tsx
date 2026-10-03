import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import CodeBlock from "../../src/components/CodeBlock";

describe("CodeBlock", () => {
  it("shows the text exactly, whitespace included, under its accessible name", () => {
    const code = "line one\n    indented line\n";

    render(<CodeBlock code={code} label="Script code" />);

    const block = screen.getByLabelText("Script code");
    expect(block.tagName).toBe("PRE");
    expect(block.textContent).toBe(code);
  });
});
