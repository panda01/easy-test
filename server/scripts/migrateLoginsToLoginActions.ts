// MUST be the first import - loads DATABASE_URL before dbService reads it.
import "../bootEnv.js";
import {
  convertLoginsToOneLoginActionPerWebsite,
  type WebsiteLoginConversion,
} from "../services/dbService.js";
import { describeError } from "../utils/describeError.js";

/**
 * Describes what the conversion did for one website, in one line.
 * @param conversion - What was done for the website
 * @returns E.g. `"Forge": kept login action ck…; 2 merged into it; 3 action(s) given their credential back`
 */
export function describeWebsiteLoginConversion(conversion: WebsiteLoginConversion): string {
  const loginActionNote = conversion.loginActionWasCreated
    ? `created login action ${conversion.loginActionId}`
    : `kept login action ${conversion.loginActionId}`;
  return `"${conversion.websiteName}": ${loginActionNote}; ${String(conversion.mergedLoginActionCount)} merged into it; ${String(conversion.restoredCredentialActionCount)} action(s) given their credential back`;
}

/**
 * The one-time move to ONE Login action per website, run from the command
 * line BEFORE the old login columns (the credential's login page and
 * selectors, and `loginActionId`) are dropped:
 *
 *   npx tsx server/scripts/migrateLoginsToLoginActions.ts
 *
 * Prints one line per website (see `describeWebsiteLoginConversion`). Safe
 * to run twice. Sets a non-zero exit code when it fails.
 * @returns Resolves once the summary (or the failure) is printed
 */
export async function runLoginMigration(): Promise<void> {
  try {
    const conversions = await convertLoginsToOneLoginActionPerWebsite();
    const noWebsiteLogsIn = conversions.length === 0;
    if (noWebsiteLogsIn) {
      console.log("[login migration] no website has a credential or a login action - nothing to convert");
      return;
    }
    for (const conversion of conversions) {
      console.log(`[login migration] ${describeWebsiteLoginConversion(conversion)}`);
    }
  } catch (error: unknown) {
    console.error(`[login migration] failed: ${describeError(error)}`);
    process.exitCode = 1;
  }
}

const scriptWasRunDirectly = import.meta.url === `file://${process.argv[1]}`;
if (scriptWasRunDirectly) {
  await runLoginMigration();
  process.exit();
}
