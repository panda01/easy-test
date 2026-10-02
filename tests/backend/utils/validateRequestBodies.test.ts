import { describe, it, expect } from "vitest";
import {
  validateWebsiteInput,
  validateTitleDescriptionInput,
} from "../../../server/utils/validateRequestBodies.js";

const NOT_A_JSON_OBJECT_MESSAGE = "The request body must be a JSON object";
const URL_REQUIRED_MESSAGE = "A URL is required";
const URL_INVALID_MESSAGE = "The URL must be a valid http:// or https:// address";
const NAME_REQUIRED_MESSAGE = "A name is required";
const DESCRIPTION_NOT_TEXT_MESSAGE = "The description must be text";
const TITLE_REQUIRED_MESSAGE = "A title is required";
const DESCRIPTION_REQUIRED_MESSAGE = "A description is required";

/**
 * Bodies that are not a plain JSON object. Express 5 leaves `req.body`
 * undefined when no JSON was sent, and a client can send null, an array, or a
 * bare scalar, so both validators must reject every one of these before
 * reading a field.
 */
const nonObjectBodies: { label: string; body: unknown }[] = [
  { label: "undefined (no body sent)", body: undefined },
  { label: "null", body: null },
  { label: "an array", body: [{ url: "https://example.com", name: "Example" }] },
  { label: "a string", body: "https://example.com" },
  { label: "a number", body: 42 },
];

describe("validateWebsiteInput", () => {
  it.each(nonObjectBodies)("rejects a body that is $label", ({ body }) => {
    expect(validateWebsiteInput(body)).toEqual({
      isValid: false,
      errorMessage: NOT_A_JSON_OBJECT_MESSAGE,
    });
  });

  it.each([
    { label: "missing", url: undefined },
    { label: "an empty string", url: "" },
    { label: "whitespace only", url: "   " },
    { label: "a number", url: 12345 },
    { label: "null", url: null },
  ])("requires a url (url is $label)", ({ url }) => {
    expect(validateWebsiteInput({ url, name: "Example" })).toEqual({
      isValid: false,
      errorMessage: URL_REQUIRED_MESSAGE,
    });
  });

  it("checks the url before the name, so an empty object reports the url", () => {
    expect(validateWebsiteInput({})).toEqual({
      isValid: false,
      errorMessage: URL_REQUIRED_MESSAGE,
    });
  });

  it.each([
    { label: "an unparseable string", url: "not a url" },
    { label: "a host without a scheme", url: "example.com" },
    { label: "an ftp address", url: "ftp://example.com/file.txt" },
    { label: "a mailto address", url: "mailto:someone@example.com" },
    { label: "a javascript: address", url: "javascript:alert(1)" },
  ])("rejects a url that is $label", ({ url }) => {
    expect(validateWebsiteInput({ url, name: "Example" })).toEqual({
      isValid: false,
      errorMessage: URL_INVALID_MESSAGE,
    });
  });

  it("checks the url format before the name", () => {
    expect(validateWebsiteInput({ url: "ftp://example.com" })).toEqual({
      isValid: false,
      errorMessage: URL_INVALID_MESSAGE,
    });
  });

  it("normalizes the url: trims it, lowercases the scheme and host, and adds the root slash", () => {
    const result = validateWebsiteInput({ url: "  HTTPS://Example.COM ", name: "Example" });

    expect(result).toEqual({
      isValid: true,
      input: { url: "https://example.com/", name: "Example", description: null },
    });
  });

  it("accepts an http url and keeps its path and query", () => {
    const result = validateWebsiteInput({
      url: "http://example.com/login?next=/home",
      name: "Example",
    });

    expect(result).toEqual({
      isValid: true,
      input: { url: "http://example.com/login?next=/home", name: "Example", description: null },
    });
  });

  it.each([
    { label: "missing", name: undefined },
    { label: "an empty string", name: "" },
    { label: "whitespace only", name: " \t " },
    { label: "a number", name: 7 },
    { label: "null", name: null },
  ])("requires a name (name is $label)", ({ name }) => {
    expect(validateWebsiteInput({ url: "https://example.com", name })).toEqual({
      isValid: false,
      errorMessage: NAME_REQUIRED_MESSAGE,
    });
  });

  it("trims the name", () => {
    const result = validateWebsiteInput({ url: "https://example.com", name: "  Example  " });

    expect(result).toEqual({
      isValid: true,
      input: { url: "https://example.com/", name: "Example", description: null },
    });
  });

  it.each([
    { label: "omitted", description: undefined },
    { label: "null", description: null },
    { label: "an empty string", description: "" },
    { label: "whitespace only", description: "   " },
  ])("stores the description as null when it is $label", ({ description }) => {
    const result = validateWebsiteInput({
      url: "https://example.com",
      name: "Example",
      description,
    });

    expect(result).toEqual({
      isValid: true,
      input: { url: "https://example.com/", name: "Example", description: null },
    });
  });

  it.each([
    { label: "a number", description: 5 },
    { label: "a boolean", description: false },
    { label: "an object", description: { text: "a site" } },
    { label: "an array", description: ["a site"] },
  ])("rejects a description that is $label", ({ description }) => {
    expect(
      validateWebsiteInput({ url: "https://example.com", name: "Example", description }),
    ).toEqual({
      isValid: false,
      errorMessage: DESCRIPTION_NOT_TEXT_MESSAGE,
    });
  });

  it("trims a text description", () => {
    const result = validateWebsiteInput({
      url: "https://example.com",
      name: "Example",
      description: "  a site to test  ",
    });

    expect(result).toEqual({
      isValid: true,
      input: { url: "https://example.com/", name: "Example", description: "a site to test" },
    });
  });

  it("drops fields that are not part of a website", () => {
    const result = validateWebsiteInput({
      url: "https://example.com",
      name: "Example",
      id: "client-chosen-id",
      deletedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(result).toEqual({
      isValid: true,
      input: { url: "https://example.com/", name: "Example", description: null },
    });
  });
});

describe("validateTitleDescriptionInput", () => {
  it.each(nonObjectBodies)("rejects a body that is $label", ({ body }) => {
    expect(validateTitleDescriptionInput(body)).toEqual({
      isValid: false,
      errorMessage: NOT_A_JSON_OBJECT_MESSAGE,
    });
  });

  it.each([
    { label: "missing", title: undefined },
    { label: "an empty string", title: "" },
    { label: "whitespace only", title: "   " },
    { label: "a number", title: 3 },
    { label: "null", title: null },
  ])("requires a title (title is $label)", ({ title }) => {
    expect(validateTitleDescriptionInput({ title, description: "Steps" })).toEqual({
      isValid: false,
      errorMessage: TITLE_REQUIRED_MESSAGE,
    });
  });

  it("checks the title before the description, so an empty object reports the title", () => {
    expect(validateTitleDescriptionInput({})).toEqual({
      isValid: false,
      errorMessage: TITLE_REQUIRED_MESSAGE,
    });
  });

  it.each([
    { label: "missing", description: undefined },
    { label: "an empty string", description: "" },
    { label: "whitespace only", description: "\n  " },
    { label: "a number", description: 9 },
    { label: "null", description: null },
  ])("requires a description (description is $label)", ({ description }) => {
    expect(validateTitleDescriptionInput({ title: "Sign up", description })).toEqual({
      isValid: false,
      errorMessage: DESCRIPTION_REQUIRED_MESSAGE,
    });
  });

  it("trims both the title and the description", () => {
    const result = validateTitleDescriptionInput({
      title: "  Sign up  ",
      description: "  Create an account and land on the dashboard  ",
    });

    expect(result).toEqual({
      isValid: true,
      input: { title: "Sign up", description: "Create an account and land on the dashboard" },
    });
  });

  it("drops fields that are not a title or a description", () => {
    const result = validateTitleDescriptionInput({
      title: "Log in",
      description: "Enter credentials",
      websiteId: "someone-elses-website",
    });

    expect(result).toEqual({
      isValid: true,
      input: { title: "Log in", description: "Enter credentials" },
    });
  });
});
