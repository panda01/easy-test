import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import LoadStatusNotice from "../../src/components/LoadStatusNotice";

describe("LoadStatusNotice", () => {
  it("shows a spinner named by loadingLabel while loading", () => {
    render(<LoadStatusNotice isLoading errorMessage={null} loadingLabel="Loading websites" />);
    expect(screen.getByRole("progressbar", { name: "Loading websites" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows only the spinner when loading, even if an error is also set", () => {
    render(<LoadStatusNotice isLoading errorMessage="stale error" loadingLabel="Loading website" />);
    expect(screen.getByRole("progressbar", { name: "Loading website" })).toBeInTheDocument();
    expect(screen.queryByText("stale error")).not.toBeInTheDocument();
  });

  it("shows the failure reason in an error alert", () => {
    render(
      <LoadStatusNotice
        isLoading={false}
        errorMessage="Website not found"
        loadingLabel="Loading website"
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Website not found");
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("renders nothing once loaded without an error", () => {
    const { container } = render(
      <LoadStatusNotice isLoading={false} errorMessage={null} loadingLabel="Loading websites" />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
