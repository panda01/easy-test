import { type ChangeEvent, type ReactElement } from "react";
import { useSearchParams } from "react-router-dom";
import Container from "@mui/material/Container";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import LoadStatusNotice from "../components/LoadStatusNotice";
import PageBreadcrumbs from "../components/PageBreadcrumbs";
import SideBySideDiff from "../components/SideBySideDiff";
import { type ActionScriptRecord, useActionScripts } from "../hooks/useActionScripts";
import { useRequiredRouteParam } from "../hooks/useRequiredRouteParam";
import { type ScriptModelOption, useScriptModels } from "../hooks/useScriptModels";
import { useWebsiteItem } from "../hooks/useWebsiteItems";
import { useWebsite } from "../hooks/useWebsites";
import { describeScriptModel } from "../utils/describeScriptModel";
import { WEBSITE_LIST_PATH, websiteDetailPath, websiteItemDetailPath } from "../utils/routePaths";
import { ACTION_KIND } from "../utils/websiteItemKinds";

/** The query parameter naming the left (older) version. */
const FROM_QUERY_PARAMETER = "from";

/** The query parameter naming the right (newer) version. */
const TO_QUERY_PARAMETER = "to";

/**
 * Finds a script's position in the newest-first list, falling back to a
 * default position when the id is missing or unknown (e.g. an old link).
 * @param scripts - The action's scripts, newest first
 * @param scriptId - The id from the query string, or null
 * @param defaultIndex - The position to use when the id does not match
 * @returns The script's position
 */
function findScriptIndex(
  scripts: ActionScriptRecord[],
  scriptId: string | null,
  defaultIndex: number,
): number {
  const foundIndex = scripts.findIndex((script) => script.id === scriptId);
  const scriptWasFound = foundIndex !== -1;
  return scriptWasFound ? foundIndex : defaultIndex;
}

/**
 * Labels a version for the pickers: "Version 2 · <date> · <model> · <effort>".
 * @param script - The version
 * @param versionNumber - Its number, counting the oldest as 1
 * @param catalogModels - The live model list, for the display name (may be empty)
 * @returns The label
 */
function describeVersion(
  script: ActionScriptRecord,
  versionNumber: number,
  catalogModels: ScriptModelOption[],
): string {
  const generatedAtText = new Date(script.createdAt).toLocaleString();
  const modelText = describeScriptModel(script.modelId, script.effort, catalogModels);
  return `Version ${String(versionNumber)} · ${generatedAtText} · ${modelText}`;
}

/**
 * Compares two of an action's script versions side by side
 * (`/websites/:websiteId/actions/:itemId/scripts/compare?from=&to=`): the
 * title and description each was generated from, and the code, with removed
 * lines on the left, added lines on the right, and changed words
 * highlighted.
 *
 * "From" (left) defaults to the second newest version and "To" (right) to
 * the newest. Both choices live in the query string (replaced, not pushed),
 * so a comparison can be linked or reloaded without piling up history. An
 * action with fewer than two versions has nothing to compare.
 *
 * The website and action are fetched for the breadcrumbs; the action request
 * decides loading / not-found. The model list is only used for display names,
 * so the page still works (showing raw ids) when it cannot load.
 * @returns The rendered comparison page
 */
export default function ActionScriptComparePage(): ReactElement {
  const websiteId = useRequiredRouteParam("websiteId");
  const actionId = useRequiredRouteParam("itemId");
  const websiteResource = useWebsite(websiteId);
  const actionResource = useWebsiteItem(ACTION_KIND, websiteId, actionId);
  const website = websiteResource.data;
  const action = actionResource.data;
  const actionPath = websiteItemDetailPath(ACTION_KIND, websiteId, actionId);

  const { scripts, isLoading: scriptsAreLoading, errorMessage: scriptsErrorMessage } =
    useActionScripts(websiteId, actionId);
  const catalogModels = useScriptModels().data?.models ?? [];
  const [searchParams, setSearchParams] = useSearchParams();

  const fromIndex = findScriptIndex(scripts, searchParams.get(FROM_QUERY_PARAMETER), 1);
  const toIndex = findScriptIndex(scripts, searchParams.get(TO_QUERY_PARAMETER), 0);
  const fromScript = scripts.at(fromIndex) ?? null;
  const toScript = scripts.at(toIndex) ?? null;
  const scriptListLoadedWithoutError = !scriptsAreLoading && scriptsErrorMessage === null;
  const thereAreTooFewVersions = scripts.length < 2;

  /**
   * Numbers versions by age: the list is newest first, so the oldest is 1.
   * @param scriptIndex - The script's position in the newest-first list
   * @returns Its version number
   */
  const versionNumberAt = (scriptIndex: number): number => scripts.length - scriptIndex;

  /**
   * Puts both chosen versions in the query string, replacing the entry.
   * @param fromScriptId - The left version's id
   * @param toScriptId - The right version's id
   */
  const showVersions = (fromScriptId: string, toScriptId: string): void => {
    setSearchParams(
      { [FROM_QUERY_PARAMETER]: fromScriptId, [TO_QUERY_PARAMETER]: toScriptId },
      { replace: true },
    );
  };

  /**
   * Shows the picked version on the left.
   * @param event - The "From" select's change event
   */
  const handleFromChange = (event: ChangeEvent<HTMLInputElement>): void => {
    if (toScript === null) return;
    showVersions(event.target.value, toScript.id);
  };

  /**
   * Shows the picked version on the right.
   * @param event - The "To" select's change event
   */
  const handleToChange = (event: ChangeEvent<HTMLInputElement>): void => {
    if (fromScript === null) return;
    showVersions(fromScript.id, event.target.value);
  };

  const versionOptions = scripts.map((script, scriptIndex) => (
    <MenuItem key={script.id} value={script.id}>
      {describeVersion(script, versionNumberAt(scriptIndex), catalogModels)}
    </MenuItem>
  ));

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <PageBreadcrumbs
        crumbs={[
          { label: "Websites", to: WEBSITE_LIST_PATH },
          { label: website?.name ?? "Website", to: websiteDetailPath(websiteId) },
          { label: action?.title ?? ACTION_KIND.singularTitle, to: actionPath },
          { label: "Compare versions" },
        ]}
      />

      <LoadStatusNotice
        isLoading={actionResource.isLoading}
        errorMessage={actionResource.errorMessage}
        loadingLabel={`Loading ${ACTION_KIND.singularLabel}`}
      />

      {action !== null && (
        <>
          <Typography variant="overline" color="text.secondary" component="p">
            {action.title}
          </Typography>
          <Typography variant="h4" component="h1" sx={{ mb: 3 }}>
            Compare script versions
          </Typography>

          <LoadStatusNotice
            isLoading={scriptsAreLoading}
            errorMessage={scriptsErrorMessage}
            loadingLabel="Loading scripts"
          />

          {scriptListLoadedWithoutError && thereAreTooFewVersions && (
            <Typography color="text.secondary">
              Convert this action at least twice to compare versions.
            </Typography>
          )}

          {!thereAreTooFewVersions && fromScript !== null && toScript !== null && (
            <>
              <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
                <TextField
                  select
                  label="From"
                  value={fromScript.id}
                  onChange={handleFromChange}
                  helperText="Shown on the left"
                  fullWidth
                >
                  {versionOptions}
                </TextField>
                <TextField
                  select
                  label="To"
                  value={toScript.id}
                  onChange={handleToChange}
                  helperText="Shown on the right"
                  fullWidth
                >
                  {versionOptions}
                </TextField>
              </Stack>

              <SideBySideDiff label="Title" leftText={fromScript.actionTitle} rightText={toScript.actionTitle} />
              <SideBySideDiff
                label="Description"
                leftText={fromScript.actionDescription}
                rightText={toScript.actionDescription}
              />
              <SideBySideDiff label="Code" leftText={fromScript.code} rightText={toScript.code} />
            </>
          )}
        </>
      )}
    </Container>
  );
}
