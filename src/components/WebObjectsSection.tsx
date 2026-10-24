import { type ReactElement, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Link from "@mui/material/Link";
import Typography from "@mui/material/Typography";
import { EditOutlinedIcon } from "./icons";
import Alert from "@mui/material/Alert";
import CreatedObjectsList from "./CreatedObjectsList";
import LoadStatusNotice from "./LoadStatusNotice";
import RenameWebObjectDialog from "./RenameWebObjectDialog";
import { type CreatedObjectRecord, useCreatedObjects } from "../hooks/useCreatedObjects";
import { type WebObjectRecord, useWebObjectRenaming, useWebObjects } from "../hooks/useWebObjects";
import { MONOSPACE_FONT_FAMILY, nocturneTokens } from "../theme/nocturneTheme";
import {
  chooseWebObjectName,
  describePagePatternRole,
  describeWebObjectCounts,
  measureWebObjectDepths,
} from "../utils/describeWebObject";
import { formatCount } from "../utils/formatCount";
import { formatFullDateTime } from "../utils/formatRelativeTime";
import { crawlRunObjectsPath } from "../utils/routePaths";

/** How far each level of the object tree is indented, in px. */
const INDENT_PER_OBJECT_LEVEL_PX = 16;

/** Props for `WebObjectsSection`. */
export interface WebObjectsSectionProps {
  /** The owning website's cuid. */
  websiteId: string;
}

/**
 * Works out each saved object's depth in the object tree from its
 * `parentWebObjectId`.
 * @param webObjects - The website's objects, each parent before its children
 * @returns Each object's depth, by its key
 */
function measureSavedObjectDepths(webObjects: WebObjectRecord[]): Map<string, number> {
  const keysById = new Map(webObjects.map((webObject) => [webObject.id, webObject.instancePatternKey]));
  return measureWebObjectDepths(
    webObjects.map((webObject) => ({
      instancePatternKey: webObject.instancePatternKey,
      parentInstancePatternKey:
        webObject.parentWebObjectId === null ? null : (keysById.get(webObject.parentWebObjectId) ?? null),
    })),
  );
}

/**
 * The "Objects" tab of a website's page: the WEB OBJECTS its latest crawl
 * found - the kinds of things the site has many of (Website, Action), as a
 * tree, each child object under its parent - and a link to that crawl's
 * Objects view ("From the crawl on ...").
 *
 * Under each object, "Created by runs · N" lists the record of the objects
 * of that type the website's Create actions made (see `CreatedObjectsList`),
 * so they can be cleaned up or used again; created objects whose type the
 * latest crawl no longer has are listed at the end, under "Other created
 * objects".
 *
 * Each object shows its name (and "detected as ..." when it was renamed),
 * how many instances the crawl saw and how many links it skipped, its
 * instance pattern, and each of its patterns with its page count. Its rename
 * button opens `RenameWebObjectDialog`; a saved name shows at once, and lasts
 * until the next crawl replaces the website's objects. The tab names the
 * section, so it has no heading of its own.
 *
 * It fetches the objects itself (see `useWebObjects`), when the tab is opened.
 * @param props - The owning website
 * @returns The rendered tab content
 */
export default function WebObjectsSection(props: WebObjectsSectionProps): ReactElement {
  const { websiteId } = props;
  const webObjectsResource = useWebObjects(websiteId);
  const { renamedNamesById, renameWebObject, isRenaming, renameErrorMessage } =
    useWebObjectRenaming(websiteId);
  const [webObjectBeingRenamed, setWebObjectBeingRenamed] = useState<WebObjectRecord | null>(null);
  const webObjects = webObjectsResource.data;
  const { createdObjects, errorMessage: createdObjectsErrorMessage, removeCreatedObject, isRemoving, removeErrorMessage } =
    useCreatedObjects(websiteId);
  const objectTypeKeys = new Set((webObjects ?? []).map((webObject) => webObject.instancePatternKey));
  const otherCreatedObjects = (createdObjects ?? []).filter(
    (createdObject) => createdObject.objectTypeKey === null || !objectTypeKeys.has(createdObject.objectTypeKey),
  );

  /**
   * Lists the created objects of one type.
   * @param objectTypeKey - The type's key
   * @returns Its created objects, newest first
   */
  const listCreatedObjectsOfType = (objectTypeKey: string): CreatedObjectRecord[] =>
    (createdObjects ?? []).filter((createdObject) => createdObject.objectTypeKey === objectTypeKey);

  /**
   * Removes a created object from the record.
   * @param createdObjectId - Its cuid
   */
  const handleRemoveCreatedObject = (createdObjectId: string): void => {
    void removeCreatedObject(createdObjectId);
  };
  const crawlRunOfTheObjects = webObjects?.at(0)?.crawlRun ?? null;
  const depthsByKey = measureSavedObjectDepths(webObjects ?? []);

  /**
   * Names an object the way the tab shows it: a rename saved on this visit
   * first, then its saved name, then the detected name.
   * @param webObject - The object
   * @returns The name to show
   */
  const nameWebObject = (webObject: WebObjectRecord): string =>
    chooseWebObjectName(webObject.id, webObject.name, webObject.detectedName, renamedNamesById);

  /**
   * Saves the dialog's name for the object being renamed, closing the dialog
   * when the server saved it.
   * @param name - The new name, or null for the detected name
   * @returns Resolves once the request is done
   */
  const saveRename = async (name: string | null): Promise<void> => {
    if (webObjectBeingRenamed === null) return;
    const renameWasSaved = await renameWebObject(webObjectBeingRenamed.id, name);
    if (renameWasSaved) {
      setWebObjectBeingRenamed(null);
    }
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <Typography sx={{ fontSize: 12, color: nocturneTokens.neutral[400] }}>
        The kinds of pages the latest crawl found, grouped by URL pattern.{" "}
        {crawlRunOfTheObjects !== null && (
          <Link component={RouterLink} to={crawlRunObjectsPath(websiteId, crawlRunOfTheObjects.id)}>
            From the crawl on {formatFullDateTime(crawlRunOfTheObjects.createdAt)}
          </Link>
        )}
      </Typography>

      <LoadStatusNotice
        isLoading={webObjectsResource.isLoading}
        errorMessage={webObjectsResource.errorMessage}
        loadingLabel="Loading web objects"
      />

      {webObjects !== null && webObjects.length === 0 && (
        <Typography color="text.secondary" sx={{ fontSize: 13.5 }}>
          No objects yet. Crawl the website to find them.
        </Typography>
      )}

      {webObjects !== null && webObjects.length > 0 && (
        <Box component="ul" aria-label="Web objects" sx={{ m: 0, p: 0 }}>
          {webObjects.map((webObject) => {
            const displayName = nameWebObject(webObject);
            const objectWasRenamed = displayName !== webObject.detectedName;
            const objectDepth = depthsByKey.get(webObject.instancePatternKey) ?? 0;
            return (
              <Box
                component="li"
                key={webObject.id}
                sx={{
                  listStyle: "none",
                  py: "9px",
                  pl: `${String(objectDepth * INDENT_PER_OBJECT_LEVEL_PX)}px`,
                  borderBottom: `1px solid ${nocturneTokens.rowRule}`,
                }}
              >
                <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
                  <Box sx={{ minWidth: 0, mr: "auto" }}>
                    <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, flexWrap: "wrap" }}>
                      <Typography component="h3" sx={{ m: 0, fontSize: 13.5, fontWeight: 600 }}>
                        {displayName}
                      </Typography>
                      {objectWasRenamed && (
                        <Typography component="span" sx={{ fontSize: 12, color: nocturneTokens.neutral[500] }}>
                          detected as {webObject.detectedName}
                        </Typography>
                      )}
                    </Box>
                    <Typography sx={{ fontSize: 12, color: nocturneTokens.neutral[400] }}>
                      {describeWebObjectCounts(webObject.instanceCount, webObject.skippedLinkCount)}
                    </Typography>
                  </Box>
                  <IconButton
                    size="small"
                    aria-label={`Rename ${displayName}`}
                    onClick={() => {
                      setWebObjectBeingRenamed(webObject);
                    }}
                    sx={{ p: "4px" }}
                  >
                    <EditOutlinedIcon fontSize="small" />
                  </IconButton>
                </Box>
                {listCreatedObjectsOfType(webObject.instancePatternKey).length > 0 && (
                  <Box sx={{ mt: "6px", pl: 1, borderLeft: `2px solid ${nocturneTokens.divider}` }}>
                    <Typography component="h4" sx={{ m: 0, fontSize: 12, color: nocturneTokens.neutral[400] }}>
                      Created by runs · {listCreatedObjectsOfType(webObject.instancePatternKey).length}
                    </Typography>
                    <CreatedObjectsList
                      websiteId={websiteId}
                      createdObjects={listCreatedObjectsOfType(webObject.instancePatternKey)}
                      label={`${displayName} created by runs`}
                      isRemoving={isRemoving}
                      onRemove={handleRemoveCreatedObject}
                    />
                  </Box>
                )}
                <Box component="ul" aria-label={`${displayName} patterns`} sx={{ m: 0, mt: "4px", p: 0 }}>
                  {webObject.pagePatterns.map((pagePattern) => (
                    <Box component="li" key={pagePattern.id} sx={{ listStyle: "none", py: "2px" }}>
                      <Typography sx={{ fontSize: 11.5, color: nocturneTokens.neutral[500] }}>
                        {describePagePatternRole(pagePattern.role, pagePattern.viewName)} ·{" "}
                        {formatCount(pagePattern.pageCount, "page", "pages")}
                      </Typography>
                      <Typography
                        sx={{ fontFamily: MONOSPACE_FONT_FAMILY, fontSize: 12, overflowWrap: "anywhere" }}
                      >
                        {pagePattern.key}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              </Box>
            );
          })}
        </Box>
      )}

      {otherCreatedObjects.length > 0 && (
        <Box>
          <Typography component="h3" sx={{ m: 0, fontSize: 13.5, fontWeight: 600 }}>
            Other created objects · {otherCreatedObjects.length}
          </Typography>
          <Typography sx={{ fontSize: 12, color: nocturneTokens.neutral[400] }}>
            Made by runs, of a kind the latest crawl no longer finds (or with no kind).
          </Typography>
          <CreatedObjectsList
            websiteId={websiteId}
            createdObjects={otherCreatedObjects}
            label="Other created objects"
            isRemoving={isRemoving}
            onRemove={handleRemoveCreatedObject}
          />
        </Box>
      )}
      {createdObjectsErrorMessage !== null && (
        <Alert severity="error">Could not load the created objects: {createdObjectsErrorMessage}</Alert>
      )}
      {removeErrorMessage !== null && <Alert severity="error">Could not remove it: {removeErrorMessage}</Alert>}

      <RenameWebObjectDialog
        webObject={
          webObjectBeingRenamed === null
            ? null
            : { currentName: nameWebObject(webObjectBeingRenamed), detectedName: webObjectBeingRenamed.detectedName }
        }
        isSaving={isRenaming}
        errorMessage={renameErrorMessage}
        onSave={(name) => {
          void saveRename(name);
        }}
        onCancel={() => {
          setWebObjectBeingRenamed(null);
        }}
      />
    </Box>
  );
}
