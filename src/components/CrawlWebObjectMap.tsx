import { type ReactElement, useState } from "react";
import Box from "@mui/material/Box";
import Collapse from "@mui/material/Collapse";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import CrawledPageRow from "./CrawledPageRow";
import { EditOutlinedIcon, ExpandMoreIcon } from "./icons";
import {
  type CrawlPageGroupingRecord,
  type CrawlPageGroupingWebObjectRecord,
  type CrawledPageSummaryRecord,
} from "../hooks/useCrawlRunProgress";
import { MONOSPACE_FONT_FAMILY, nocturneTokens } from "../theme/nocturneTheme";
import {
  describePagePatternRole,
  describeWebObjectCounts,
  measureWebObjectDepths,
} from "../utils/describeWebObject";
import { formatCount } from "../utils/formatCount";

/** How far each level of the object tree is indented, in px. */
const INDENT_PER_OBJECT_LEVEL_PX = 18;

/** The key the "Other pages" group is collapsed under (no pattern key starts with a space). */
const STANDALONE_GROUP_KEY = " standalone";

/** Props for `CrawlWebObjectMap`. */
export interface CrawlWebObjectMapProps {
  /** The crawl's pages grouped into web objects. */
  pageGrouping: CrawlPageGroupingRecord;
  /** The crawl's pages, to draw each grouped page's row. */
  pages: CrawledPageSummaryRecord[];
  /** The page shown in full beside the map, or null. */
  selectedPageId: string | null;
  /** Called with a page's id when the user picks it. */
  onSelectPage: (crawledPageId: string) => void;
  /** True for the phone layout. */
  isPhoneLayout: boolean;
  /** Called when the user asks to rename a web object; offered only on saved objects (`webObjectId` set). */
  onRenameWebObject: (webObject: CrawlPageGroupingWebObjectRecord) => void;
}

/** Props for `GroupHeader`. */
interface GroupHeaderProps {
  /** The group's name. */
  title: string;
  /** The line under the name (the object's pattern), or null. */
  patternKey: string | null;
  /** The counts after the name. */
  countText: string;
  /** How many levels the header is indented. */
  indentLevel: number;
  /** Whether the group's pages are shown. */
  isExpanded: boolean;
  /** Shows or hides the group's pages. */
  onToggle: () => void;
  /** Called when the rename button is clicked; null hides the button. */
  onRename: (() => void) | null;
}

/**
 * The header of one group of the Objects view: an expand / collapse button,
 * the group's name and counts, its pattern in monospace under them, and - for
 * a saved web object - a rename button.
 * @param props - The group's name, pattern, counts, indent, expanded state, and handlers
 * @returns The rendered header
 */
function GroupHeader(props: GroupHeaderProps): ReactElement {
  const { title, patternKey, countText, indentLevel, isExpanded, onToggle, onRename } = props;
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "flex-start",
        gap: "4px",
        pt: "6px",
        pb: "4px",
        pl: `${String(indentLevel * INDENT_PER_OBJECT_LEVEL_PX)}px`,
      }}
    >
      <IconButton
        size="small"
        onClick={onToggle}
        aria-expanded={isExpanded}
        aria-label={`${isExpanded ? "Collapse" : "Expand"} ${title}`}
        sx={{ p: "2px", mt: "1px" }}
      >
        <ExpandMoreIcon
          fontSize="small"
          sx={{ transform: isExpanded ? "none" : "rotate(-90deg)", transition: "transform 120ms" }}
        />
      </IconButton>
      <Box sx={{ minWidth: 0, mr: "auto" }}>
        <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, flexWrap: "wrap" }}>
          <Typography component="h3" sx={{ m: 0, fontSize: 13.5, fontWeight: 600 }}>
            {title}
          </Typography>
          <Typography component="span" sx={{ fontSize: 12, color: nocturneTokens.neutral[400] }}>
            {countText}
          </Typography>
        </Box>
        {patternKey !== null && (
          <Typography
            sx={{
              fontFamily: MONOSPACE_FONT_FAMILY,
              fontSize: 12,
              color: nocturneTokens.neutral[500],
              overflowWrap: "anywhere",
            }}
          >
            {patternKey}
          </Typography>
        )}
      </Box>
      {onRename !== null && (
        <IconButton size="small" onClick={onRename} aria-label={`Rename ${title}`} sx={{ p: "4px" }}>
          <EditOutlinedIcon fontSize="small" />
        </IconButton>
      )}
    </Box>
  );
}

/**
 * The site map's Objects view: a crawl's pages grouped into WEB OBJECTS - the
 * kinds of things the site has many of (Website, Action) - by their URL
 * patterns.
 *
 * Each object is a group, indented under its parent object: its name, how
 * many instances the crawl saw (and how many more links it skipped because
 * it already had 3 of a pattern), and its instance pattern
 * (`/websites/{website}/actions/{action}`). Inside, each of its patterns -
 * its instance page, its views (`.../edit`), its list page, its create page -
 * is labelled, with its pages under it as rows that select the page like the
 * tree's rows do. The pages that belong to no object come last, under "Other
 * pages". Every group starts expanded; its button collapses it. A saved
 * object (`webObjectId` set) also has a rename button.
 * @param props - The grouping, the pages, the selection, the handlers, and the layout
 * @returns The rendered Objects view
 */
export default function CrawlWebObjectMap(props: CrawlWebObjectMapProps): ReactElement {
  const { pageGrouping, pages, selectedPageId, onSelectPage, isPhoneLayout, onRenameWebObject } = props;
  const [collapsedGroupKeys, setCollapsedGroupKeys] = useState<ReadonlySet<string>>(new Set());
  const pagesById = new Map(pages.map((page) => [page.id, page]));
  const depthsByKey = measureWebObjectDepths(pageGrouping.webObjects);
  const standalonePages = pageGrouping.standalonePageIds.flatMap((pageId) => {
    const page = pagesById.get(pageId);
    return page === undefined ? [] : [page];
  });
  const thereAreStandalonePages = standalonePages.length > 0;

  /**
   * Shows or hides one group's pages.
   * @param groupKey - The object's key, or `STANDALONE_GROUP_KEY`
   */
  const toggleGroup = (groupKey: string): void => {
    setCollapsedGroupKeys((previousKeys) => {
      const nextKeys = new Set(previousKeys);
      if (nextKeys.has(groupKey)) {
        nextKeys.delete(groupKey);
      } else {
        nextKeys.add(groupKey);
      }
      return nextKeys;
    });
  };

  /**
   * Draws the rows of some pages, skipping ids the page list does not have.
   * @param pageIds - The pages to draw, in order
   * @param indentLevel - How many levels the rows are indented
   * @returns The rows
   */
  const renderPageRows = (pageIds: string[], indentLevel: number): ReactElement[] =>
    pageIds.flatMap((pageId) => {
      const page = pagesById.get(pageId);
      if (page === undefined) return [];
      return [
        <CrawledPageRow
          key={page.id}
          page={page}
          indentLevel={indentLevel}
          isSelected={page.id === selectedPageId}
          onSelectPage={onSelectPage}
          isPhoneLayout={isPhoneLayout}
        />,
      ];
    });

  return (
    <Box component="ul" aria-label="Web objects" sx={{ m: 0, p: 0 }}>
      {pageGrouping.webObjects.map((webObject) => {
        const objectDepth = depthsByKey.get(webObject.instancePatternKey) ?? 0;
        const isExpanded = !collapsedGroupKeys.has(webObject.instancePatternKey);
        const objectIsSaved = webObject.webObjectId !== null;
        return (
          <Box component="li" key={webObject.instancePatternKey} sx={{ listStyle: "none" }}>
            <GroupHeader
              title={webObject.displayName}
              patternKey={webObject.instancePatternKey}
              countText={describeWebObjectCounts(webObject.instanceValues.length, webObject.skippedLinkCount)}
              indentLevel={objectDepth}
              isExpanded={isExpanded}
              onToggle={() => {
                toggleGroup(webObject.instancePatternKey);
              }}
              onRename={
                objectIsSaved
                  ? () => {
                      onRenameWebObject(webObject);
                    }
                  : null
              }
            />
            <Collapse in={isExpanded} unmountOnExit>
              {webObject.patterns.map((pattern) => (
                <Box key={pattern.key}>
                  <Typography
                    sx={{
                      fontSize: 11.5,
                      color: nocturneTokens.neutral[400],
                      pt: "4px",
                      pl: `${String(8 + (objectDepth + 1) * INDENT_PER_OBJECT_LEVEL_PX)}px`,
                    }}
                  >
                    {describePagePatternRole(pattern.role, pattern.viewName)}
                  </Typography>
                  <Box component="ul" aria-label={`${webObject.displayName}: ${pattern.key}`} sx={{ m: 0, p: 0 }}>
                    {renderPageRows(pattern.pageIds, objectDepth + 1)}
                  </Box>
                </Box>
              ))}
            </Collapse>
          </Box>
        );
      })}
      {thereAreStandalonePages && (
        <Box component="li" sx={{ listStyle: "none" }}>
          <GroupHeader
            title="Other pages"
            patternKey={null}
            countText={formatCount(standalonePages.length, "page", "pages")}
            indentLevel={0}
            isExpanded={!collapsedGroupKeys.has(STANDALONE_GROUP_KEY)}
            onToggle={() => {
              toggleGroup(STANDALONE_GROUP_KEY);
            }}
            onRename={null}
          />
          <Collapse in={!collapsedGroupKeys.has(STANDALONE_GROUP_KEY)} unmountOnExit>
            <Box component="ul" aria-label="Other pages" sx={{ m: 0, p: 0 }}>
              {renderPageRows(pageGrouping.standalonePageIds, 1)}
            </Box>
          </Collapse>
        </Box>
      )}
    </Box>
  );
}
