import { readAriaSnapshotLines } from "./summarizePageStructure.js";
import { FORM_FIELD_ROLES, type FormFieldRole } from "./formFields.js";

/** The roles that group fields into one form, as the aria snapshot names them. */
const CONTAINER_ROLES: ReadonlySet<string> = new Set(["dialog", "alertdialog", "form"]);

/** One form field the aria snapshot shows. */
export interface SnapshotField {
  /** Its role. */
  role: FormFieldRole;
  /** Its accessible name, or null when it has none. */
  name: string | null;
  /** Its `/placeholder:`, or null. */
  placeholder: string | null;
  /** True when the snapshot marks it `[disabled]` - nothing can be typed into it. */
  isDisabled: boolean;
  /** Which dialog or form it sits in, counting from 1 in snapshot order; 0 when it is in none. */
  containerNumber: number;
  /** That dialog's or form's name, or null. */
  containerName: string | null;
}

/** One link the aria snapshot shows, with its address. */
export interface SnapshotLink {
  /** The link's accessible name. */
  name: string;
  /** Its `/url:` as written (often relative, e.g. `/projects/abc`). */
  href: string;
}

/** The parts of an aria snapshot that parameters need: its fields and its links. */
export interface AriaSnapshotOutline {
  /** The form fields, in snapshot order. */
  fields: SnapshotField[];
  /** The named links that have an address, in snapshot order. */
  links: SnapshotLink[];
}

/** One entry line, split into its role, name, and attributes. */
interface ParsedEntry {
  /** The role, e.g. `textbox`. */
  role: string;
  /** The quoted accessible name, unquoted; null when there is none. */
  name: string | null;
  /** The `[...]` attributes, joined, e.g. `[disabled]`. */
  attributes: string;
}

/** An entry still open while the lines nested under it are read. */
interface OpenEntry {
  /** Its depth. */
  depth: number;
  /** The field it is, when it is one. */
  field: SnapshotField | null;
  /** The link it is, when it is one; its address arrives on a nested `/url:` line. */
  link: { name: string; href: string | null } | null;
  /** The container it is, when it is one. */
  container: { containerNumber: number; containerName: string | null } | null;
}

/**
 * Reads a YAML scalar as text: a double-quoted one is unescaped, any other
 * is taken as written (trimmed).
 * @param text - The scalar as written
 * @returns Its text
 */
export function unquoteSnapshotText(text: string): string {
  const trimmedText = text.trim();
  const textIsDoubleQuoted = trimmedText.length >= 2 && trimmedText.startsWith('"') && trimmedText.endsWith('"');
  if (!textIsDoubleQuoted) return trimmedText;
  try {
    const unquoted: unknown = JSON.parse(trimmedText);
    return typeof unquoted === "string" ? unquoted : trimmedText.slice(1, -1);
  } catch {
    return trimmedText.slice(1, -1);
  }
}

/**
 * Splits an entry line into its role, quoted name, and attributes:
 * `textbox "Email" [disabled]: value` → `textbox`, `Email`, `[disabled]`.
 * @param entryText - The entry without its indentation and `- `
 * @returns The parts, or null for a text node or anything that does not start with a role
 */
function parseEntryText(entryText: string): ParsedEntry | null {
  const entryMatch = /^([A-Za-z][\w-]*)(?:\s+"((?:[^"\\]|\\.)*)")?((?:\s*\[[^\]]*\])*)/.exec(entryText);
  if (entryMatch === null) return null;
  const quotedName = entryMatch.at(2);
  return {
    role: entryMatch[1],
    name: quotedName === undefined ? null : unquoteSnapshotText(`"${quotedName}"`),
    attributes: entryMatch[3],
  };
}

/**
 * Reads a property line nested under an entry: `/url: /about` or
 * `/placeholder: e.g. Studio A`.
 * @param entryText - The line without its indentation and `- `
 * @returns The property's name and value, or null when the line is not one
 */
function readPropertyLine(entryText: string): { property: string; value: string } | null {
  const propertyMatch = /^\/([A-Za-z]+):\s*(.*)$/.exec(entryText);
  if (propertyMatch === null) return null;
  return { property: propertyMatch[1], value: unquoteSnapshotText(propertyMatch[2]) };
}

/**
 * Reads the form fields and the links of an aria snapshot. Each field gets
 * its name, its placeholder (from the nested `/placeholder:` line), whether
 * it is disabled, and the dialog or form it is nested in; each named link its
 * address (from the nested `/url:` line). The snapshot cannot say whether a
 * field is required - that is read in the browser (see `formFields.ts`).
 * @param ariaSnapshot - Playwright's YAML aria snapshot
 * @returns The fields and the links, in snapshot order
 */
export function readAriaSnapshotOutline(ariaSnapshot: string): AriaSnapshotOutline {
  const fields: SnapshotField[] = [];
  const pendingLinks: { name: string; href: string | null }[] = [];
  const openEntries: OpenEntry[] = [];
  let containerCount = 0;

  for (const { depth, entryText } of readAriaSnapshotLines(ariaSnapshot)) {
    while ((openEntries.at(-1)?.depth ?? -1) >= depth) openEntries.pop();
    const parentEntry = openEntries.at(-1);

    const propertyLine = readPropertyLine(entryText);
    if (propertyLine !== null) {
      if (propertyLine.property === "placeholder" && parentEntry?.field) {
        parentEntry.field.placeholder = propertyLine.value === "" ? null : propertyLine.value;
      }
      if (propertyLine.property === "url" && parentEntry?.link) {
        parentEntry.link.href = propertyLine.value;
      }
      continue;
    }

    const parsedEntry = parseEntryText(entryText);
    const openEntry: OpenEntry = { depth, field: null, link: null, container: null };
    const fieldRole = FORM_FIELD_ROLES.find((role) => role === parsedEntry?.role);
    const enclosingContainer = [...openEntries].reverse().find((entry) => entry.container !== null)?.container;
    if (parsedEntry !== null && fieldRole !== undefined) {
      const field: SnapshotField = {
        role: fieldRole,
        name: parsedEntry.name === "" ? null : parsedEntry.name,
        placeholder: null,
        isDisabled: parsedEntry.attributes.includes("[disabled"),
        containerNumber: enclosingContainer?.containerNumber ?? 0,
        containerName: enclosingContainer?.containerName ?? null,
      };
      fields.push(field);
      openEntry.field = field;
    } else if (parsedEntry !== null && parsedEntry.role === "link" && parsedEntry.name !== null) {
      const link = { name: parsedEntry.name, href: null };
      pendingLinks.push(link);
      openEntry.link = link;
    } else if (parsedEntry !== null && CONTAINER_ROLES.has(parsedEntry.role)) {
      containerCount += 1;
      openEntry.container = { containerNumber: containerCount, containerName: parsedEntry.name };
    }
    openEntries.push(openEntry);
  }

  const links = pendingLinks.flatMap((link) =>
    link.href === null || link.name.trim() === "" ? [] : [{ name: link.name, href: link.href }],
  );
  return { fields, links };
}
