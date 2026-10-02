import { describe, it, expect, afterEach } from "vitest";
import { resolveServerPort } from "../../../server/utils/resolveServerPort.js";

const originalServerPort = process.env.SERVER_PORT;

afterEach(() => {
  if (originalServerPort === undefined) {
    delete process.env.SERVER_PORT;
  } else {
    process.env.SERVER_PORT = originalServerPort;
  }
});

describe("resolveServerPort", () => {
  it("returns the parsed port for a valid value", () => {
    process.env.SERVER_PORT = "3010";
    expect(resolveServerPort()).toBe(3010);
  });

  it("throws when SERVER_PORT is missing", () => {
    delete process.env.SERVER_PORT;
    expect(() => resolveServerPort()).toThrow(/SERVER_PORT is not defined/);
  });

  it("throws when SERVER_PORT is empty", () => {
    process.env.SERVER_PORT = "";
    expect(() => resolveServerPort()).toThrow(/SERVER_PORT is not defined/);
  });

  it("throws when SERVER_PORT is not a number", () => {
    process.env.SERVER_PORT = "not-a-port";
    expect(() => resolveServerPort()).toThrow(/not a valid TCP port/);
  });

  it("throws when SERVER_PORT is zero", () => {
    process.env.SERVER_PORT = "0";
    expect(() => resolveServerPort()).toThrow(/not a valid TCP port/);
  });

  it("throws when SERVER_PORT is above the TCP range", () => {
    process.env.SERVER_PORT = "70000";
    expect(() => resolveServerPort()).toThrow(/not a valid TCP port/);
  });
});
