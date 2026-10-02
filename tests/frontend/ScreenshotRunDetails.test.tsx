import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ScreenshotRunDetails from "../../src/components/ScreenshotRunDetails";
import { buildScreenshotRunRecord } from "./support/frontendTestHelpers";

describe("ScreenshotRunDetails", () => {
  it("shows a successful run's outcome and duration as a status, and its screenshot", () => {
    const run = buildScreenshotRunRecord({ id: "run-1", durationMs: 1234 });

    render(<ScreenshotRunDetails websiteId="website-1" run={run} />);

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Succeeded · HTTP 200 · 1.2 s");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    const screenshot = screen.getByRole("img", { name: /^Screenshot of https:\/\/example\.com taken / });
    expect(screenshot).toHaveAttribute(
      "src",
      "/api/websites/website-1/screenshot-runs/run-1/screenshot",
    );
  });

  it("says when and where the run was taken", () => {
    const run = buildScreenshotRunRecord({ requestedUrl: "https://example.com/shop" });

    render(<ScreenshotRunDetails websiteId="website-1" run={run} />);

    expect(
      screen.getByText(`Taken ${new Date(run.createdAt).toLocaleString()} · https://example.com/shop`),
    ).toBeInTheDocument();
  });

  it("shows a failed run's HTTP status and reason, with the error page's screenshot", () => {
    const run = buildScreenshotRunRecord({
      succeeded: false,
      httpStatus: 404,
      errorMessage: "The page responded with HTTP 404",
    });

    render(<ScreenshotRunDetails websiteId="website-1" run={run} />);

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Failed · HTTP 404");
    expect(status).toHaveTextContent("The page responded with HTTP 404");
    expect(screen.getByRole("img")).toBeInTheDocument();
  });

  it("says no screenshot was captured, and shows no image, when the visit never reached a page", () => {
    const run = buildScreenshotRunRecord({
      succeeded: false,
      httpStatus: null,
      errorMessage: "page.goto: net::ERR_CONNECTION_REFUSED at https://example.com/",
      screenshotFileName: null,
    });

    render(<ScreenshotRunDetails websiteId="website-1" run={run} />);

    expect(screen.getByRole("status")).toHaveTextContent("Failed · No response");
    expect(screen.getByRole("status")).toHaveTextContent("net::ERR_CONNECTION_REFUSED");
    expect(screen.getByText("No screenshot was captured for this run.")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
