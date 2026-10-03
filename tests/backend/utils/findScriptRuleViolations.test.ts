import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { findScriptRuleViolations } from "../../../server/utils/findScriptRuleViolations.js";

/**
 * The template script from the guidelines, pulled out of the prompt file, so
 * the spec proves the template itself passes the scan.
 * @returns The template's JavaScript source
 */
function readGuidelinesTemplate(): string {
  const guidelines = readFileSync(
    path.join(process.cwd(), "server", "prompts", "actionScriptGuidelines.md"),
    "utf8",
  );
  const templateBlocks = guidelines.split("```js\n");
  const lastBlock = templateBlocks.at(-1) ?? "";
  return lastBlock.split("```")[0];
}

describe("findScriptRuleViolations", () => {
  it("finds nothing in the guidelines' own template", () => {
    const template = readGuidelinesTemplate();
    expect(template).toContain("import { chromium } from 'playwright';");
    expect(findScriptRuleViolations(template)).toEqual([]);
  });

  it("allows the features the guidelines allow, including the file chooser and the mouse wheel", () => {
    const code = [
      "import { chromium } from 'playwright';",
      "await page.getByLabel('Email').pressSequentially('a@b.c', { delay: 100 });",
      "await page.getByRole('button', { name: 'Go' }).click();",
      "await (await chooserPromise).setFiles('path/to/file.pdf');",
      "await page.mouse.wheel(0, 400);",
      "const text = await page.getByText('Done').innerText();",
      "await page.locator('#id').evaluateNothing;",
      "const myEvaluator = 1;",
    ].join("\n");
    expect(findScriptRuleViolations(code)).toEqual([]);
  });

  it.each([
    ["await page.getByLabel('Email').fill('a');", ".fill("],
    ["await page.keyboard.insertText('a');", "insertText"],
    ["await button.click({ force : true });", "force: true"],
    ["await page.evaluate(() => 1);", "evaluate"],
    ["await page.evaluateHandle(() => 1);", "evaluate"],
    ["await page.locator('li').evaluateAll((items) => items.length);", "evaluate"],
    ["await page.$eval('h1', (h) => h.id);", "$eval / $$eval"],
    ["await page.$$eval('li', (items) => items.length);", "$eval / $$eval"],
    ["await page.addInitScript('x');", "addInitScript"],
    ["await page.addScriptTag({ content: 'x' });", "addInitScript"],
    ["await page.exposeFunction('f', () => 1);", "exposeFunction"],
    ["await page.setContent('<p>x</p>');", "setContent"],
    ["await button.dispatchEvent('click');", "dispatchEvent"],
    ["await input.setInputFiles('a.pdf');", "setInputFiles"],
    ["await page.route('**/*', (route) => route.abort());", "route"],
    ["await context.routeFromHAR('a.har');", "route"],
    ["await page.request.get('/api');", "request"],
    ["const api = await request.newContext();", "request"],
    ["await context.addCookies([]);", "cookies"],
    ["await context.storageState({ path: 's.json' });", "cookies"],
    ["await context.setExtraHTTPHeaders({});", "cookies"],
    ["await context.grantPermissions(['camera']);", "cookies"],
    ["await context.setGeolocation({ latitude: 1, longitude: 2 });", "cookies"],
    ["await page.mouse.click(10, 20);", "raw mouse coordinates"],
    ["await page.mouse.move(10, 20);", "raw mouse coordinates"],
    ["const t = await page.locator('h1').textContent();", "textContent"],
    ["const t = await page.locator('li').allTextContents();", "textContent"],
    ["const v = await link.getAttribute('href');", "getAttribute"],
    ["const v = await input.inputValue();", "inputValue"],
    ["const html = await page.content();", "content()"],
    ["const html = await page.locator('body').innerHTML();", "innerHTML"],
    ["const fs = require('fs');", "require("],
    ["const fs = await import('node:fs');", "import("],
    ["// uses child_process", "child_process"],
    ["console.log(process.env.HOME);", "process.env"],
    ["eval('1 + 1');", "eval("],
    ["const f = new Function('return 1');", "new Function"],
  ])("flags %s", (line, expectedLabelFragment) => {
    const violations = findScriptRuleViolations(line);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatch(/^Line 1: /);
    expect(violations[0]).toContain(expectedLabelFragment);
  });

  it("does not report page.$eval( a second time as eval(", () => {
    const violations = findScriptRuleViolations("await page.$eval('h1', (h) => h.innerText);");
    expect(violations).toEqual(["Line 1: $eval / $$eval - runs code inside the page"]);
  });

  it("flags imports of anything other than playwright, in every import form", () => {
    const code = [
      "import { chromium } from 'playwright';",
      "import fs from 'node:fs';",
      "import 'dotenv/config';",
      "export { x } from \"./other.mjs\";",
      "import {",
      "  test,",
      "} from '@playwright/test';",
    ].join("\n");
    expect(findScriptRuleViolations(code)).toEqual([
      "Line 2: imports 'node:fs' - scripts may only import 'playwright'",
      "Line 3: imports 'dotenv/config' - scripts may only import 'playwright'",
      "Line 4: imports './other.mjs' - scripts may only import 'playwright'",
      "Line 7: imports '@playwright/test' - scripts may only import 'playwright'",
    ]);
  });

  it("does not mistake text like \"from 'X'\" inside a step message for an import", () => {
    const code = "step(\"Pick 'Blue' from 'Colors'\");";
    expect(findScriptRuleViolations(code)).toEqual([]);
  });

  it("reports every rule a line breaks, in line order, with Windows line endings handled", () => {
    const code = [
      "import { chromium } from 'playwright';",
      "await input.fill(process.env.SECRET);",
      "await page.evaluate(() => 1);",
    ].join("\r\n");
    expect(findScriptRuleViolations(code)).toEqual([
      "Line 2: .fill( - sets a whole value at once; type with pressSequentially",
      "Line 2: process.env - reads environment variables",
      "Line 3: evaluate - runs code inside the page",
    ]);
  });
});
