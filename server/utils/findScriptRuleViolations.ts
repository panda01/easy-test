/**
 * One forbidden-feature rule from the script-writing guidelines
 * (`server/prompts/actionScriptGuidelines.md`, "Forbidden Playwright
 * Features"): what to call it in a warning, and the text pattern that finds it.
 */
interface ScriptRule {
  /** The warning text after "Line N: ", naming the feature and why it is not allowed. */
  label: string;
  /** Matches one line of code that uses the feature. No `g` flag, so `.test` keeps no state. */
  pattern: RegExp;
}

/** The only module a generated script may import. */
const ALLOWED_IMPORT_SPECIFIER = "playwright";

/**
 * Every forbidden feature, in the order its warnings are listed for a line.
 * These are deliberately plain text patterns: the scan only WARNS (the script
 * is still saved and runnable), so an occasional hit inside a comment or a
 * string is acceptable and the UI says so.
 */
const SCRIPT_RULES: readonly ScriptRule[] = [
  {
    label: ".fill( - sets a whole value at once; type with pressSequentially",
    pattern: /\.fill\s*\(/,
  },
  {
    label: "insertText - sets text at once; type with pressSequentially",
    pattern: /\binsertText\b/,
  },
  {
    label: "force: true - skips the checks that make an action user-possible",
    pattern: /\bforce\s*:\s*true\b/,
  },
  {
    label: "evaluate - runs code inside the page",
    pattern: /\.(evaluate|evaluateHandle|evaluateAll)\s*\(/,
  },
  {
    label: "$eval / $$eval - runs code inside the page",
    pattern: /\.\$\$?eval\s*\(/,
  },
  {
    label: "addInitScript / addScriptTag / addStyleTag - injects code into the page",
    pattern: /\b(addInitScript|addScriptTag|addStyleTag)\b/,
  },
  {
    label: "exposeFunction / exposeBinding - runs code inside the page",
    pattern: /\b(exposeFunction|exposeBinding)\b/,
  },
  {
    label: "setContent - replaces the page's HTML",
    pattern: /\.setContent\s*\(/,
  },
  {
    label: "dispatchEvent - fires a synthetic event instead of real input",
    pattern: /\bdispatchEvent\b/,
  },
  {
    label: "setInputFiles - sets files directly; use the file chooser",
    pattern: /\bsetInputFiles\b/,
  },
  {
    label: "route - intercepts network traffic",
    pattern: /\.(route|routeFromHAR|routeWebSocket)\s*\(/,
  },
  {
    label: "request - direct network access",
    pattern: /\b(page|context)\.request\b|\brequest\.newContext\b/,
  },
  {
    label: "cookies / storage / headers / permissions / geolocation / offline - changes browser state a user could not",
    pattern:
      /\b(addCookies|clearCookies|storageState|setExtraHTTPHeaders|grantPermissions|clearPermissions|setGeolocation|setOffline)\b/,
  },
  {
    label: "raw mouse coordinates - target elements by what they are, not where they are",
    pattern: /\.mouse\.(click|dblclick|down|up|move)\s*\(/,
  },
  {
    label: "textContent - can read hidden text; use innerText",
    pattern: /\b(textContent|allTextContents)\b/,
  },
  {
    label: "getAttribute - can read hidden data",
    pattern: /\bgetAttribute\b/,
  },
  {
    label: "inputValue - can read hidden field values",
    pattern: /\binputValue\b/,
  },
  {
    label: "innerHTML / content() - reads the page source",
    pattern: /\binnerHTML\b|\.content\s*\(\s*\)/,
  },
  {
    label: "require( - loads another module",
    pattern: /\brequire\s*\(/,
  },
  {
    label: "import( - dynamically loads another module",
    pattern: /\bimport\s*\(/,
  },
  {
    label: "child_process - runs other programs",
    pattern: /child_process/,
  },
  {
    label: "process.env - reads environment variables",
    pattern: /\bprocess\.env\b/,
  },
  {
    // The lookbehind keeps `page.$eval(` from also counting as `eval(`.
    label: "eval( - runs a string as code",
    pattern: /(?<![\w$.])eval\s*\(/,
  },
  {
    label: "new Function - runs a string as code",
    pattern: /\bnew\s+Function\s*\(/,
  },
];

/**
 * Patterns that pull a module specifier out of a STATEMENT-level import or
 * re-export: `import ... from 'x'`, `export ... from 'x'`, the closing
 * `} from 'x'` of a multi-line import, and a side-effect `import 'x'`.
 * Anchored to the start of the line, so text like `step("Pick 'A' from 'B'")`
 * is not mistaken for an import.
 */
const IMPORT_SPECIFIER_PATTERNS: readonly RegExp[] = [
  /^\s*(?:import|export)\b.*\bfrom\s*['"]([^'"]+)['"]/,
  /^\s*}\s*from\s*['"]([^'"]+)['"]/,
  /^\s*import\s*['"]([^'"]+)['"]/,
];

/**
 * Finds the module one line of code imports or re-exports, if any.
 * @param line - One line of the script
 * @returns The quoted module specifier, or null when the line imports nothing
 */
function readImportSpecifier(line: string): string | null {
  for (const importPattern of IMPORT_SPECIFIER_PATTERNS) {
    const match = importPattern.exec(line);
    const lineImportsAModule = match?.[1] !== undefined;
    if (lineImportsAModule) {
      return match[1];
    }
  }
  return null;
}

/**
 * Scans a generated Playwright script for features a real user could not use
 * with a mouse and keyboard - the guidelines' forbidden list - plus imports
 * of anything other than `playwright` and ways of running other code.
 *
 * This is the WARN-ONLY check the user chose: the results are stored on the
 * script and shown in the UI, but the script is still saved and runnable. It
 * is a plain text scan, so a forbidden name inside a comment or a string is
 * reported too.
 *
 * Script-agnostic on purpose, so future use-case scripts can reuse it.
 * @param code - The complete `.mjs` source
 * @returns One "Line N: <feature> - <why>" warning per rule hit, in line order; empty when the code is clean
 */
export function findScriptRuleViolations(code: string): string[] {
  const violations: string[] = [];
  const lines = code.split(/\r?\n/);

  lines.forEach((line, lineIndex) => {
    const lineNumber = lineIndex + 1;

    for (const rule of SCRIPT_RULES) {
      const lineBreaksTheRule = rule.pattern.test(line);
      if (lineBreaksTheRule) {
        violations.push(`Line ${lineNumber}: ${rule.label}`);
      }
    }

    const importSpecifier = readImportSpecifier(line);
    const lineImportsAnotherModule =
      importSpecifier !== null && importSpecifier !== ALLOWED_IMPORT_SPECIFIER;
    if (lineImportsAnotherModule) {
      violations.push(
        `Line ${lineNumber}: imports '${importSpecifier}' - scripts may only import '${ALLOWED_IMPORT_SPECIFIER}'`,
      );
    }
  });

  return violations;
}
