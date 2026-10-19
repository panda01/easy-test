# AI Journal

Newest entry at the top.

---

## 2026-10-19 10:28 EDT — Structure skeletons are only built for pages whose URL could be a slug

**Intent:**
- The user asked whether the crawler strips the content from every page it visits. It did: every page with an aria snapshot also got a `structureSkeleton`. Only slug detection reads it (`clusterByStructure`), and only for URL sibling groups.
- The user wants a skeleton only where the URL already says pages could be the same object, so the skeleton just confirms that match.
- Now a page's skeleton is built only when slug detection compares it. That happens only when its URL is in a sibling group with at least `MIN_SLUG_SIBLING_COUNT` (3) values, like `/blog/a`, `/blog/b`, `/blog/c`.
- Every other page keeps `structureSkeleton = null`.
- The full `ariaSnapshot` is still stored on every page. Older crawl runs keep their skeletons. The grouping results don't change.
- Planned and approved in Plannotator (plan v2).

### Decisions
- **Made by the user (in review):**
  - **"Exact" timing:** a skeleton is built when slug detection needs it, from the snapshot kept in memory, and written onto that page's row, which may have been saved earlier. The rejected option was a one-time check at visit time against the URLs seen so far. It could miss a sibling found after the visit.
  - The end-to-end check uses the Forge Gym site.
- **Made by me:**
  - Slug detection takes a skeleton reader, and the crawl's sampler passes one that builds skeletons lazily. The final grouping and the crawl run view still read stored skeletons.
  - A sibling group with fewer than 3 values is skipped before any skeleton is read. A cluster is a subset of its group, so the results are the same.
  - The new skeletons are collected per `recordVisitedPatternPage` call, in a local list, not in a sampler field as the plan suggested. Nothing else needs them.
  - `saveCrawledPageStructureSkeletons` locks the run row first with `status: "running", deletedAt: null`, following `recordCrawledPage` and `replaceWebsiteWebObjects`. A false result stops the crawl with `stoppedBecauseRunWasDeleted`.

### Files changed
| File | Change |
|---|---|
| `server/utils/detectPagePatterns.ts` | **New:** exported type `ReadStructureSkeleton`, private `readStoredStructureSkeleton`. **Changed:** `clusterByStructure`, `collapseSlugsAtPosition`, `collapseSlugSegments` and `tokenizePages` take a `readStructureSkeleton`. `collapseSlugsAtPosition` skips groups with fewer than `MIN_SLUG_SIBLING_COUNT` values before clustering. `findConfirmedSlugPatterns` takes an optional reader, defaulting to the stored skeleton. `detectPagePatterns` passes the stored reader. JSDoc on `PatternPage.structureSkeleton` updated. |
| `server/utils/crawlPatternSampling.ts` | **New:** `CrawlPatternSampler.ariaSnapshotsAwaitingSkeleton`, types `NewStructureSkeleton` and `VisitedPatternPageOutcome`, and private `readSamplerStructureSkeleton`, which builds the skeleton, keeps it on the page, drops the snapshot and reports it. **Changed:** `createCrawlPatternSampler` creates the map. `recordVisitedPatternPage` takes the page's `ariaSnapshot` and returns `{ slugPatternsChanged, newStructureSkeletons }`. Imports `summarizePageStructure`. |
| `server/services/crawlerService.ts` | **New:** exported type `RecordStructureSkeletons` and `CrawlContext.recordStructureSkeletons`. **Changed:** `crawlWebsite` and `crawlWithPage` take a required `recordStructureSkeletons` right after `recordVisitedPage`. `sampleRecordedPage` is now async, passes the snapshot and saves any new skeletons. `crawlNextPage` stops with `stoppedBecauseRunWasDeleted` when that save returns false. `visitCrawlPage` and `buildUnreadablePageVisit` no longer set `structureSkeleton`, and the `summarizePageStructure` import is gone. JSDoc updated. |
| `server/services/dbService.ts` | **New:** `saveCrawledPageStructureSkeletons(websiteId, crawlRunId, structureSkeletons)`. **Removed:** `CrawledPageInput.structureSkeleton`, since pages are created without one. Imports the `NewStructureSkeleton` type. |
| `server/services/crawlRunService.ts` | **New:** the `recordStructureSkeletons` closure in `runCrawlInBackground`, which calls `saveCrawledPageStructureSkeletons` and is passed to `crawlWebsite`. JSDoc updated. |
| `server/prisma/schema.prisma` | Doc comment on `CrawledPage.structureSkeleton` only. Ran `npx prisma db push`, which reported the DB already in sync, and `npx prisma generate`. |
| `server/utils/summarizePageStructure.ts` | `MAX_STRUCTURE_SKELETON_CHARACTERS` doc: the skeleton is no longer stored on every page. |
| `tests/backend/utils/detectPagePatterns.test.ts` | **New specs:** the reader is called only for `/blog/a`–`/blog/c`, never for `/about`, `/pricing`, `/contact`, `/news/x`, `/news/y` or `/websites/{id}/edit`, `/settings`, `/members`. A collapse one level up still reads every sibling. |
| `tests/backend/utils/crawlPatternSampling.test.ts` | New return shape and snapshot argument. **New specs:** no skeleton until the 3rd sibling, then one for each sibling, each built once, with snapshots dropped. A sibling with no snapshot is never compared. |
| `tests/backend/services/crawlerService.test.ts` | Every `crawlWebsite` call passes the new `recordStructureSkeletons` mock. Recorded pages carry no `structureSkeleton`. The slug spec asserts the saved skeletons for `page-1`…`page-3`. **New specs:** no skeleton when siblings are too few; the crawl stops when saving the skeletons finds the run deleted. |
| `tests/backend/services/crawlRunService.test.ts` | Mocks `saveCrawledPageStructureSkeletons`. `CrawlWebsiteArguments` tuple, with the login now at index 4. New `readSkeletonRecorderPassedToCrawler`. **New spec:** the closure calls the DB and hands back true/false. |
| `tests/backend/services/dbService.test.ts` | `structureSkeleton` moved from the input fixture to the row fixture. **New specs:** run lock, then one update per page, in one transaction; nothing written when the run is gone. |
| `AI_JOURNAL.md` | This entry. |

### Verification
- **Manual end-to-end check** (manual-verifier agent, Playwright; it started `npm run dev`, and the health check and homepage sniff test passed):
  - It crawled "Forge Gym management" as "Owner with a school" with "Buttons, except risky ones", the same settings as run `cmvfbkpd80000ue8oober394r`.
  - New run `cmvfcc5o20000vk8ogqxk0bl4`: finished, 19 pages, 125.2 s.
  - **Skeletons:** only `/owner/teachers`, `/owner/students` and `/owner/payouts` have one. They are the only URL sibling group with 3 values. The other 16 pages are null. The previous run had 18.
  - **Snapshots:** all 18 successful pages still have their full `ariaSnapshot`. The failed `/document` API URL has none, as before.
  - **Grouping:** web objects, patterns and skipped counts (`/schools/{school}`: 2, `/classes/sessions/{session}`: 17) are identical to the previous run. The Objects view and the website's Objects tab show them.
  - **Errors:** no server errors. The only console error was the usual `favicon.ico` 404.
  - **Cleanup:** the dev server it started on 5180/3010 was stopped. Port 6100, a different project, was not touched.
  - The new crawl replaced Forge's saved web objects, as every crawl does. None had been renamed.
- `npm run lint`, `npm run tsc` and `npm run tsc:client`: clean.
- `npm run test:coverage`: 119 files and 2550 tests pass. All files are at 99.49% statements, 98.5% branches, 100% functions and 99.78% lines. Every changed server file is at 100%.
- The verifier's temporary files (`claude_tmp/dev.log` and its two screenshots) were removed.

---

## 2026-10-17 09:19 EDT — Crawls tab: the "Buttons" picker is back, the button sits below the pickers, and History filters by both

**Intent:**
- The user asked what happened to the crawl's button-following choice. The redesign (2026-10-13, Q2) dropped the "Buttons" picker because the mockups didn't draw it, but the server kept supporting `buttonMode`.
- The user asked for:
  - the "Crawl website" button moved below the select;
  - the button-following choice back, as a select on its own line;
  - the crawl History filtered by both selects.
- The Crawls tab is now a column: "Crawl as" (only when the login features show), then "Buttons", then "Crawl website".
  - "Buttons" is always shown. It offers "Links only (no buttons)" (the default), "Buttons, except risky ones", and "Only “Open” buttons". These are the pre-redesign labels.
  - A crawl start now sends the picked `buttonMode`.
  - History lists only the ended runs that match the picked mode and, while "Crawl as" is shown, the picked credential. The running crawl's progress card is never filtered.
  - The empty line names both picks, e.g. "No crawls as “Admin” with links only yet.". Without "Crawl as" it names only the mode: "No crawls with buttons except risky ones yet.".
- Frontend only: no server or database change, so no `prisma db push` / `generate`.

### Files changed
| File | Change |
|---|---|
| `src/components/CrawlRunsSection.tsx` | **New:** `DEFAULT_CRAWL_BUTTON_MODE` (exported, `linksOnly`), `CrawlButtonModeOption`, `CRAWL_BUTTON_MODE_OPTIONS`, `EMPTY_HISTORY_BUTTON_MODE_PHRASES`, `BUTTON_MODE_LABEL_ID`, and inside the component `handleButtonModeChange` and `pickerLabelSx`. **New props:** `selectedButtonMode`, `onSelectedButtonModeChange`. **Renamed and changed:** `describeNoCrawlsForPick` became `describeNoCrawlsForPicks(historyIsFilteredByCrawlAs, pickedCredentialIdOrNullForLoggedOut, credentials, selectedButtonMode)`, which adds the mode phrase. **Changed:** `endedRunsShownInHistory` matches both the credential (while the picker is shown) and `run.buttonMode`. The layout is a column (Crawl as, Buttons, then the button in its own row), and the `crawlButton` const is gone. JSDoc updated. |
| `src/pages/WebsiteDetailPage.tsx` | **New state:** `selectedButtonMode` / `setSelectedButtonMode` (starts at `DEFAULT_CRAWL_BUTTON_MODE`), passed to `CrawlRunsSection`. **Changed:** `startCrawl` POSTs `{ credentialId, buttonMode }`. Imports `DEFAULT_CRAWL_BUTTON_MODE` and `CrawlButtonModeRecord`. JSDoc on the page and on `startCrawl` updated. |
| `tests/frontend/CrawlRunsSection.test.tsx` | `renderSection` passes the two new props. **Changed:** the hidden-Crawl-as spec expects only the Buttons combobox; the three empty-line specs expect the "with links only" wording. **New specs:** pickers then button order (each in its own row); the Buttons default and options; handing each mode to the page; the picked mode shown and Links only picked again; **new `describe("History filtered by Buttons")`** (8 specs: mode with credential, both picks needed, mode alone without Crawl as, three empty-line wordings, the mode-only wording, the running crawl of another mode still shown). |
| `tests/frontend/WebsiteDetailPage.test.tsx` | Every crawl start's expected body adds `buttonMode: "linksOnly"`. The default-start spec is renamed to say "following links only by default". "No crawls as “Editor” with links only yet." **New specs:** crawls with the mode picked in Buttons (`openOnly` in the POST); History narrowed by the Buttons pick, with its empty line. The no-login spec also checks that Buttons is still shown. |
| `README.md`, `src/components/README.md`, `src/pages/README.md` | Describe the Buttons dropdown, the column layout, and History filtered by both picks. The README no longer says the redesign has no picker. |

### Verification
- **Manual check (manual-verifier agent, Playwright, on the already-running dev server; health check and homepage sniff test OK):**
  - Layout checked at 1440 px and 390 px, with and without Crawl as. No horizontal overflow on a phone.
  - The Buttons default and option order are right.
  - The POST bodies carried the picked `buttonMode`, and the stored runs matched.
  - History counts matched the API data for every Crawl as × Buttons combination on a real website.
  - The empty-line wording is right.
  - No console errors.
  - A temporary website pointing at a local static page (`claude_tmp/site`) got one crawl per mode. It was soft-deleted afterwards.
  - Screenshots are in `claude_tmp/verify/`.
- After the manual check, lint flagged an unnecessary `as CrawlButtonModeRecord` in `handleButtonModeChange`. It was removed; this is a type-only change with the same runtime behavior.
- `npm run lint` and `npm run tsc:client` are clean.
- `npm run test:coverage`: 119 files and 2540 tests pass. All files are at 99.49% statements, 98.49% branches, 100% functions, and 99.78% lines. `CrawlRunsSection.tsx` is at 100% of lines and branches.

---

## 2026-10-16 23:40 EDT — Crawls recognise URL patterns and group pages into web objects

**Intent:**
- The user wants crawling to recognise pages that share a URL pattern. In this app every website is `/websites/<id>` and each of its actions is `/websites/<id>/actions/<id>`.
- Pages like that should be grouped, and each group identified as a kind of web object (Website, Action) by what its pages have in common.
- Planned and approved in Plannotator (plan v4).

### Decisions
- **Made by the user (in review):**
  - Group the pages AND sample: a crawl visits at most 3 pages per pattern.
  - Web objects are saved per website and can be renamed.
  - Patterns are detected from id shapes, plus slugs confirmed by 3+ sibling pages built alike.
  - The view is a Tree / Objects toggle on the crawl run page's site map, plus an Objects tab on the website page.
  - Every crawl is fresh: nothing from an earlier crawl is used.
  - The latest crawl replaces the saved objects, renames included.
  - Changing which pages Claude is shown is a follow-up, not part of this change.
- **Made by me:**
  - **`sortOrder` columns** on `web_objects` and `page_patterns`: every row of one replacement shares one `createdAt`, so detection order needs its own column.
  - **`CrawlRun.skippedSimilarUrlCountsByPattern` (JSON)** next to the planned `skippedSimilarUrlCount`, so each object can show its own "N more skipped". Both are written when the crawl finishes, so they stay 0 / `{}` while it runs.
  - **A slug is never the segment right after a variable**, as well as never the first segment. So `/projects/{id}/settings` and `/projects/{id}/members` stay different pages and are not sampled away.
  - **The 3-page cap is per pattern key across the whole crawl**, not per parent instance.
  - **`new`, `create`, and `add`** right after an object's list segment count as its create page.
  - **`replaceWebsiteWebObjects` locks the crawl run row first** (it updates `updatedAt`), like `recordCrawledPage`, so it cannot write active rows for a run deleted with its website.
  - **The Objects tab fetches its own data**, when it is opened.
  - **Names that differ from the plan:**
    - `validateWebObjectRenameInput` (the plan had `validateWebObjectInput`);
    - `findWebObjectNamesForCrawlRun` (the plan had `findWebObjectsForCrawlRun`).
  - **Modules the plan did not list:** `crawlPatternSampling.ts`, `webObjectService.ts`, `CrawledPageRow.tsx` (the page row, now shared by the Tree and Objects views), and `describeWebObject.ts`.

### Files changed
| File | What changed |
|---|---|
| `server/prisma/schema.prisma` | **New models** `WebObject` (`web_objects`) and `PagePattern` (`page_patterns`), each with a partial unique key among active rows and `sortOrder`. **New columns** `CrawledPage.structureSkeleton`, `CrawlRun.skippedSimilarUrlCount`, and `CrawlRun.skippedSimilarUrlCountsByPattern`. **Back-relations** on `Website` and `CrawlRun`. Doc comments updated. `prisma format` also realigned some existing columns. Ran `npx prisma db push` and `npx prisma generate`. |
| `server/utils/classifyPathSegment.ts` | **New.** `classifyPathSegment` returns `uuid`, `number`, `ulid`, `cuid`, `hex`, `opaqueToken`, or null. Helpers `readsLikeDashedWords` and `looksLikeOpaqueToken`. Type `IdSegmentShape`. |
| `server/utils/summarizePageStructure.ts` | **New.** `summarizePageStructure` reduces an aria snapshot to a role skeleton: roles plus heading levels, repeated sibling subtrees collapsed, capped at `MAX_STRUCTURE_SKELETON_CHARACTERS`. `compareStructureSkeletons` gives the Jaccard similarity of role paths. Helpers `readEntryLabel`, `readSnapshotEntries`, `buildStructureTree`, `renderCollapsedNodes`, `joinWithinTheCap`, `listRolePaths`. |
| `server/utils/detectPagePatterns.ts` | **New.** `detectPagePatterns` groups pages into web objects with instance, view, collection, and create patterns, plus standalone pages. Also exported: `findConfirmedSlugPatterns`, `patternKeyForPath`, `matchPagePattern`, `readPathSegments`, `tokenizePathSegments`, `buildPathSegments`, `formatPatternKey`, `formatTokensAsPatternKey`, `parsePatternKey`, `singularizeWord`, `MIN_SLUG_SIBLING_COUNT`, `STRUCTURE_SIMILARITY_THRESHOLD`. Types `PathSegment`, `PathToken`, `PatternPage`, `DetectedPagePattern`, `DetectedWebObject`, `DetectedPageGrouping`, `PagePatternRole`, `PatternDetectionMethod`, `VariableValueShape`. |
| `server/utils/crawlPatternSampling.ts` | **New.** Per-crawl sampling: `MAX_PAGES_PER_PATTERN` (3), `createCrawlPatternSampler`, `claimPatternSlot`, `recordVisitedPatternPage`, `dropOverSampledQueueEntries`, `summarizeSkippedLinks`. Types `CrawlPatternSampler` and `SkippedLinkSummary`. |
| `server/services/crawlerService.ts` | `CrawlOutcome` gained `skippedSimilarUrlCount` and `skippedSimilarUrlCountsByPattern`. `CrawlState` gained `patternSampler`. `visitCrawlPage` and `buildUnreadablePageVisit` record `structureSkeleton`. **New** `claimSeenPageSlot` and `sampleRecordedPage`. `claimUnseenLinks`, `claimUnseenButtonLinks`, `crawlNextPage`, and `crawlWithPage` now sample (the start page is always visited). JSDoc on `crawlWebsite` updated. |
| `server/services/dbService.ts` | `CrawledPageInput.structureSkeleton` and `CrawlRunFinish.skipped*`. `softDeleteWebsite` also stamps page patterns and web objects (twelve tables). **New:** `replaceWebsiteWebObjects`, `listWebObjectsForWebsite`, `findWebObjectNamesForCrawlRun`, `renameWebObject`, `WEB_OBJECT_INCLUDE`, and types `PagePatternInput`, `WebObjectInput`, `WebObjectCrawlRunSummary`, `WebObjectWithPatterns`, `WebObjectName`. `WebObject` and `PagePattern` are re-exported. |
| `server/services/webObjectService.ts` | **New.** `buildCrawlPageGrouping` (detection joined with the same run's saved ids and names), `readSkippedLinkCounts`, `buildWebObjectInputs`, and `saveCrawlWebObjects` (never rejects). Types `CrawlPageGrouping`, `CrawlPageGroupingWebObject`, `CrawlPageGroupingPattern`. |
| `server/services/crawlRunService.ts` | `runCrawlInBackground` passes the skipped counts to `finishCrawlRun`. When the run was finished and recorded at least one page, it then calls `saveCrawlWebObjects`. `recordCrawlFailure` writes zero skips. |
| `server/controllers/crawlRuns.ts` | The GET run route adds `pageGrouping` and leaves `structureSkeleton` off the pages (new `omitStructureSkeleton`). JSDoc updated. |
| `server/controllers/webObjects.ts` | **New** `registerWebObjectRoutes`: `GET /api/websites/:websiteId/web-objects` and `PUT /api/websites/:websiteId/web-objects/:webObjectId`. |
| `server/utils/validateRequestBodies.ts` | **New** `validateWebObjectRenameInput`, `MAX_WEB_OBJECT_NAME_LENGTH` (100), and `WebObjectRenameInput`. |
| `server/server.ts` | Registers the web object routes. |
| `src/hooks/useCrawlRunProgress.ts` | **New types:** `PagePatternRoleRecord`, `PatternDetectionMethodRecord`, `CrawlPageGroupingPatternRecord`, `CrawlPageGroupingWebObjectRecord`, `CrawlPageGroupingRecord`. `CrawlRunWithPagesRecord.pageGrouping`. |
| `src/hooks/useCrawlRuns.ts` | `CrawlRunRecord.skippedSimilarUrlCount` and `skippedSimilarUrlCountsByPattern`. |
| `src/hooks/useWebObjects.ts` | **New.** `useWebObjects`, `useWebObjectRenaming`, and types `WebObjectRecord`, `PagePatternRecord`, `WebObjectCrawlRunRecord`, `WebObjectRenaming`. |
| `src/utils/describeWebObject.ts` | **New.** `describePagePatternRole`, `describeWebObjectCounts`, `chooseWebObjectName`, `measureWebObjectDepths`, and type `WebObjectTreeFields`. |
| `src/utils/routePaths.ts` | **New** `crawlRunObjectsPath`, `webObjectsApiUrl`, `webObjectApiUrl`. |
| `src/components/icons.tsx` | Adds `EditOutlinedIcon` and `ExpandMoreIcon`. |
| `src/components/CrawledPageRow.tsx` | **New.** The site map's page row, moved out of `CrawlSiteMap`, plus `INDENT_PER_TREE_LEVEL_PX`. |
| `src/components/CrawlSiteMap.tsx` | Optional `objectsView` prop (type `CrawlSiteMapObjectsView`) with a Tree / Objects `ToggleButtonGroup`. Type `CrawlSiteMapView`. **New** `handleViewChange`. Rows drawn with `CrawledPageRow`. |
| `src/components/CrawlWebObjectMap.tsx` | **New.** The Objects view: collapsible object groups indented under their parents, pattern labels, page rows, rename button, and "Other pages". Internal `GroupHeader`. |
| `src/components/RenameWebObjectDialog.tsx` | **New.** Rename dialog with "Use detected name", Cancel, and Save. It shows an error only after this opening tried to save. `MAX_WEB_OBJECT_NAME_LENGTH`, internal `RenameWebObjectForm`. |
| `src/components/WebObjectsSection.tsx` | **New.** The website page's Objects tab, with `measureSavedObjectDepths`. |
| `src/pages/CrawlRunPage.tsx` | `?view=objects` (new `VIEW_QUERY_PARAMETER`, `chooseSiteMapView`, `changeSiteMapView`). `selectPage` keeps the other query parameters. Renames are applied at once (`applyRenames`, `EMPTY_PAGE_GROUPING`, `saveRename`, rename dialog). The ended status line adds "· N similar pages skipped". |
| `src/pages/WebsiteDetailPage.tsx` | New `objects` tab (`WebsiteTab`, `TAB_LABELS`, `credentialsTabs`, `panelTabs`, `availableTabs`). Side panel label "Crawls, objects, screenshots, and credentials". |
| Tests: **new** | `tests/backend/utils/{classifyPathSegment,summarizePageStructure,detectPagePatterns,crawlPatternSampling}.test.ts`, `tests/backend/services/webObjectService.test.ts`, `tests/backend/api/webObjects.test.ts`, `tests/frontend/{CrawlWebObjectMap,RenameWebObjectDialog,WebObjectsSection,useWebObjects,describeWebObject}.test.tsx`. |
| Tests: **updated** | `crawlerService.test.ts` (new outcome fields and skeleton; sampling, slug-confirmation, fresh-crawl, start-page, and button-sampling cases), `crawlRunService.test.ts` (`webObjectService` mocked; save-after-finish cases), `dbService.test.ts` (web object and page pattern delegates, the twelve-table cascade, web object functions), `crawlRuns.test.ts` (`pageGrouping`), `validateRequestBodies.test.ts`, `CrawlRunPage.test.tsx`, `CrawlSiteMap.test.tsx`, `WebsiteDetailPage.test.tsx` (new tab lists and the Objects tab), `routePaths.test.tsx`, and `frontendTestHelpers.tsx` (new builders, plus the new fields in the defaults). No test was removed or skipped. |
| `AI_JOURNAL.md` | This entry. |

### Verification
- **Manual end-to-end check** (manual-verifier agent, Playwright, dev servers on 5180 and 3010): it crawled the "easy-test dev" website, which is this app, twice, after adding 5 temporary `[verify]` actions.
  - **Grouping:** Website, Action, Crawl run, and Use case were found with the right parents and the right instance, view, and create pages.
  - **Sampling:** no pattern had more than 3 pages. 16 links were skipped and shown as "· 16 similar pages skipped".
  - **Objects view:** works, and `?view=objects` / `?page=` survive selecting a page and a reload. Groups collapse and expand.
  - **Renaming:** works from both the crawl run page and the Objects tab.
  - **API validation:** 400 and 404 where expected.
  - **Second crawl:** it replaced the objects and dropped the rename. The first run's view still groups its pages, without rename buttons, and its old rows are soft-deleted in Postgres.
  - **Phone layout:** checked at 390 px.
  - **Errors:** no console or server errors apart from an unrelated `favicon.ico` 404.
  - **Cleanup:** the `[verify]` actions were soft deleted afterwards, and the dev servers were stopped.
  - **Cosmetic note:** after saving a rename, MUI logs an "aria-hidden ... retained focus" warning while the dialog closes.
- `npm run test:coverage`: 119 files, 2525 tests, all passing. All files: 99.49% lines, 98.49% branches, 100% functions.
- `npm run lint`, `npm run tsc`, and `npm run tsc:client`: clean.
- The temporary `claude_tmp/try-detect.mts`, plus the verifier's `run1.json` and `dev.log`, were removed. `claude_tmp/phone-objects.png` was kept.

---

## 2026-10-16 16:14 EDT — Droplet test harness moved to `~/Projects/helpers`, plus a one-command runner and a handoff note

**Intent:**
- The user moved `setup-droplet.sh` into its own repo, `~/Projects/helpers`. They asked for:
  - the test files to move there too;
  - a short handoff note so a future AI can use the script ("keep it simple": the script is already well commented).

### Decisions
- **Made by the user:** move the test harness to `~/Projects/helpers`, and add a simple handoff.
- **Made by me:**
  - The harness goes in `~/Projects/helpers/droplet-test/`.
  - A new `run-test.sh` does the whole Docker routine in one command. Earlier entries ran those steps by hand.
  - The handoff note is `HANDOFF.md` in the helpers root.
  - The old run logs (`run1.log` to `run4.log`) stay in `claude_tmp/droplet-test/`, since the entries below refer to them.

### Files changed
| File | What changed |
|---|---|
| `claude_tmp/droplet-test/` (easy-test) | **Moved out** to `~/Projects/helpers/droplet-test/`: `Dockerfile`, `run-setup.exp`, `check.sh`, `net-check.sh`. Only the run logs remain (`run1.log` to `run7.log`). |
| `~/Projects/helpers/droplet-test/run-test.sh` | **New**. Builds the image, starts the droplet and client containers and runs shellcheck on `setup-droplet.sh`. Then it does the first run and `check.sh`. Next it sets up a stand-in app behind nginx, waits for it to answer inside the droplet, and runs `net-check.sh` from the client. Finally it puts back the old `allow OpenSSH` rule, re-runs the script and runs `check.sh` again. An `EXIT` trap removes the containers, network and image. **Function:** `remove_test_containers()`. **Readonly settings:** `test_dir`, `setup_script`, `image_name`, `network_name`, `droplet_container`, `droplet_host_name`, `client_container`. **Variables:** `node_path`, `app_answers_through_nginx`. |
| `~/Projects/helpers/droplet-test/check.sh` | Now ends with `[[ "$failures" -eq 0 ]]`, so it exits 1 when any check fails. |
| `~/Projects/helpers/droplet-test/net-check.sh` | Same exit-code line. The unused loop variable `attempt_number` became `_` (shellcheck SC2034). |
| `~/Projects/helpers/HANDOFF.md` | **New**. Covers how to run the script on a droplet, what the firewall lets in, how to test a change, what each test file does, and what the test doesn't cover. |
| `AI_JOURNAL.md` | This entry. |

`setup-droplet.sh` was not changed. The helpers copy is byte-identical (`cmp`) to the one tested at 16:01.

### Verification
- **shellcheck** (in the test image): `run-test.sh` is clean. `net-check.sh` shows only SC2016 "info" notes, about check strings in single quotes that `eval` expands later on purpose.
- **First run of `run-test.sh`** (`run5.log`): exit 1. The outside `/app/` check failed and everything else passed.
  - Cause: `systemctl reload nginx` returns before nginx loads the new config, and the outside request came in before that. The manual run had waited 1 second.
  - Fix: `run-test.sh` waits up to 10 seconds for `/app/` to answer inside the droplet before `net-check.sh` runs.
- **`run6.log`:** exit 0.
- **`run7.log`, after the SC2034 fix, on the final files:** exit 0 and 61 PASS lines:
  - `check.sh` 27/27 after the first run;
  - `net-check.sh` 7/7: 7 quick SSH logins gave `ok ok ok ok ok refused refused`;
  - `check.sh` 27/27 after the re-run, where ufw printed "Rule updated" for the old rule.
- **Cleanup:** no `droplet` containers, network or image were left after each run. No servers were left running.

---

## 2026-10-16 16:01 EDT — `setup-droplet.sh`: ufw denies incoming by default, SSH is rate-limited

**Intent:**
- The user asked, following DigitalOcean's UFW tutorial, for these firewall changes without breaking nginx or SSH:
  - ufw explicitly denies incoming connections by default;
  - SSH is rate-limited ("limit ssh as well").
- The user also asked for the change to be checked in the Docker container, including that SSH still logs in.

### Decisions
- **Made by the user:**
  - `ufw default deny incoming`.
  - SSH gets `ufw limit` instead of `ufw allow`.
  - Verify in the Docker container, including SSH.
- **Made by me:**
  - Added `ufw default allow outgoing` too, as in the tutorial, so apt, nvm and git keep working.
  - Order: the SSH and nginx rules come first, then the default policies, then `ufw --force enable`. If the script is re-run with ufw already on, SSH and nginx already have rules by the time incoming connections are denied.
  - nginx stays `allow 'Nginx Full'` (80 and 443) with no rate limit.

### Files changed
| File | What changed |
|---|---|
| `setup-droplet.sh` | **Changed:** `run_new_user_phase()`, step 5 (firewall). `sudo ufw allow OpenSSH` is now `sudo ufw limit OpenSSH`. It turns away an address that opens 6 or more connections in 30 seconds. **Added** `sudo ufw default deny incoming` and `sudo ufw default allow outgoing`, after the SSH and nginx rules and before `ufw --force enable`. **Changed:** the header's step 5 description and the step's comments. These now explain the limit, the defaults, and that localhost traffic and replies are still let in. No functions or settings were added or removed. |
| `AI_JOURNAL.md` | This entry. |

No application code, tests or config were changed, so `npm run lint` and `npm run test:coverage` were not run.

### Verification
- `bash -n` passes, and `shellcheck` (inside the container) is clean.
- **Setup:** a fresh `ubuntu:26.04` (arm64) container with systemd, `--privileged`, hostname `test-droplet`. A second container from the same image sat on the same Docker network as the "outside" computer. Harness: `claude_tmp/droplet-test/`.
  - `check.sh` was updated. The SSH rule must be `LIMIT` (v4 and v6) with no `ALLOW` left. Nginx Full must be `ALLOW` (v4 and v6). The defaults must be `deny (incoming), allow (outgoing)`.
  - `net-check.sh` is **new**. It runs from the outside container.
  - Logs: `run3.log` (first run) and `run4.log` (re-run).
- **First run:** exit 0.
  - `ufw status verbose`:
    - `Default: deny (incoming), allow (outgoing), deny (routed)`;
    - `22/tcp (OpenSSH) LIMIT IN Anywhere` (and v6);
    - `80,443/tcp (Nginx Full) ALLOW IN Anywhere` (and v6).
  - `check.sh`: 27/27 pass.
  - **Test-only setup:** a stand-in Node app on `0.0.0.0:3000`, and an nginx `location /app/` that proxies to `127.0.0.1:3000`. These were in the container only, not in the script.
  - **From the outside container** (`net-check.sh`, 8/8 pass):
    - Port 80 serves the nginx welcome page, and `/app/` reaches the app through nginx.
    - Port 3000 directly times out.
    - `ssh panda01@test-droplet` logs in with the key.
    - Of 7 quick SSH logins, the first 5 work and the 6th and 7th are refused. Port 80 still works at that time.
    - SSH logs in again after 30 seconds.
  - **Control:** with `ufw disable`, port 3000 answered from outside. With ufw back on, it timed out. So the default deny is what blocks it.
- **Re-run, upgrading a droplet set up by the old script:**
  - The test first put back the old `ufw allow OpenSSH` rule, then re-ran the script. Exit 0, and no new-password prompt.
  - ufw printed "Rule updated", which turned `ALLOW` into `LIMIT`.
  - `check.sh` 27/27 and `net-check.sh` 8/8 pass again.
- **Reboot** (`docker restart`): ufw is still active with the same defaults and rules. `ssh panda01@test-droplet` from outside works, and port 80 serves nginx.
- **Not verified:**
  - A real droplet, or x86_64.
  - Port 443 is only checked as a rule. nginx has no certificate yet, so nothing listens on 443.
  - DigitalOcean's cloud firewall, if one is attached, is separate and wasn't touched.
- **Cleanup:** both containers, the `droplet-test-net` network and `droplet-test-image` were removed. No servers were left running.

---

## 2026-10-16 14:24 EDT — `setup-droplet.sh`: undid the "no asterisks at sudo's prompt" change

**Intent:**
- Undo the 14:00 change (the entry below), as the user asked. sudo's password prompt shows `*` per character again, which is Ubuntu 26.04's sudo-rs default.

### Decisions
- **Made by the user:** undo the change.
- **Made by me:** the 14:00 entry stays as history, and this entry records the undo.

### Files changed
| File | What changed |
|---|---|
| `setup-droplet.sh` | **Removed:** the readonly setting `sudo_no_password_feedback_file`; from `run_root_phase`, the step that wrote `Defaults !pwfeedback` to `/etc/sudoers.d/no-password-feedback` (and its local `sudoers_draft`); the "stop sudo from showing *" wording in header step 2. The script is back to the 13:44 version. |
| `AI_JOURNAL.md` | This entry. |

### Verification
- `bash -n` passes, `shellcheck` is clean, and `grep` finds no `pwfeedback`, `sudoers`, `visudo` or "asterisk" left in the script.
- **Docker** (fresh `ubuntu:26.04` arm64 container with systemd, the same harness):
  - The first run exits 0.
  - The log shows `[sudo: authenticate] Password: ***************` again.
  - `/etc/sudoers.d/` holds only `README`.
  - The 23 original checks in `check.sh` pass. Its 2 sudoers checks were removed.
- **Cleanup:** the test container and `droplet-test-image` were removed. No servers were left running.

---

## 2026-10-16 14:00 EDT — `setup-droplet.sh`: no asterisks at sudo's password prompt

**Intent:**
- The user saw `*` for every character at the sudo password prompt and asked for even that to be hidden.
- The cause: Ubuntu 26.04's sudo is sudo-rs, which turns on `pwfeedback` (asterisks) by default. The `passwd` prompts were already silent.

### Decisions
- **Made by the user:** no typing feedback at all at the password prompt.
- **Made by me:**
  - Add a sudoers drop-in, `/etc/sudoers.d/no-password-feedback`, containing `Defaults !pwfeedback`.
  - It is checked with `visudo -c -f` before it is installed, then installed 440 root:root.
  - It is written in the root half before the `su -` handoff, so the first sudo prompt is already silent.
  - It applies to every sudo user on the droplet.

### Files changed
| File | What changed |
|---|---|
| `setup-droplet.sh` | **New readonly setting:** `sudo_no_password_feedback_file`. **Changed `run_root_phase`:** a new step after `usermod` writes `Defaults !pwfeedback` to a `mktemp` draft (new local `sudoers_draft`), checks it with `visudo -c -f`, installs it with mode 440, and deletes the draft. Header step 2 updated. |
| `AI_JOURNAL.md` | This entry. |

### Verification
- `bash -n` passes, and `shellcheck` is clean.
- **Docker** (`ubuntu:26.04` arm64 with systemd, the same harness as the entry below, run from a fresh container):
  - **First run:** exit 0. The log shows `[sudo: authenticate] Password: ` with nothing after it (before this change: `***************`). `visudo` printed "parsed OK". All 25 checks in `check.sh` pass, including 2 new ones: the drop-in is 440 root:root, and `visudo -c` passes for the whole sudo config.
  - **Second run:** exit 0. Still no asterisks; the skip paths are unchanged; 25/25 checks pass.
- **Not verified:** on a real droplet.
- **Cleanup:** the test container and `droplet-test-image` were removed. No servers were left running.

---

## 2026-10-16 13:44 EDT — `setup-droplet.sh`: first-boot setup for a DigitalOcean Ubuntu 26.04 droplet

**Intent:**
- Give the user one script to run as root on a fresh DigitalOcean Ubuntu 26.04 droplet, as they asked. It:
  - creates `panda01`, asks for its password, gives it sudo, and copies root's `authorized_keys` to it;
  - switches to `panda01` with `su -` and, using sudo, installs nginx and turns on ufw (OpenSSH, plus nginx from anywhere);
  - installs nvm and Node 26 as `panda01`;
  - creates a GitHub SSH key and prints its public half to add to the repo.
- Every line of the script is explained in a comment, as the user asked.

### Decisions
- **Made by the user** (answered in Plannotator, plan v1, then approved in v2):
  - The GitHub key has no passphrase (`-N ""`), so the server can `git pull` without anyone there.
  - The key file is the default `~/.ssh/id_ed25519`, so a plain `git clone git@github.com:...` uses it with no `~/.ssh/config`.
  - The script lives in the repo root next to `stop-dev.sh`, left uncommitted.
  - Verification is a Docker `ubuntu:26.04` container with systemd.
- **Made by me** (listed in the approved plan):
  - Firewall rules: `ufw allow OpenSSH` (port 22) and `ufw allow 'Nginx Full'` (80 and 443).
  - The key label is `panda01@$(hostname)`.
  - GitHub's published ed25519 host key goes into `known_hosts`.
  - A `curl http://localhost` check runs after nginx is installed.
  - Re-runs skip the user, password, key and `authorized_keys` when they already exist.
- **Found while testing:**
  - `su - user -c` (util-linux) runs the command with no terminal, so sudo stopped with "A terminal is required to authenticate". It is now `su --pty - panda01 -c ...`, still the `su -` login the user asked for.
  - Ubuntu 26.04 ships `sudo-rs` and Rust coreutils. The script works with both.
- **Open, asked the user:** whether to add `libatomic1` to the script's `apt-get install` line as a safeguard (see Verification).
- **Not changed:** `package.json` still pins `"engines": { "node": "=25.4.0" }`. On Node 26, `npm install` prints an EBADENGINE warning (only a warning unless `engine-strict` is set).

### Files changed
| File | What changed |
|---|---|
| `setup-droplet.sh` | **New**, executable. **Functions:** `run_root_phase(this_script_path)` (checks, `useradd`, `passwd` retry loop, `usermod -aG sudo`, `authorized_keys` copy, copies itself to panda01's home, the `su --pty -` handoff, a cleanup `trap`) and `run_new_user_phase()` (apt/nginx, `systemctl enable --now nginx` plus a `curl` check, ufw, nvm `v0.40.8`, Node 26 plus a version check, `ssh-keygen`, `known_hosts`, the printed key and steps). **Readonly settings:** `new_username`, `new_user_home`, `new_user_script_copy`, `as_new_user_flag`, `root_authorized_keys`, `nvm_version`, `node_major_version`, `github_key_file_name`, `github_host_key_line`. JSDoc-style header and function comments. |
| `AI_JOURNAL.md` | This entry. |

No application code, tests or config were changed, so `npm run lint` and `npm run test:coverage` were not run.

### Verification
- `bash -n` passes, and `shellcheck` (run inside the container) is clean.
- **Docker:** an `ubuntu:26.04` (arm64) container with systemd as PID 1, `--privileged`, and the packages a droplet ships. The script ran as root under `expect`, which typed the password at each prompt. Files are in `claude_tmp/droplet-test/` (`Dockerfile`, `run-setup.exp`, `check.sh`, `run1.log`, `run2.log`).
  - **First run:** exit 0. All 23 checks in `check.sh` pass:
    - user, shell, sudo group and password;
    - `authorized_keys` identical to root's, 700/600, owned by panda01;
    - sudo works;
    - nginx active, enabled and serving its welcome page;
    - ufw active at boot with OpenSSH and Nginx Full from Anywhere (v4 and v6);
    - `node -v` is v26.12.0 in a login shell, with npm 11.20.0;
    - ed25519 key with no passphrase, mode 600, label `panda01@test-droplet`;
    - GitHub's host key in `known_hosts`, and `ssh -T git@github.com` reaches GitHub with no host prompt ("Permission denied (publickey)", as expected before the key is added);
    - the script's copy in panda01's home removed.
  - **Second run:** exit 0. No new-password prompt, only sudo's. The key, `authorized_keys` and `known_hosts` are unchanged. ufw says "Skipping adding existing rule". 23/23 checks still pass.
  - **Refusals:** not root, run through `cat | bash`, and no root `authorized_keys` each exit 1 with a clear message.
- **Test-image fixes** (the test image, not the script), to match a real droplet:
  - Added `openssh-server`, which provides the `OpenSSH` ufw profile.
  - Added `libatomic1`. Node's official x64 and arm64 builds both need `libatomic.so.1` (`readelf -d` on `node-v26.12.0-linux-x64`). Ubuntu's published 26.04 amd64 server cloud-image manifest includes `libatomic1`, but the bare Docker base image doesn't.
- **Not verified:**
  - On a real droplet or on x86_64 (this Mac's Docker runs arm64 only).
  - The GitHub deploy-key login itself (needs the key added to a repo).
- **Cleanup:** the test container, `droplet-test-image` and the `ubuntu:26.04` base image (not on this Mac before) were removed. No servers were left running. Docker's build cache from these builds remains.

---

## 2026-10-15 11:22 EDT — Centered fixed-width pages, crawl History filtered by "Crawl as", a plus on every create button

**Intent:**
- Center the home page, and any page whose content has a fixed width, as the user asked.
- On the website page, filter the Crawls tab's History by the "Crawl as" dropdown.
- Put a plus ("+") on every button that creates something new.

### Decisions
- **Made by the user** (answered in Plannotator, plans v1–v5, then approved):
  - The header stays full width; only page content is centered.
  - The running crawl's progress card always shows, whoever it runs as, so the disabled "Crawl website" button stays explained.
  - Crawls made as a since-deleted credential stay hidden while the picker is shown, since they match no option.
  - When nothing matches the pick, History says "No logged-out crawls yet." or "No crawls as “<name>” yet."
  - The create forms' submit buttons ("Create website", "Create credential", "Create use case", "Create action") also get the plus. The run-starting buttons ("Crawl website", "Take screenshot") do not.
- **Made by me** (from the plan):
  - Center `PageContainer` with `mx: "auto"`. Only a capped frame (the dashboard's 1080 px) moves; the full-width pages look the same. The nine `<Container>` pages were already centered.
  - The filter is client side only; there is no server or schema change.
  - With the picker hidden there is nothing to filter by, so History lists every ended run.
  - The edit forms keep their plus-less "Save changes" through a new opt-in prop, `submitButtonShowsPlus`.
  - "New action" now shows its plus on a phone too ("anywhere").

### Files changed
| File | What changed |
|---|---|
| `src/components/PageContainer.tsx` | **Changed:** `PageContainer` adds `mx: "auto"` to its `sx`, so a frame capped by `maxWidth` is centered. JSDoc rewritten (no longer "left-aligned"). |
| `src/components/CrawlRunsSection.tsx` | **New:** private `describeNoCrawlsForPick(pickedCredentialIdOrNullForLoggedOut, credentials)`, which returns "No logged-out crawls yet.", "No crawls as “X” yet." or "No crawls as the picked credential yet.". **New derived values in `CrawlRunsSection`:** `pickedCredentialIdOrNullForLoggedOut`, `historyIsFilteredByCrawlAs`, `endedRunsShownInHistory`, `thereAreEndedRunsShownInHistory`, `theFilterHidesEveryEndedRun`, `noMatchingCrawlsText`. **Changed:** History renders `endedRunsShownInHistory`, with the empty-filter line in its place when the filter hides every ended run. JSDoc on the component and on the `crawlAsPickerIsShown` / `selectedCredentialId` props updated. |
| `src/components/WebsiteItemListSection.tsx` | **Changed:** the `newItemButton` `startIcon` is always `<AddIcon />` (it used to be actions-only and desktop-only). JSDoc updated. |
| `src/components/CredentialsSection.tsx` | **Changed:** imports `AddIcon`; the "New credential" button gets `startIcon={<AddIcon />}`. JSDoc updated. |
| `src/components/WebsiteForm.tsx`, `src/components/CredentialForm.tsx`, `src/components/TitleDescriptionForm.tsx` | **New prop:** `submitButtonShowsPlus?: boolean` (default `false`) on `WebsiteFormProps`, `CredentialFormProps` and `TitleDescriptionFormProps`. **Changed:** each imports `AddIcon`; the submit `Button` gets `startIcon={submitButtonShowsPlus ? <AddIcon /> : undefined}`. JSDoc updated. |
| `src/pages/WebsiteCreatePage.tsx`, `src/pages/CredentialCreatePage.tsx`, `src/pages/WebsiteItemCreatePage.tsx` | **Changed:** each passes `submitButtonShowsPlus` to its form. JSDoc notes the plus. |
| `src/components/README.md` | The `PageContainer` row says a capped frame is centered. |
| `tests/frontend/sharedRedesignComponents.test.tsx` | **New spec:** `PageContainer` centers a capped frame (`marginLeft` / `marginRight` `auto`). |
| `tests/frontend/CrawlRunsSection.test.tsx` | **New `describe("History filtered by Crawl as")`** (9 specs): Logged out lists only logged-out runs; a credential lists only its runs; a hidden picker lists every run; a deleted credential's run stays hidden; the two empty-filter lines and the fallback line; nothing about the pick while the only crawl is still running; the running card still shows for another person's crawl. **Changed:** "words a history row…" now renders with `crawlAsPickerIsShown: false`, so it can mix credentials. |
| `tests/frontend/WebsiteDetailPage.test.tsx` | **New spec:** picking a credential in Crawl as narrows the History, and an unmatched pick shows "No crawls as “Editor” yet.". **Changed:** the credentials spec also checks the plus on "New credential". |
| `tests/frontend/WebsiteItemListSection.test.tsx` | **New `it.each`:** the plus on the New button, on desktop and on a phone, for both kinds. |
| `tests/frontend/WebsiteForm.test.tsx`, `tests/frontend/CredentialForm.test.tsx`, `tests/frontend/TitleDescriptionForm.test.tsx` | **New specs:** a plus with `submitButtonShowsPlus`, and none by default ("Save changes"). `within` is imported where it was missing. |
| `tests/frontend/WebsiteCreatePage.test.tsx`, `tests/frontend/CredentialCreatePage.test.tsx`, `tests/frontend/WebsiteItemCreatePage.test.tsx` | **New spec:** a plus on the "Create …" button, checked for both item kinds. `within` is imported where it was missing. |

### Verification
- `npm run lint` is clean.
- `npm run test`: 108 files and 2351 tests pass.
- `npm run test:coverage`: 99.45 % statements, 98.6 % branches, 100 % functions and 99.75 % lines, all above the thresholds.
  - The first coverage run had 11 timeouts (5 s) in typing-heavy form tests while the full suite ran in parallel. Two later full runs passed cleanly.
- Playwright, against the dev server that was already running (Vite on 5180, API on 3010; I did not start or stop it):
  - **Home at 1600 px:** the 1080 px frame has 260 px on each side.
  - **Home at 390 px:** the 18 px gutters are unchanged and nothing scrolls sideways.
  - **Website, action and crawl run pages:** they still fill the window.
  - **Forge Gym, "Logged out":** History shows only the one logged-out crawl.
  - **Forge Gym, "Gym teacher":** History shows exactly that credential's 6 crawls.
  - **Login fixture, "Logged out":** "No logged-out crawls yet." shows.
  - **Plus icons:** "New action", "New use case" and "New credential" have the plus at 1600 px and at 390 px. "New website" and "Add step" still have it.
  - **Create forms:** all four "Create …" buttons have the plus. The "Save changes" buttons on the website, credential, use case and action edit pages do not.
  - **Not checked live:** starting a crawl, which would crawl the real external site. The existing spec "crawls logged in as the credential picked in Crawl as" covers the POST.
  - Screenshots are in `claude_tmp/verify/`.

---

## 2026-10-13 21:25 EDT — Redesign: the "Easy Test Mockups" screens on the Nocturne design system

**Intent:**
- Implement the Claude Design project **Easy Test Mockups** (`Easy Test Mockups.dc.html`, Nocturne design system), as the user asked:
  - Home becomes a dashboard of every website (1a / 2a).
  - The website page leads with its actions and moves crawls, screenshots, and credentials into a tabbed side panel (1b / 2b).
  - The action page shows versions, steps, and the latest run side by side (1c / 2c).
  - The crawl run page shows live progress beside its site map (1d / 2d).
  - Each screen has a desktop and a phone (390 px) layout.
- Import MUI icons through one separate file, so the whole icon library is never imported, as the user asked.

### Decisions
- **Made by the user** (answered in Plannotator, plan v1–v3, then approved):
  - **Q1:** extend `GET /api/websites` with a per-website `summary`.
  - **Q2:** drop what the mockups don't draw, along with its tests:
    - Home's Hello World and API-health readout;
    - the website description and its created time;
    - the crawl "Buttons" picker and the button-mode suffix;
    - the version's "Generated from" and "Refined from" blocks;
    - the "Out of date" explanation alert (the tag stays);
    - the run's "Ran … · logged in as …" line;
    - the action's created/updated line;
    - the Scripts, Crawls, and Runs intro paragraphs;
    - the crawl page's "Loaded", "Ended up at", and depth facts.

    Error states and the contents of the Screenshots and Credentials tabs were kept.
  - **Q3:** Inter from a Google Fonts `<link>`.
  - **Q4:** `/websites` redirects to `/` (`WEBSITE_LIST_PATH` is now `/`).
  - **Q5:** no mobile crawl-page detail sheet for now: the details stay below the map.
  - **Q6:** every MUI icon, including the existing ones, goes through `src/components/icons.tsx`.
  - **Q7:** hide the mockup details that have no data:
    - the "visiting…" / "waiting" site map rows;
    - "Use case · 3 actions";
    - "from the crawl of Oct 13";
    - the screenshot size.
  - **Q8:** screens outside the mockups get the theme only.
- **Defaults stated in the approved plan:**
  - **Breakpoints:** the phone layouts apply below `md` (900 px), and the action page goes single-column below `lg` (1200 px).
  - **Status colors:** the mockup's OKLCH colors were converted to hex once.
  - **"Not run" icon:** a dashed-circle `createSvgIcon`.
  - **Buttons:** the theme turns `contained` buttons into Nocturne's accent outline.
  - **Database:** no schema change, so no `prisma db push` / `generate`.
- **Added during the work, beyond the plan:**
  - `useCrawlRuns` now polls every 2 s while a crawl runs. Without it, the website page's running-crawl card would tick its timer while its page counts stayed frozen.
  - `MuiTypography.gutterBottom` is fixed at 16 px. Nocturne's smaller headings left the theme-only form pages' first floating label touching the title.
  - The desktop site map scrolls inside its panel (at most 640 px), as the old one did.
  - `countOutputLines` ignores a final newline. A test agent found that a two-line log read "3 lines".
- **Removed as dead code** once nothing used it, with its tests:
  - server: `listWebsites`;
  - client: `describeCrawledPagePath`, `describeCrawlButtonMode`, `formatCrawlButtonModeSuffix`, `describeChangedActionFields`, and `useHealth`;
  - `WebsiteListPage` (Q4).

### Files changed
| File | Change |
|---|---|
| `index.html` | Title "Easy Test"; Google Fonts preconnect and the Inter stylesheet link. |
| `src/main.tsx` | Uses `nocturneTheme` (the inline GitHub-style theme is gone). |
| `src/index.css` | Nocturne background and text before React mounts. |
| `src/theme/nocturneTheme.ts` | **New.** `nocturneTokens`, `statusColors`, `runStatusColors`, `crawlSeverityColors`, `MONOSPACE_FONT_FAMILY`, and `nocturneTheme` (palette, Inter typography, and overrides for Button, Typography gutter, OutlinedInput, Paper, Chip, Tabs, Alert, LinearProgress, Link, ListItemButton, Dialog, Menu, Tooltip, and focus ring). |
| `src/components/icons.tsx` | **New.** Per-path re-exports of `AddIcon`, `ArrowDownwardIcon`, `ArrowUpwardIcon`, `CheckIcon`, `CheckCircleOutlineIcon`, `ChevronLeftIcon`, `ChevronRightIcon`, `DeleteOutlineIcon`, `DragIndicatorIcon`, `HighlightOffIcon`, `MoreHorizIcon`, and `PlayArrowIcon`, plus `NotRunIcon`. |
| `src/components/StatusDot.tsx`, `StatusTag.tsx`, `ActionStatusBar.tsx`, `DisclosureRow.tsx`, `CrawlProgressCard.tsx`, `PageContainer.tsx`, `MoreActionsMenu.tsx`, `ActionScriptRunHistory.tsx`, `ActionScriptRunOutput.tsx` (`countOutputLines`, `describeOutputLineCount`) | **New** shared pieces. |
| `src/components/AppHeader.tsx` | Check-mark logo and "Easy Test"; "Websites" goes to `/`, with `aria-current` on the dashboard. |
| `src/components/PageBreadcrumbs.tsx` | "/" separators; on a phone, one "‹ Parent" back link (`findParentCrumb`). |
| `src/components/ScriptRunStatusIcon.tsx` | Outline check, X, and dashed circle in the status colors; new `size` prop. |
| `src/components/WebsiteItemListSection.tsx` | Actions as a status table (`ActionRow`, `newestVersionIsOutOfDate`) with the counts line; use cases as cards; `isPhoneLayout` prop. |
| `src/components/CrawlRunsSection.tsx` | The Crawls tab: Crawl as + Crawl website, the "One crawl at a time" hint, the progress card with Watch, and History rows. Buttons picker removed (`DEFAULT_CRAWL_BUTTON_MODE`, `CRAWL_BUTTON_MODE_OPTIONS` gone); `now` prop. |
| `src/components/ScreenshotRunsSection.tsx` | The Screenshots tab, with "Take screenshot" (`onTakeScreenshotClick`) and History rows. |
| `src/components/CredentialsSection.tsx` | The Credentials tab body, with no heading. |
| `src/components/ActionScriptsSection.tsx` | Versions column: rows with origin lines, Compare, and the compact model picker with "Convert to new version"; the phone Version dropdown. Version details moved out. |
| `src/components/ActionScriptDetails.tsx` | Steps column: caption, summary, steps marked by `highlightedRun`, and the Assumptions / Pages / Plan JSON rows; phone "Steps" with `leadingDisclosures`. `RefinedFromDetails` and the Generated-from block were removed. |
| `src/components/ActionPlanSteps.tsx` | Muted verbs (`describePlanStepParts`) and run marking (`findStepRunState`, `firstLineOf`); `highlightedRun` and `isCompact` props. |
| `src/components/ActionScriptRunsSection.tsx` | The Latest run panel and the phone card; `selectedRun`, `nextVersionNumber`, and `isPhoneLayout` props (`credentialName` removed). |
| `src/components/ActionScriptRunDetails.tsx` | Status banner, screenshot and URL, "Refine with Claude" with a counter and "Refine into Version N", and the Output log row; `refinedVersionNumber`, `isCompact`, and `runAgainButton` props. |
| `src/components/ScriptModelPicker.tsx` | Compact side-by-side selects (aria-labelled); the model id and fallback moved into the hover title. |
| `src/components/CrawlSiteMap.tsx` | Rows with a dot, the path, and a note (`describeSiteMapNote`); a scrolling surface panel on desktop and 44 px rows on a phone. |
| `src/components/CrawledPageDetails.tsx` | Path heading, facts row, Links and Buttons cards (`CrawledUrlCard`), and the snapshot line count (`describeSnapshotLineCount`). |
| `src/components/CodeBlock.tsx` | Nocturne's dark code ground. |
| `src/components/ActionPlanEditor.tsx`, `ActionPlanStepFields.tsx` | Icons now come from `icons.tsx`. |
| `src/pages/HomePage.tsx` | The dashboard (`WebsiteDashboardRow`). |
| `src/pages/WebsiteDetailPage.tsx` | Header, actions and use cases, and the tabbed side panel (`?tab=`, `chooseOpenTab`, `formatLoginPage`); phone tabs and the ⋯ menu; the crawl POST sends `{ credentialId }` only. |
| `src/pages/ActionDetailPage.tsx` | Three columns or one; `?version=` (`findShownVersionIndex`, `showVersionNumber`, `addAndShowCreatedScript`); `ActionHeader`; `findVersionNumberOfScriptId`. |
| `src/pages/CrawlRunPage.tsx` | Login tag, the running and ended status lines ("m:ss of 10:00 max", "Updated just now"), and the phone progress card. |
| `src/pages/WebsiteListPage.tsx` | **Deleted** (Q4). |
| `src/App.tsx` | `/websites` becomes `<Navigate to="/" replace />`. |
| `src/hooks/useNow.ts`, `useIsNarrowerThan.ts` | **New.** |
| `src/hooks/useCrawlRuns.ts` | Polls while a crawl runs (`aListedCrawlIsRunning`); returns `PolledJsonResourceState`. |
| `src/hooks/useWebsites.ts` | `WebsiteLatestCrawlRunRecord`, `WebsiteSummaryRecord`, `WebsiteWithSummaryRecord`; `useWebsites` returns them. |
| `src/hooks/useWebsiteItems.ts`, `useActionScripts.ts` | New `NewestActionScriptRecord` and `LatestActionScriptRunRecord` fields; `recordFinishedRun` copies them. |
| `src/hooks/useHealth.ts` | **Deleted** (Q2). |
| `src/utils/formatRelativeTime.ts` | **New:** `formatRelativeTime`, `formatDayAndTime`, `formatFullDateTime`, `formatElapsed`. |
| `src/utils/describeActionStatus.ts` | **New:** `describeLatestRunLabel`, `countActionStatuses`, `describeActionStatusCounts`, `describeActionCount`. |
| `src/utils/describeWebsiteSummary.ts` | **New:** `describeLatestCrawl`, `describeDashboardTotals`. |
| `src/utils/describeCrawlRun.ts` | New wording in `describeCrawlRunProgress` and `describeCrawlRunLogin`. Added `crawlRunLoginFailed`, `describeCrawlRunHistoryLabel`, `crawlRunHistorySeverity`, `CRAWL_TIME_LIMIT_MS`, `describeSiteMapNote`, and `describeRedirectFact`. Removed `describeCrawlButtonMode`, `formatCrawlButtonModeSuffix`, and `describeCrawledPagePath`. |
| `src/utils/actionPlanSteps.ts` | `describePlanStepParts` (`PlanStepParts`); `describePlanStep` is built on it. |
| `src/utils/describeScriptModel.ts` | `findScriptModelName`, `describeScriptModelBriefly`, `shortenScriptModelName`. |
| `src/utils/describeScriptRunStatus.ts` | `describeScriptRunStatusBriefly`. |
| `src/utils/describeScriptStaleness.ts` | `describeChangedActionFields` removed. |
| `src/utils/routePaths.ts` | `WEBSITE_LIST_PATH` is `/`. |
| `server/services/dbService.ts` | `LATEST_ACTION_SCRIPT_RUN_QUERY` also selects `failedStepNumber` and `timedOut`. `ACTION_LIST_INCLUDE` adds the version's text and an active-version `_count`. `NewestActionScriptSummary` gains `versionNumber`, `actionTitle`, `actionDescription`, and `credentialId`. New `WebsiteLatestCrawlRun`, `WebsiteSummary`, `WebsiteWithSummary`, `WEBSITE_SUMMARY_INCLUDE`, `toWebsiteWithSummary`, and `listWebsitesWithSummaries`. `listWebsites` removed. |
| `server/controllers/websites.ts` | `GET /api/websites` answers with summaries (JSDoc updated). |
| Tests | Backend: `dbService`, `websites`, `actions`, `actionScripts`, `server`. Frontend: every spec of a changed component, page, hook, or util was updated. **New:** `formatRelativeTime`, `describeActionStatus`, `describeWebsiteSummary`, `useNow`, `useIsNarrowerThan`, `nocturneTheme`, `sharedRedesignComponents`. `WebsiteListPage.test.tsx` was deleted. Helpers: `stubWindowWidth`, `buildWebsiteSummaryRecord`, `buildWebsiteWithSummaryRecord`, `buildNewestActionScriptRecord`; `websiteItemDetailPageCases` uses `/`. Every test removal maps to a Q2 or Q4 feature. |
| `README.md`, `src/README.md`, `src/components/README.md`, `src/hooks/README.md`, `src/pages/README.md`, `server/controllers/README.md`, `server/services/README.md`, `tests/README.md` | Describe the redesign, the new API fields, the icons file, and `stubWindowWidth`. |
| `AI_JOURNAL.md` | This entry. |

### Verification
- **Manual verification** (Playwright, plus the `manual-verifier` agent) at 1280 / 1440 / 1000 / 390 px against the mockups. Screenshots are in `claude_tmp/redesign/` and `claude_tmp/redesign/verify/`.
  - No console errors and no 4xx/5xx responses.
  - A live crawl of "easy-test dev" grew in place; a logged-in crawl of the local login fixture ran as Admin.
  - `?tab=`, `?version=`, and `?page=` survive a reload.
  - The ⋯ menus and the redirect worked.
  - A real run against the fixture recorded "Failed at step 3" with the step highlighted.
  - One real Refine created Version 4 and landed on `?version=4`.
  - The theme-only form and compare pages were checked too.
  - **Not checked:** the red "login failed" tag, a failed crawl's error text, and Convert.
- **Lint:** `npm run lint` is clean. `npm run tsc:client` and `npm run tsc` are clean. Note: `npm run tsc` also emits into `dist-server/`, because `tsconfig.server.json` has no `noEmit`. The local pm2 `easy-test` process was not restarted.
- **Tests:** `npx vitest run --coverage --maxWorkers=4` (the CI runner's 4 vCPUs) passes 108/108 files and 2326/2326 tests. Coverage: statements 99.45, branches 98.59, functions 100, lines 99.75.
  - Plain `npm run test:coverage` on this machine (12 CPUs, load average 18–25 from another project's test run) still times out 4 typing-heavy form specs (`ActionPlanEditor`, `CredentialForm`, `CredentialCreatePage`). That flake predates this work: the baseline run before any change failed 6 of the same kind, and each spec passes alone.
- **Build:** a production build (`vite build` into `claude_tmp/`, since deleted) succeeds at 726 KB, up from 685 KB. The over-500 KB warning was already there before.
- **Cleanup:** I stopped the dev servers I started on 5180 / 3010 and my leftover `tsx watch` (PID 15369). The two older `tsx watch` processes from other sessions were left alone.
- **Local DB:** the verification added one screenshot run, two crawl runs, one action run, and Version 4 of "Open account settings"; a throwaway website was created and deleted.

---

## 2026-10-13 15:25 EDT — pm2 restart limit: `min_uptime: "30s"` so a crash loop actually stops

**Intent:**
- Make pm2 stop restarting the app when it is stuck in a crash loop, as the user asked.
- Found on the production server: with `SERVER_PORT: 80`, the app could not bind the port (`EACCES`, it runs as a normal user). Each run lived about 13 seconds, and pm2 restarted it more than 30 times. `max_restarts: 10` never applied.

### Decisions
- **Made by the user:** apply `min_uptime: "30s"` with the existing `max_restarts: 10` and `restart_delay: 1000`.
- **Why `max_restarts` alone did nothing** (from `node_modules/pm2/lib/God.js`, `handleExit`): a crash only counts when that run lasted less than `min_uptime` (default 1 second), and only within `min_uptime` x `max_restarts` after the last manual start or restart. The default window was 10 seconds, and the runs lasted 13 seconds, so nothing counted.
- **Not changed:** the server's own `ecosystem.config.json` (still the user's uncommitted `SERVER_PORT: 80`), the port bind problem itself, and `startListening` ignoring the bind error Express 5 passes to the `listen` callback. The user has not chosen fixes for those yet.

### Files changed
| File | Change |
|---|---|
| `ecosystem.config.json` | Added `"min_uptime": "30s"` to the `easy-test` app. |
| `README.md` | The production paragraph on restarts now describes the 30-second rule, the 300-second counting window, and that `pm2 list` shows `waiting restart` (not `errored`) once pm2 gives up. |
| `AI_JOURNAL.md` | This entry. |

No application code or tests were changed.

### Verification
- **Method:** a throwaway pm2 7.0.4 daemon with its own `PM2_HOME` in `claude_tmp/`, so the user's `~/.pm2` daemon was not touched. It ran a stand-in `.mts` app that exits with code 1 after 2 seconds. The test configs were built from the real `ecosystem.config.json` with `jq`, swapping only the name, script, and interpreter.
- **Old settings (no `min_uptime`):** 12 restarts in 40 seconds, `unstable_restarts` 0, still restarting. This reproduces the endless loop.
- **`pm2 start` of the new config on the already-running app:** `min_uptime` became 30000. A plain `npm start` picks up the change, with no `pm2 delete` needed.
- **New settings, fresh start:** pm2 logged "too many unstable restarts (10). Stopped." after the first run plus 9 restarts (10 starts in the app log). The pid stayed 0, and `restart_time` stayed 9 for more than 30 seconds afterward. Status showed `waiting restart`, because `restart_delay` overwrites `errored` (God.js), while `!overlimit` prevents the restart.
- **Not verified:** on the production server itself. Nothing there was changed or restarted.
- **Cleanup:** the test daemon was killed (`pm2 kill`, no process left), and `claude_tmp/pm2-restart-check/` was deleted. No dev servers were started.

---

## 2026-10-13 11:11 EDT — GitHub Actions CI: all tests + coverage on every push to `master`

**Intent:**
- Run every unit test, backend and frontend, with coverage on each push to `master`, as the user asked.
- Fail the run when a test fails or a coverage threshold is missed.

### Decisions
- **Made by the user:**
  - **Install path:** run a plain `npm ci`, so `postinstall` (`prisma generate`, `prisma db push`, `playwright install chromium`) runs exactly as it does locally.
  - **CI database:** the user first chose SQLite in CI only, and the project stays on Postgres. That failed (see Verification), and the user then chose a throwaway **Postgres service container**.
  - **Rejected:**
    - moving the whole project to SQLite;
    - SQLite with the `String[]` fields rewritten in CI;
    - skipping `postinstall` with `npm ci --ignore-scripts`.
- **Defaults chosen:**
  - **Trigger:** `push` to `master` only, with no `pull_request` trigger.
  - **Command:** a single `npm run test:coverage`, because it already runs the whole suite and enforces the thresholds.
  - **Node version:** `node-version-file: package.json`, which `actions/setup-node` reads from `engines.node` (`=25.4.0`), so the version lives in one place.
  - **Postgres:** `postgres:18`, to match the local Homebrew version noted in `.env`. A `pg_isready` health check makes the runner wait until it is up.
  - **Actions:** `actions/checkout@v7` and `actions/setup-node@v7`, the latest releases (v7.0.1 / v7.1.0), with `cache: npm`.
  - **Not added:** no lint, `tsc`, or coverage-artifact steps, since none was asked for.

### Files changed
| File | Change |
|---|---|
| `.github/workflows/tests.yml` | **New:** workflow `Tests` with one job, `test-with-coverage` on `ubuntu-latest`. It declares a `postgres` service (user/password `postgres`, database `easy_test_ci`, port 5432, health check) and a job-level `DATABASE_URL` pointing at it, which wins over the committed `.env` because dotenv never overwrites a set key. **Steps:** checkout, setup-node, `npm ci`, `npm run test:coverage`. |
| `README.md` | New **Continuous integration** section after Scripts: what the workflow runs, why it has a Postgres service, and why SQLite was rejected. |
| `AI_JOURNAL.md` | This entry. |

No application code, tests, or config files were changed.

### Verification
- **Lint:** `actionlint` 1.7.12 (Docker image `rhysd/actionlint:1.7.12`) reports no problems in the workflow.
- **Replay method:**
  - A clean `git archive HEAD` copy plus the new workflow went into `claude_tmp/ci-replay/`.
  - A throwaway `extractWorkflowSteps.mts` read the YAML with js-yaml. It turned the job's `env` and `run` steps into one bash script, and its `services.postgres` into a `docker run` that waits for the health check.
  - The steps ran in `node:25.4.0` (Linux arm64), sharing the Postgres container's network so that `localhost:5432` reaches it, as on the runner. checkout and setup-node were stood in for by the copy and the image.
- **SQLite attempt (failed, now reverted):** `prisma generate` rejected the schema with "can't be a list. The current connector does not support lists of primitive types." The fields were `ActionScript.assumptions`, `ActionScript.contextPageUrls`, `CrawledPage.linkedUrls`, and `CrawledPage.buttonUrls`.
- **Postgres replay, 12 CPUs / 8 GB (the whole Docker VM):**
  - `npm ci` passed, and `db push` reported "in sync".
  - **25 frontend tests failed, almost all timeouts:** 21 hit the 5000ms default and 1 hit 30000ms. All were `user.type`-heavy form specs in `ActionDetailPage`, `ActionPlanEditor`, `CredentialCreatePage`, `CredentialForm`, `WebsiteCreatePage`, and `WebsiteForm`. In isolation on the Mac, the slowest of them take about 1.6s (and `ActionPlanEditor`'s max-steps spec takes 5.7s against its own 30s timeout), so the cause was contention: 11 jsdom workers in 8 GB.
- **Postgres replay pinned to 4 CPUs (`--cpuset-cpus=0-3`):** the repo is public, so `ubuntu-latest` is a 4-vCPU / 16 GB runner, and `nproc` in the container was 4.
  - **Result:** exit code 0, 102/102 files and 2181/2181 tests, in 69.5s.
  - **Coverage:** statements 99.46, branches 98.77, functions 100, lines 99.76, all above 80/70/80/80.
- **Local `npm run test:coverage`:**
  - One run, made while the Docker replay was loading the CPU, had **2 failing tests**. Their names were not captured.
  - Two later runs passed fully, 2181/2181 tests with the same coverage numbers.
  - **Flake risk:** these form specs are timing-sensitive under heavy CPU load.
- **Not verified:** a real GitHub Actions run. Nothing was pushed, and the first push to `master` is the real test.
- **Cleanup:** the replay copy, scripts, logs, and the timing JSON in `claude_tmp/` were deleted. No containers were left running, and no dev servers were started.

---

## 2026-10-13 10:50 EDT — Production start with pm2: `npm i`, then `npm start`

**Intent:**
- Make `npm i` followed by `npm start` build the app and run it as a production server under pm2.
- Make `npm i` install the right browser.
- Modeled on `~/Projects/forge-gym`, as the user asked: `ecosystem.config.json`, `start` / `stop` / `restart` / `logs` scripts, a compiled `dist-server/`, and Express serving `dist/` in production.

### Decisions
- **Made by the user:** set `importFileExtension = "js"` on the Prisma generator. The first `npm start` crashed with `ERR_MODULE_NOT_FOUND`, because the generated client imported `./internal/class` with no extension. tsx resolves that, but plain Node does not.
  - The rejected alternative was running production through tsx.
- **Already decided in the README:**
  - Production port `3011`, which was reserved for it.
  - Moving `typescript`, `tsx`, `vite`, and `prisma` to `dependencies`, per the old "Tripwire" section.
- **Following forge-gym:**
  - pm2 is a project dependency (`^7.0.4`), so no global install is needed.
  - The app is named `easy-test`, with `autorestart`, `max_restarts: 10`, `restart_delay: 1000`, and `time: true`.
- **Defaults chosen:**
  - **Server build:** the server compiles with the existing `tsc --project tsconfig.server.json`, which already had `outDir: dist-server`, instead of forge-gym's esbuild script.
  - **Prompt file:** `server/prompts/` is copied into the build, because `scriptGenerationService` reads `../prompts/actionPlanGuidelines.md` relative to its own file.
  - **Browser:** `playwright install chromium` goes in `postinstall`. It installs both the full Chromium (the plan runner launches `headless: false`) and the headless shell (screenshots and crawls).

### Files changed
| File | Change |
|---|---|
| `ecosystem.config.json` | **New:** pm2 app `easy-test` runs `./dist-server/server/server.js`; `env_production` sets `NODE_ENV=production` and `SERVER_PORT=3011`. |
| `package.json` | **New scripts:** `build:server` (`rm -rf dist-server`, `tsc --project tsconfig.server.json`, copy `server/prompts` into `dist-server/server/prompts`), `build:prod`, `start` (`build:prod` then `pm2 start ecosystem.config.json --env production`), `stop`, `restart`, `logs`. **`postinstall`** now also runs `playwright install chromium`. **Dependencies:** added `pm2` `^7.0.4`; moved `prisma`, `tsx`, `typescript`, and `vite` from devDependencies. |
| `package-lock.json` | Updated by `npm install pm2@^7.0.4` and the moves. |
| `server/server.ts` | **New:** `serverIsInProduction`, `CLIENT_BUILD_DIRECTORY` (`<cwd>/dist`), and the exported `serveBuiltClientFiles(expressApp, clientBuildDirectory)` and `serveClientRoutesFromIndexHtml(expressApp, clientBuildDirectory)`, both with JSDoc. **Changed:** under production the first is mounted before the routes and the second after them, replacing the "DEV-ONLY SCAFFOLD" comment. Boot logs where the client is served from in production. The no-cors comment is updated. New imports: `node:path`, `describeError`, and `readSendErrorStatus`. |
| `server/prisma/schema.prisma` | The generator gains `importFileExtension = "js"`, with a comment. `prisma db push` reported "already in sync", and `prisma generate` was run. |
| `tests/backend/server.test.ts` | Imports the two new functions. New `createProductionClientApp` and the "production client serving" suite (9 tests), plus a test that the full app serves no client under test. |
| `tests/backend/fixtures/client-build-files/` | **New:** `index.html` and `assets/app.js`. |
| `tests/backend/fixtures/client-build-with-unreadable-index/` | **New:** `index.html/README.txt`. `index.html` is a directory, so sending it fails with EISDIR. |
| `README.md` | New **Production** section, Scripts table rows, and Ports/Stack/Environment updates. The setup step drops the manual `npx playwright install chromium`. "Tripwire" is replaced by **Dependencies**. |
| `server/README.md`, `server/prisma/README.md`, `server/prompts/README.md`, `tests/README.md`, `.env.example` | Docs for the production build, `importFileExtension`, the prompts copy, the new fixtures, and the dev-vs-prod port. |

### Verification
- **Install:** `npm i` ran `prisma generate`, `prisma db push`, and `playwright install chromium`. Playwright 1.63 expects Chromium build 1243, and both the headed and headless builds are installed. A throwaway `claude_tmp` script launched both headless and headed and read a page title; it was deleted afterward.
- **Start:** `npm start` built and launched the pm2 app.
  - `/api/health` returned 200 on 3011.
  - `/` served index.html.
  - `/websites/some-id` returned index.html.
  - The JS asset returned 200.
  - Unknown `/api` paths and POSTs to client routes returned 404.
- **Playwright on :3011:**
  - The home page shows API health "ok".
  - Loading `/websites` directly lists the websites.
  - A website page made 7 `/api` calls, all 200, with no console errors.
- **pm2 behavior:**
  - A second `npm start` rebuilt and restarted the app under a new PID.
  - `npm run stop` freed the port, and `npm run restart` brought it back.
  - The pm2 app was then deleted, and ports 3010, 3011, and 5180 were free.
- **Dev unaffected:** after the generator change, `npm run dev` passed the health checks (direct and through Vite) and Playwright loaded `/websites`. The dev servers were then stopped.
- **Checks:**
  - Lint, `tsc`, and `tsc:client` are clean.
  - `test:coverage`: 2181 tests pass, at 99.46% statements, 98.77% branches, 100% functions, and 99.76% lines.

### Notes
- `npm audit` reports 13 high-severity findings, 8 of them through pm2's dependencies. Not fixed.
- The global pm2 daemon is v6.0.14, so the local pm2 7.0.4 prints an "out-of-date" warning. Not changed.

## 2026-10-12 17:42 EDT — Run status icons: passed / failed / not run yet, on the website's actions and on each version

**Intent:**
- Show at a glance whether an action's script works, without opening its runs.
- **Icons:** a green check when the latest run passed, a red X when it failed, and a yellow exclamation when there are no runs yet.

### Decisions (made by the user)
- **Placement:** both lists.
  - **The website page's "Actions" list:** one icon per action, judged by the action's **newest version**.
  - **The action page's "Versions" list:** one icon per version.
- **Mixed runs:** the **most recent run** decides. A pass after a failure is green.
- **No versions:** an action with no versions at all shows the **yellow exclamation**.

### Defaults chosen in the approved plan
- **Icons:**
  - `CheckCircle` in the theme's success color.
  - `Cancel` (circled X) in the error color.
  - `Error` (circled !) in MUI `amber[400]`. The theme's `warning` color is orange in dark mode, and the user asked for yellow.
- **Accessible names (also the hover titles):** "Latest run passed", "Latest run failed", and "Not run yet", via `titleAccess`. The icon sits before the row's text, so a row's accessible name now starts with its status, e.g. "Not run yet Version 2 …".
- **How the data arrives:** the server sends a small latest-run summary. No extra requests are made and the schema is unchanged, so no `db push` or `generate` was needed.

### Files changed — server
| File | Change |
|---|---|
| `server/services/dbService.ts` | **New:** private `LATEST_ACTION_SCRIPT_RUN_QUERY` (the newest active run, `take: 1`, `select { id, succeeded, createdAt }`); private `ACTION_SCRIPT_INCLUDE` (the refinement include plus `runs`); exported `LatestActionScriptRun`, `NewestActionScriptSummary`, `ActionWithNewestScript`; private `ACTION_LIST_INCLUDE` (the credential plus the newest active version, `take: 1`, with its newest run), `ActionListRow`, and `toActionWithNewestScript`. **Changed:** the private type `ActionScriptWithRefinement` was renamed to `ActionScriptRow`, the payload of the combined include. `ActionScriptWithPlan` drops `runs` and gains `latestRun`. `toActionScriptWithPlan` turns the zero-or-one `runs` list into `latestRun`. `listActionScriptsForAction`, `findActionScriptForAction`, `createActionScriptForAction`, and `createRefinedActionScriptForAction` use `ACTION_SCRIPT_INCLUDE`. `listActionsForWebsite` returns `ActionWithNewestScript[]`, each action with `newestScript` (null without versions). JSDoc updated. |
| `server/controllers/actions.ts` | JSDoc only: the list route documents `newestScript`. |
| `server/controllers/actionScripts.ts` | JSDoc only: the registrar and the scripts list route document `latestRun`. |

### Files changed — client
| File | Change |
|---|---|
| `src/utils/describeScriptRunStatus.ts` | **New:** `ScriptRunStatus` (`passed`, `failed`, or `notRun`), `LatestRunOutcome`, `findScriptRunStatus(latestRun)`, and `describeScriptRunStatus(status)`. |
| `src/components/ScriptRunStatusIcon.tsx` | **New** component (with `ScriptRunStatusIconProps` and `NOT_RUN_YET_COLOR`): the icon for a version's latest run. |
| `src/components/ActionScriptsSection.tsx` | Each version row starts with a `ListItemIcon` holding `ScriptRunStatusIcon` (from `script.latestRun`). JSDoc updated. |
| `src/components/WebsiteItemListSection.tsx` | New `itemsAreActions`. Actions get a `ListItemIcon` with `ScriptRunStatusIcon` (from `item.newestScript?.latestRun ?? null`); use cases get none. JSDoc updated. |
| `src/hooks/useActionScripts.ts` | **New:** `LatestActionScriptRunRecord`, `FinishedActionScriptRun`, `ActionScriptRecord.latestRun`, and `recordFinishedRun` (a per-visit map from script id to the run just recorded, laid over `scripts` by `withLatestRunRecordedThisVisit`). `ActionScriptsState` and JSDoc updated. |
| `src/hooks/useWebsiteItems.ts` | **New** `NewestActionScriptRecord` and `WebsiteItemRecord.newestScript?` (action list only). |
| `src/pages/ActionDetailPage.tsx` | `runSelectedScript` also calls `recordFinishedRun(finishedRun)`, so the version's icon updates at once. JSDoc updated. |

### Files changed — docs
`server/services/README.md`, `server/controllers/README.md`, `src/README.md`, `src/components/README.md`, `src/hooks/README.md`, and `src/pages/README.md`.

### Tests (written after manual verification; no test removed or skipped)
**Backend:**
- `services/dbService.test.ts` (107, 3 new):
  - **Fixture changes:** the result fixture carries `latestRun: null`, and the new `toPrismaActionScriptRow` builds the Prisma row (`runs` list) from it. Include asserts now expect `ACTION_SCRIPT_INCLUDE` / `ACTION_LIST_INCLUDE`.
  - **New:** latest run passed, failed, or none, for list and find (never `runs`); `newestScript` for passed, failed, and not run, and null without versions (never `scripts`).
- `api/actionScripts.test.ts` (1 new: `latestRun` passes through, no `runs`; `foundScript` gains `latestRun: null`).
- `api/actions.test.ts` (1 new: `newestScript` passes through).

**Frontend:**
- **New files:** `describeScriptRunStatus.test.tsx` (4) and `ScriptRunStatusIcon.test.tsx` (3: icon, color class, the amber style, and the accessible name).
- **New tests:**
  - `ActionScriptsSection`: an icon per version from its own run.
  - `WebsiteItemListSection`: icons only on actions (both kinds), and passed, failed, not run, and no versions.
  - `useActionScripts`: `recordFinishedRun` overlays the run without refetching.
  - `ActionDetailPage`: after "Run script", the version's icon turns red while the other version keeps its green.
- **Updated, because rows now start with the icon's name:**
  - `ActionScriptsSection` and `ActionDetailPage`: textContent anchors changed `^Version N` → `^Not run yetVersion N`, and button names `^Version 1` → `^Not run yet Version 1`.
  - `WebsiteDetailPage`: three `getByRole("img")` became `getByRole("img", { name: /^Screenshot of / })`, since the action icons are images too.
- `support/frontendTestHelpers.tsx`: `buildActionScriptRecord` defaults `latestRun: null`.

### Verification performed
- **Type checks and lint:** `npm run tsc`, `npm run tsc:client`, and `npm run lint` are clean.
- **Manual end-to-end check** (the manual-verifier agent, Playwright, dev servers started for the check and stopped after; the user had stopped their own first): **VERIFIED**.
  - The health check and the homepage were OK.
  - **API:** `newestScript` and `latestRun` match the database, and no `runs` key is answered.
  - **Website page:** every action's icon matches its newest version, including a never-run newest version (yellow), and the throwaway action with no versions (yellow, rgb(255,202,40)). The use cases list has no icons.
  - **Action page:** every version's icon matches its own latest run.
  - **Run updates:** running a version whose icon was red turned it green in place without a reload, and the other versions were unchanged.
  - **Cleanup:** the throwaway action was deleted; the only lasting data change is two additive runs on an existing action.
  - **Not exercised live:** a brand-new version created through the editor. Convert was off limits, and a new action has nothing to edit; the unit tests and the API cover `latestRun: null` on create.
- **`npm run test:coverage`:** 102 files, **2171 tests pass**. Coverage is 99.59% statements, 98.99% branches, 100% functions, and 99.86% lines (thresholds 80/70/80/80). Every changed or new file has full line coverage, and all new files have full branch coverage.
  - **Flakiness seen (not caused by this change):**
    - One run had a 401-for-404 in a refinements route test. That file then passed 3 out of 3 times alone.
    - Another run had four 5 s timeouts in `ActionPlanEditor`, `CredentialCreatePage`, and `CredentialForm`, which passed alone.
    - The next full run was clean.

---

## 2026-10-12 16:24 EDT — Refine a failed run: the same model fixes the plan from the run's evidence, saved as a new version with a refinement record (built by three agents in parallel)

**Intent:**
- **A Refine feedback loop for failed runs.** A failed run (one with an error) of a version Claude wrote now shows a **Refine** button and an optional **Note for Claude**.
- **What Refine sends.** It sends **the same model and effort that wrote the version**:
  - the run's error, failed step, step log, **failure screenshot** (as an image), and a **snapshot of the failing page**;
  - the version's plan, summary, and assumptions;
  - the same crawled pages, and the note.
- **The result.** Claude's reply is saved as a **new, immutable version** ("Refined from Version K").
- **Recording that a version was derived from an earlier attempt.** A new `ActionScriptRefinement` row links the source version, the failed run, and the new version.
- **The runner now records the failing page.** A failed run stores the URL and the aria snapshot of the page it failed on, so Claude sees the exact roles and names there.

### Decisions (made by the user)
- **Edited versions:** Refine is **hidden** on runs of versions saved from the step editor (`modelId` null), and the server refuses them with 409.
- **Lineage:** a separate **refinement table** that links source version → failed run → new version. `editedFromActionScriptId` is unchanged.
- **One source of truth** (from the user's plan review): the refinement row stores only facts that exist nowhere else:
  - the note;
  - the refine call's token usage;
  - `screenshotWasSent`.

  The other facts are read from where they already live:
  - the error and failed step: the run row;
  - the model and effort: the refined version's row;
  - "a failing-page snapshot was sent": `run.failingPageAriaSnapshot !== null`.
- **Extra context:** the **failing page snapshot** (a runner change) and the **optional user note**.
- **Parallel build with at most three agents:** shared working tree, strictly separate file ownership, no git worktrees.

### Defaults chosen in the approved plan
- **Snapshots:** the refined version copies, and shows Claude, the SOURCE version's website and action snapshots and its credential name. It shows "Out of date" if the action changed since.
- **Allowed origins:** taken from the current website and credential.
- **Pages:** the source version's `contextPageUrls` from the latest crawl, falling back to `selectRelevantCrawledPages`.
- **Effort:** the source version's effort if the model still offers it, else `chooseEffortForModel`.
- **Retired model:** 409.
- **Missing screenshot file:** the refine goes ahead without the image, recorded as `screenshotWasSent: false`.
- **Note:** trimmed, blank becomes null, at most 2000 characters.
- **When rows are written:** a refinement row only on success, in the same nested write as the new version.
- **Double refines:** a per-run in-flight guard answers 409.
- **Shared prompt:** convert and refine share ONE system prompt (`actionPlanGuidelines.md`) and the same structured-output schema, so they share the prompt cache. Refine instructions are a new section of that prompt, and the run evidence goes in the user message.

### How it was built
1. **Step 0 (me):** the schema, then `db push` / `generate`, the `selectRelevantCrawledPages` exports, and contract stubs.
2. **Wave 1, source only, in parallel:**
   - **A:** runner, Claude call, and prompt.
   - **B:** data, validation, and route.
   - **C:** frontend.
3. **Real-API caching check, then manual end-to-end verification** (manual-verifier agent).
4. **Wave 2:** the same three agents wrote the tests and fixed lint.
5. **Final checks, READMEs, and this journal entry (me).**

### Files changed — schema and data
| File | Change |
|---|---|
| `server/prisma/schema.prisma` | **New model `ActionScriptRefinement`** (`action_script_refinements`): `websiteId`, `actionId`, `sourceActionScriptId`, `actionScriptRunId`, `refinedActionScriptId @unique`, `note`, `inputTokens`, `outputTokens`, `cacheReadInputTokens`, `cacheCreationInputTokens`, `screenshotWasSent`, timestamps, `deletedAt`. Relations `RefinementSourceScript` / `RefinementResultScript`, the run, the website, and the action. Indexes on websiteId, actionId, sourceActionScriptId, and actionScriptRunId. **`ActionScriptRun`:** `failingPageUrl String?`, `failingPageAriaSnapshot String?`, and `refinements`. **`ActionScript`:** `refinement` and `refinementsOfThisVersion`. **`Website`:** `actionScriptRefinements`. **`Action`:** `scriptRefinements`. Doc comments updated on all four. Formatted with `prisma format`. **`npx prisma db push` and `npx prisma generate` were run.** The change is additive (a new table and nullable columns), so no data was lost. |
| `server/services/dbService.ts` | **New:** `ActionScriptRefinementInput`; the re-exported `ActionScriptRefinement` type; the private `ACTION_SCRIPT_REFINEMENT_INCLUDE` (the refinement with `deletedAt: null`, plus `actionScriptRun: { select: id, errorMessage, failedStepNumber, timedOut, failingPageAriaSnapshot }`); the private `ActionScriptWithRefinement`; and `createRefinedActionScriptForAction`, one atomic nested `actionScript.create` that makes the version AND its refinement. **Changed:** `ActionScriptWithPlan` now carries `refinement`. `toActionScriptWithPlan`, `listActionScriptsForAction`, `findActionScriptForAction`, and `createActionScriptForAction` use the include. `ActionScriptRunInput` gains the two failing-page fields. `softDeleteWebsite` and `softDeleteActionForWebsite` also stamp refinements. Docs updated. |
| `server/utils/validateRequestBodies.ts` | **New:** `MAX_REFINE_NOTE_LENGTH = 2000`, `ActionPlanRefineInput`, and `validateActionPlanRefineInput`. An `undefined` body means no note, and a `null` or other non-object body gives 400. It returns "The note must be text" and "The note must be at most 2000 characters". |
| `server/utils/selectRelevantCrawledPages.ts` | **Exported** `capSnapshot`. **New:** `selectContextPagesByUrl(pages, pageUrls)`, which keeps the given order, skips missing URLs, and applies the same caps. **New private** `fitPagesIntoContextBudget`, shared by both selectors. `selectRelevantCrawledPages` behaves the same. |

### Files changed — server
| File | Change |
|---|---|
| `server/services/actionPlanRunnerService.ts` | **`ActionPlanRunResult`:** gains `failingPageUrl` and `failingPageAriaSnapshot`. **New private pieces:** `FailureEvidence`, `NO_FAILURE_EVIDENCE`, `BLANK_PAGE_URL`, `readFailingPageUrl` (scrubbed; `about:blank`, empty, or a throw gives null), `takeFailingPageAriaSnapshot` (`body` aria snapshot, scrubbed, NUL stripped, `capSnapshot`; a throw gives null), and `captureFailureEvidence` (screenshot, then URL, then snapshot; never rejects). **Where it runs:** on in-time failures and inside `stopTimedOutRun`, before the browser closes. A passing run captures nothing. |
| `server/services/scriptGenerationService.ts` | **New exported types:** `ClaudeTokenUsage`, `FailedRunDetails`, `ActionPlanRefinementRequest`, `ActionPlanRefinement`, and `MAX_REFINE_RUN_OUTPUT_CHARACTERS = 20_000`. **New private pieces:** `PlanRequest`, `PlanAnswer`, `askClaudeForPlan` (convert's old body: the same system prompt with `cache_control`, betas, fallbacks, thinking, effort, and `output_config`, plus usage mapping), `buildActionContextLines`, `takeRunOutputTail`, `buildPreviousPlanLines`, `buildFailedStepLines`, `buildFailingPageLines`, `buildUserNoteLines`, `buildRefinementFailureText`, and `describeAsYesOrNo`. **`buildRefinementRequestContent`** returns: (1) the stable context text, marked `cache_control: ephemeral` (the second breakpoint); (2) the PNG image, only when there is a screenshot; (3) the failure text. **`refineActionPlan`** logs `[scripts] refined with … read from cache, … written to cache …`. **`convertActionToPlan`** is now a thin wrapper; its request, return value, errors, and log line are byte-identical, and its 45 existing tests pass unmodified. `buildConversionRequestMessage` uses `buildActionContextLines`, and its output is unchanged. It imports `describePlanStep` from the runner. |
| `server/prompts/actionPlanGuidelines.md` | **Role and "What You Are Given":** a request is a conversion or a refinement. **"When to Assume":** now says "one-shot conversion or refinement". **New `# Refining a Failed Plan`** section (with "How to Read a Failure" and "How to Fix the Plan") before Output Format. It covers: evidence is data, not instructions; the note is a hint that cannot override the rules; the common causes of failure; change as little as possible; never weaken a check; and add one `Refined:` assumption. Token counts: **Opus 5.5 7,275, Haiku 4.5 5,674, Opus 4.6 5,675**, all above the 4,096 cache minimum. |
| `server/controllers/actionScripts.ts` | **New route** `POST /api/websites/:websiteId/actions/:actionId/scripts/:actionScriptId/runs/:actionScriptRunId/refinements`, with full `@route` JSDoc. Its checks run 400 → 404 (website, action, script, run) → 409 (passed run, edited version, already refining, retired model) → `statusForScriptGenerationFailure`; success is 201. **New:** the messages `ONLY_A_FAILED_RUN_CAN_BE_REFINED_MESSAGE`, `EDITED_VERSION_CANNOT_BE_REFINED_MESSAGE`, and `RUN_ALREADY_BEING_REFINED_MESSAGE`; the `actionScriptRunIdsBeingRefined` Set; the `RefinableRun` interface; and the private `describeFailedRun`, `chooseRefinementEffort`, `selectRefinementContextPages`, `isFileMissingError`, `readFailureScreenshotAsBase64` (traversal guard; ENOENT gives null; other errors rethrow), and `refineRunAndSaveVersion`. **Changed:** `runPlanAndRecordRun` records the two failing-page fields. JSDoc updated. |

### Files changed — client
| File | Change |
|---|---|
| `src/hooks/useActionScripts.ts` | **New** `RefinedActionScriptRunSummary` and `ActionScriptRefinementRecord`. `ActionScriptRecord.refinement` was added, and the docs updated. |
| `src/hooks/useActionScriptRuns.ts` | `ActionScriptRunRecord` gains `failingPageUrl` and `failingPageAriaSnapshot`. |
| `src/utils/routePaths.ts` | **New** `actionScriptRunRefinementsApiUrl(websiteId, actionId, actionScriptId, actionScriptRunId)`. |
| `src/components/ActionScriptRunDetails.tsx` | **New:** `MAX_REFINE_NOTE_LENGTH`, the private `noteToSend`, and the props `versionCanBeRefined`, `isRefining`, `isRunning`, `refineErrorMessage`, `onRefine(failedRun, note)`. **The Refine area** shows only when `run.errorMessage !== null && versionCanBeRefined`. It has a "Note for Claude (optional)" field (maxLength 2000) and a Refine button that reads "Refining…" and is disabled while refining or running. While refining it shows a `LinearProgress` ("Refining script") and "This can take a few minutes.". "Could not refine: …" shows only after this run's details tried. **Also:** a "Failing page: <url>" caption. |
| `src/components/ActionScriptRunsSection.tsx` | Passes the refine props through. `ActionScriptRunDetails` is keyed by run id, so the note and error reset per run. |
| `src/pages/ActionDetailPage.tsx` | A fourth `useJsonMutation`. **New** `refineFailedRun(failedRun, note)` (POSTs `{ note }`, then `addCreatedScript` and `setPickedScriptId`), `handleRefine`, and `versionCanBeRefined = selectedScript.modelId !== null`. |
| `src/components/ActionScriptDetails.tsx` | **New prop** `refinedFromVersionNumber`. **New private** `describeSourceVersion`, `describeWhatClaudeWasSent`, `describeRefinementTokenUsage`, and a `RefinedFromDetails` component, which shows the source version, the failed outcome, the error, "Your note", "Sent to Claude", and "Tokens used". `describeVersionOrigin` checks edited → refined ("Refined <date> from Version K · <model>") → generated. |
| `src/components/ActionScriptsSection.tsx` | **Removed** `editedFromVersionNumberOf`; **added** `versionNumberOfScriptId` and `describeSourceVersionOf`. `describeVersionSource` shows "Refined from Version K · <model>". `refinedFromVersionNumber` is passed down. |
| `src/pages/ActionScriptComparePage.tsx` | `describeVersion` shows "refined · <model>". The empty state now reads "Convert, refine, or edit …". |

### Files changed — docs
`README.md`, `server/prisma/README.md`, `server/services/README.md`, `server/controllers/README.md`, `server/utils/README.md`, `server/prompts/README.md`, `src/components/README.md`, `src/hooks/README.md`, `src/pages/README.md`, and `tests/README.md`.

### Tests (written in wave 2, after manual verification; no test removed or skipped)
**Backend:**
- `actionPlanRunnerService.test.ts` (110, 13 new): the evidence order on timeout and on in-time failure; nulls on a passing run; scrubbing, NUL stripping, and the cap; `about:blank` and empty URLs; snapshot and URL reads that throw. The one whole-result `toEqual` was updated for the new fields.
- `scriptGenerationService.test.ts` (80, 35 new): `buildRefinementRequestContent` (block order and cache marker, the image only with a screenshot, a byte-identical context block across runs, the step, tail, failing-page, and note lines) and `refineActionPlan` (settings identical to convert's, usage, the log line, every error). The convert tests are unmodified.
- `api/actionScripts.test.ts` (119, 44 new): every refine status in order; exact `refineActionPlan` and save arguments; the page and effort fallbacks; the screenshot read (real fixture PNG as base64, missing file, traversal, absolute path, `EISDIR` 500); the in-flight guard with a deferred and its release; the run route recording the new fields.
- `dbService.test.ts` (104, 6 new, plus updated include and cascade asserts).
- `server.test.ts` (17, 1 new).
- `validateRequestBodies.test.ts` (200, 19 new).
- `selectRelevantCrawledPages.test.ts` (38, 10 new).

**Frontend:**
- `ActionScriptRunDetails` (14, 8 new).
- `ActionScriptRunsSection` (10, 4 new).
- `ActionScriptDetails` (26, 10 new).
- `ActionScriptsSection` (14, 1 new).
- `ActionScriptComparePage`: 1 new, and the empty-state wording test updated to the new text.
- `routePaths`: 1 new.
- `ActionDetailPage` (37, 3 new): refine success with a deferred POST, refine failure, and hidden on an edited version.
- `support/frontendTestHelpers.tsx`: `buildActionScriptRefinementRecord`, plus defaults for the new fields.

### Verification performed
- **Type checks and lint:** `npm run tsc`, `npm run tsc:client`, and `npm run lint` are clean.
- **`npm run test:coverage`:** 100 files, **2153 tests pass**. Coverage is 99.58% statements, 98.98% branches, 100% functions, and 99.86% lines (thresholds 80/70/80/80).
  - **Flakiness seen (not fixed; reported to the user):** across 7 runs, one run had 12 failures in tests heavy on typing or interaction — `ActionDetailPage` edit and refine, `CredentialForm`, `CredentialCreatePage`, `WebsiteForm` — and another had 1 failure in `api/credentials.test.ts` (a 404 with an empty body). The other 5 runs passed. Those form and credentials files are untouched by this feature. Run alone, the refine page test takes about 0.7 s.
- **Real-API caching** (`claude_tmp/checkRefineCaching.mts`, Opus 5.5, low effort):
  - convert wrote 9,519 tokens to the cache;
  - refine #1 **read 9,519** (the system prompt, shared with convert) and wrote 376 (the context block);
  - refine #2 **read 9,895** and wrote 0.
- **Manual end-to-end check** (manual-verifier agent, throwaway `npx playwright` scripts in `claude_tmp/verify/refine*.mts`, plus `POST /__rename-account` and `/__restore-account` added to the fixture site) — **VERIFIED**:
  - **Startup:** the health check and homepage were OK.
  - **Version 1 fails:** after the rename, Version 1 failed at step 3. The run stored `failingPageUrl` `http://localhost:3099/account` and a snapshot showing `heading "Profile"` and `Signed in as ••••••`, with no username or password.
  - **Refine produced Version 2:** "Refined … from Version 1 · Claude Opus 5.5 (claude-opus-5-5) · high effort", with the "Refined from" block. Its `refinement` had `screenshotWasSent: true`, the note, tokens 2408 / 9519 / 1292 / 989, and the joined run error and step 3. Its model and effort matched Version 1's.
  - **Database:** the `action_script_refinements` columns are exactly the planned ones.
  - **Version 2 passed,** and no Refine button showed.
  - **An edited Version 3 failed,** and no Refine button showed.
  - **Direct API checks:** passing run 409, edited version 409, a 2001-character note 400, a numeric note 400, a missing run 404.
  - **The compare page** shows "refined".
  - **Server log:** one `[scripts] refined …` line, matching the database row.
  - **No console errors.** Screenshots are in `claude_tmp/verify/refine-*.png`.
  - **Clean-up:** dev servers and the fixture stopped; ports 5180, 3010, and 3099 are free. Orphaned `tsx watch` parents from earlier sessions were found and killed.
- **Data left in the dev database:** the verifier's "Open account settings" action on "Login fixture" (3 versions, 1 refinement, its runs).
- **After verification, one source change:** Agent C changed `ActionScriptRunDetails`' `onRefine` to `(failedRun, note)` and removed an unreachable guard in `ActionScriptRunsSection`. `ActionDetailPage`'s refine tests cover that path through the real components.

---

## 2026-10-09 11:02 EDT — Removed the `pause` step action from plans, the LLM prompt, the runner, and the step editor

**Intent:**
- Plans can no longer contain a `pause` step. That step called Playwright's `page.pause()` and blocked a run until a person pressed Resume.
- `pause` was removed from the allowed actions, from the JSON schema Claude's structured output is held to, from the system prompt, from the runner's `switch`, and from the step editor's Action dropdown.
- Saved plans that used it were deleted.

### Decisions (made by the user)
- **Existing pause plans:** hard-delete every plan version that has a pause step, plus its runs and their failure-screenshot folders.
- **Human-only steps:** when a use case needs a step only a person can do (a two-factor code, an emailed link), Claude writes the steps a user would take anyway. It records in `assumptions` which step will likely fail and why.
- **Bot checks:** assume runs always get past Cloudflare and never meet a CAPTCHA. The user's words: "there will be few scenarios where we can't control the inputs".

### Data cleanup (run once, before the code changes)
- `npx prisma db execute --stdin`, in one transaction:
  - `DELETE FROM action_script_runs WHERE "actionScriptId" IN (SELECT id FROM action_scripts WHERE plan->'steps' @> '[{"action":"pause"}]');`
  - `DELETE FROM action_scripts WHERE plan->'steps' @> '[{"action":"pause"}]';`
- **Deleted:** 2 plan versions (`cmux7kr480004n8s7v10gq48g`, `cmux7p7zn0006n8s7y8r94dd3`). Both belonged to the action "Create Class" (`cmust3kbk000e8muhdm14fxne`), which now has no versions.
- **Also deleted:** their 3 runs (`cmux7mzqg0005n8s7c36s6h5c`, `cmux7vvg70007n8s7doopcg80`, `cmux8scas0008n8s7vjseu03h`).
- **Run folders removed:** `action-scripts/cmureoluv0000unuh986liihx/{3be229ee-1ff6-49cc-808d-cf617e1ae4e1, 026177e6-66ae-403b-8b1a-1aede5b062f0, 4640c24c-5e42-4944-a4f2-d95595835dde}`. Each held only `failure.png`.
- **Result:** 6 plan versions and 5 runs remain, and none has a pause step.
- The Prisma schema did not change, so there was no `db push` / `generate`.

### Files changed
| File | Change |
|---|---|
| `server/utils/actionPlanSchema.ts` | Removed `"pause"` from `PLAN_STEP_ACTIONS` and its entry from `PLAN_STEP_RULES`. `PlanStepAction`, `PlanStepSchema`, and the structured-output JSON schema built from them in `scriptGenerationService.ts` follow automatically. The `"message"` value kind stays for `log`. |
| `server/services/actionPlanRunnerService.ts` | Removed `case "pause"` from `describePlanStep` and from `runPlanStep` (the `page.pause()` call). `runActionPlan`'s JSDoc no longer mentions a waiting pause. |
| `server/prompts/actionPlanGuidelines.md` | **Core Rule:** write the step a user would take and note the likely failure in `assumptions`. **Logging In:** a missing username/password gets obviously fake values plus an assumption. **Step catalog:** `pause` row removed. **"When to Pause or Assume" → "When to Assume":** never plan for Cloudflare or CAPTCHAs; for rare human-only steps, write them anyway and record which step will likely fail. Still ~4.39k tokens on Haiku 4.5 / Opus 4.6, so above the 4,096-token cache minimum. |
| `server/services/README.md` | The time-limit note no longer mentions `page.pause()`. |
| `src/utils/actionPlanSteps.ts` | Removed `"pause"` from `PLAN_STEP_ACTIONS`, its `PLAN_STEP_RULES` entry ("Pause for a person"), and its `describePlanStep` case. The editor's Action dropdown (`ActionPlanStepFields.tsx`) maps this list, so the option is gone without a component change. |
| `tests/backend/utils/actionPlanSchema.test.ts` | The missing-fields structure test uses `log`. Pause rows were removed from the "rejects a target", "requires a value", "rejects a blank value", and "plain text" tables. **New:** "rejects the removed pause action as an unknown action" (`parseActionPlan`) and "rejects an otherwise valid plan that still has a removed pause step" (`validateActionPlan`). |
| `tests/backend/services/actionPlanRunnerService.test.ts` | Removed `pause` from `mockPage` and `beforeEach`, removed the "pause opens the Playwright Inspector" test, and removed both pause `describePlanStep` cases. **The 5-minute time-limit tests were kept**, with `PAUSE_PLAN` → `WAIT_FOR_URL_PLAN` and `holdPauseUntilBrowserCloses` / `PendingPause` → `holdWaitForUrlUntilBrowserCloses` / `PendingWaitForUrl`. They now hold a pending `page.waitForURL()` until the browser closes. |
| `tests/frontend/actionPlanSteps.test.tsx` | Removed the pause `describePlanStep` row. The "message" acceptance check uses `log`. The "keeps the value" `changePlanStepAction` case re-picks `log` (every value kind except "none" now belongs to one action). |

### Verification
- `npm run tsc`, `npm run tsc:client`, and `npm run lint` are clean.
- `npm run test:coverage`: 100 files, 1997 tests pass. Coverage is 99.55% statements, 98.92% branches, 100% functions, and 99.85% lines.
- `claude_tmp/countPromptTokens.mts`: Opus 5.5 5599, Haiku 4.5 4389, Opus 4.6 4390.
- `claude_tmp/checkPlanCaching.mts`: two live conversions returned valid plans. The second read 7843 tokens from the cache.
- Manual check with a Playwright script (manual-verifier agent):
  - `/api/health` returned 200 and the homepage loaded.
  - "Create Class" shows "No scripts yet" with no console errors.
  - The step editor's Action dropdown on "Teacher login" lists 17 actions, without "Pause for a person".
  - POSTing an edit that contains a pause step returns 400 ("Invalid option: expected one of ...").
  - The dev servers were stopped.

---

## 2026-10-03 19:10 EDT — Actions: credentials, JSON step plans, step editor, switch-based runner (tests by multiple agents)

**Intent:**
- **Actions can run as a credential.** An action can be linked to one of its website's credentials. Each run logs in first with the crawler's login routine, then runs the plan.
- **"Convert to script" now asks Claude for a JSON step plan** instead of a Playwright `.mjs` file: `{ name, startUrl, steps: [{ action, target, value }] }`, using only the pre-approved actions from the old guidelines.
- **Claude is shown the aria snapshots of the crawled pages most relevant to the action.** They are picked with the user's suggested word search: the most repeated words and phrases of the title and description, stop words removed.
- **Plans are editable in a step editor.** Steps can be reordered (drag or up/down), added, changed, or removed, and the result is saved as a new version.
- **"Run script" turns the JSON into Playwright calls through an exhaustive `switch`.** Nothing from a plan is ever turned into code, so a step outside the allowed list cannot run.

### Decisions (made by the user)
- **Credential use:** auto-login first with the crawler's routine, and the `{{credential.username}}` / `{{credential.password}}` placeholders stay available in `fill` steps.
- **Edits** save a NEW immutable version ("Edited from Version K").
- **Old scripts are hard-deleted:** the `code` / `ruleViolations` / `exitCode` / `exitSignal` columns, `findScriptRuleViolations`, and `scriptRunnerService` (and their tests) are removed.
- **Reordering:** dnd-kit drag handles plus up/down buttons. `@mui/icons-material` was installed for the icons.
- **Run engine:** the in-process switch runner, not generated `.mjs`.
- **Relevant pages:** the user's word-search approach, with no second LLM call.
- **End-to-end driver:** the Playwright MCP hung (it runs in `--extension` mode), so the user chose throwaway `npx playwright` scripts in `claude_tmp/`.

### Data cleanup (run once, before the schema push)
- `DELETE FROM action_script_runs; DELETE FROM action_scripts;` (20 scripts, 7 runs) via `prisma db execute`.
- The old run folders under `action-scripts/` were removed.
- Then `prisma db push` and `prisma generate`.

### Files changed — server
| File | Change |
|---|---|
| `server/prisma/schema.prisma` | **`Action`:** `credentialId String?` + `credential` relation + index. **`Credential`:** `actions Action[]`; the doc now says deleting it unlinks actions. **`ActionScript`:** dropped `code` and `ruleViolations`; added `plan Json`, `contextPageUrls String[]`, `credentialId` / `credentialName` snapshots, and `editedFromActionScriptId`; `modelId` is now nullable. **`ActionScriptRun`:** dropped `exitCode` and `exitSignal`; added `errorMessage`, `failedStepNumber`, and `credentialName`. Doc comments rewritten. |
| `server/utils/actionPlanSchema.ts` (new) | `ActionPlanSchema`, `PlanStepSchema`, `PlanTargetSchema`, `ARIA_ROLES` (a `Record<AriaRole, true>`, so the compiler checks it against Playwright's list), `PLAN_STEP_ACTIONS`, `PLAN_KEYS`, `DIALOG_RESPONSES`, `CREDENTIAL_PLACEHOLDERS`, `PLAN_STEP_RULES` (a `Map`), and limits. Functions: `readHttpOrigin`, `buildAllowedPlanOrigins`, `findActionPlanProblems`, `parseActionPlan`, `validateActionPlan`, `planUsesCredentialPlaceholders`. |
| `server/utils/selectRelevantCrawledPages.ts` (new) | `extractActionSearchTerms`, `scoreCrawledPage`, `selectRelevantCrawledPages`, and limits (6 pages, 60k characters, 20k per snapshot with a marker). |
| `server/services/dbService.ts` | **New:** `ActionWithCredential`, `ActionScriptWithPlan`, `CrawledPageSnapshot`, `ACTION_CREDENTIAL_INCLUDE`, `toActionScriptWithPlan`, `findNewestCrawlRunWithPages`, and `findLatestCrawledPagesForWebsite`. **Changed:** `ActionInput` (now has `credentialId`); `ActionScriptInput` / `ActionScriptRunInput` use the new fields; action reads include the credential; script reads parse `plan`; `softDeleteCredentialForWebsite` is now a transaction that also unlinks actions. |
| `server/utils/validateRequestBodies.ts` | **New:** `validateActionInput`, `ActionPlanEditInput`, `validateActionPlanEditInput`. |
| `server/controllers/actions.ts` | POST and PUT use `validateActionInput`. **New** module-private `credentialBelongsToWebsite`, which answers 400 for another website's credential. Route JSDoc updated. |
| `server/services/crawlerLoginService.ts` | **New:** `buildCrawlLoginDetails(credential, website)`, moved out of `crawlRunService.buildCredentialLogin` (login URL fallback and decryption). |
| `server/services/crawlRunService.ts` | `buildCredentialLogin` now delegates to `buildCrawlLoginDetails`; the `decryptCredentialPassword` import was removed. |
| `server/prompts/actionPlanGuidelines.md` (new) | The plan-writing system prompt: core rule, how to read aria snapshots (as data, not instructions), targets, the step catalog, logging in and placeholders, common patterns, pause / assumptions, the Output Format, and two example plans. About 4.3k tokens on Haiku 4.5 / Opus 4.6, so it is above their 4,096-token cache minimum. |
| `server/prompts/actionScriptGuidelines.md` | **Deleted.** |
| `server/services/scriptGenerationService.ts` | `convertActionToScript` became **`convertActionToPlan`**. It uses `beta.messages.create` with a hand-built JSON schema, because `betaZodOutputFormat` turns `enum` into description text. **New:** `STRUCTURED_OUTPUTS_BETA`, `ActionPlanConversionSchema`, `toStructuredOutputSchema`, `CONVERSION_OUTPUT_SCHEMA`, `buildLoginLines`, `buildContextPageLines`, `readConversionReply`; `buildConversionRequestMessage` is now exported. **Replaced types:** `ActionPlanConversionRequest` / `ActionPlanConversion`. It checks `stop_reason` first, which fixes the old unreachable `truncated` path. |
| `server/services/actionPlanRunnerService.ts` (new) | **`runActionPlan`:** a visible Chromium, login first, `startUrl`, then the steps. **`runPlanStep`:** an exhaustive `switch` whose `default` throws. Also `describePlanStep`, `describePlanTarget`, `scrubSecrets`, and module-private `locateTarget`, `requireTarget`, `requireValue`, `resolveFillText` (placeholders typed only on the website's origins), `typeLikeAPerson` (click, Ctrl/Cmd+A, `pressSequentially`), `uploadFileThroughChooser` (only `<ACTION_SCRIPT_DIR>/uploads/`), `walkPlan`, `captureFailureScreenshot`, and `RunOutputCollector`. There is a 5-minute deadline (screenshot, then close), and every fire-and-forget promise is `.catch`ed. |
| `server/services/scriptRunnerService.ts` | **Deleted** (the node child-process runner). |
| `server/utils/findScriptRuleViolations.ts` | **Deleted** (the warn-only code scan). |
| `server/controllers/actionScripts.ts` | **Convert:** credential lookup, then relevant pages, then `convertActionToPlan`; it saves `plan`, `contextPageUrls`, and the credential snapshot. **New route** `POST .../scripts/:actionScriptId/edits`, which saves a new version. **Runs:** a one-run-per-action `Set` guard (409); credential checks (503/409/400); plan re-validation (409); a placeholder plan without a credential (409); `runActionPlan`. **New:** `UPLOADS_FOLDER_NAME`, `findActionCredential`, `allowedOriginsFor`, and `runPlanAndRecordRun`. All JSDoc updated. |
| `server/utils/resolveActionScriptDirectory.ts` | Doc comment only: the folder no longer holds `.mjs` scripts. |

### Files changed — client
| File | Change |
|---|---|
| `src/utils/actionPlanSteps.ts` (new) | The client copy of the plan rules: types, `PLAN_STEP_RULES` (with labels), `ARIA_ROLES`, `PLAN_KEYS`, `PLAN_TARGET_KINDS`. Functions: `readPlanStepRule`, `readPlanTargetKind`, `readPlanTargetText`, `buildPlanTarget`, `describePlanTarget`, `describePlanStep`, `findPlanProblems`, `changePlanStepAction`, `startingValueFor`, `formatPlanJson`. |
| `src/components/ActionPlanSteps.tsx` (new) | Read-only numbered list of steps. |
| `src/components/ActionPlanEditor.tsx` (new) | The step editor: dnd-kit `DndContext` / `SortableContext` with pointer and keyboard sensors, add / move / delete, a problems list, and "Save as new version" / Cancel. |
| `src/components/ActionPlanStepFields.tsx` (new) | One sortable step card: drag handle, Action select, "Find element by", role, text, a value field per value kind, and move / delete buttons. Exports `NO_TARGET_VALUE`. |
| `src/components/ActionScriptDetails.tsx` | Shows the steps, an "Edit steps" button that opens the editor, "Pages given to Claude", and the plan JSON. The caption reads Generated / Edited from Version K plus who it logs in as. The code block and rule warnings were removed. **New:** `describeVersionOrigin`, and `saveWasAttemptedInThisEditor` so the editor never shows a stale save error. New props: `editedFromVersionNumber`, `isSavingEdit`, `saveEditErrorMessage`, `onSaveEdit`. |
| `src/components/ActionScriptsSection.tsx` | New props for edit saving; **new** `editedFromVersionNumberOf`, `describeVersionSource`, `handleSaveEdit`. The details panel is keyed by version. Copy updated; rule-warning counts removed. |
| `src/components/ActionScriptRunsSection.tsx` / `ActionScriptRunDetails.tsx` | New `credentialName` prop and login sentence. Run details show the error message and "logged in as". |
| `src/components/TitleDescriptionForm.tsx` | Optional `credentialOptions` adds a "Log in as" select. **New** exports: `LOGGED_OUT_CREDENTIAL_VALUE`, `CredentialOption`. |
| `src/components/WebsiteItemSummary.tsx` | Optional `detailText` line. |
| `src/pages/ActionDetailPage.tsx` | Edit-save mutation (`saveEditedPlan` / `handleSaveEdit`) and the "Runs as" line; `currentAction` now includes `credentialId`. |
| `src/pages/ActionScriptComparePage.tsx` | Diffs the plan JSON ("Plan") instead of code; edited versions are labelled "edited", and versions without a recorded model "unknown model". |
| `src/pages/WebsiteItemCreatePage.tsx` / `WebsiteItemEditPage.tsx` | For actions: load credentials first (with a load notice), then pass `credentialOptions` and `credentialId`. |
| `src/hooks/useActionScripts.ts`, `useActionScriptRuns.ts`, `useWebsiteItems.ts`, `useCredentials.ts` | New record fields; `useCredentials` gains `isNeeded`. |
| `src/utils/describeActionScriptRun.ts`, `describeScriptStaleness.ts`, `routePaths.ts` | Outcomes are Passed / Timed out / Failed at step N / Failed before the first step. Staleness now includes the credential, joined as "a, b and c". **New** `actionScriptEditsApiUrl`. |

### Files changed — config, tooling, docs
| File | Change |
|---|---|
| `package.json` / `package-lock.json` | Added `@dnd-kit/core@^6.3.1`, `@dnd-kit/sortable@^10.0.0`, `@dnd-kit/utilities@^3.2.2`, and `@mui/icons-material@^7.3.11`. All ship their own types; the icons are pinned to v7 to match `@mui/material`. |
| `.env.example` | `ACTION_SCRIPT_DIR` comment: no `.mjs` files any more, and the `uploads/` folder. |
| READMEs | Root `README.md`, `server/controllers`, `server/services`, `server/utils`, `server/prompts`, `server/prisma`, `src/components`, `src/hooks`, `src/pages`, `tests/README.md`. |

### Tests (written by three agents in parallel, then reconciled by me)
- **New backend:**
  - `tests/backend/utils/actionPlanSchema.test.ts` (195)
  - `tests/backend/utils/selectRelevantCrawledPages.test.ts` (28)
  - `tests/backend/services/actionPlanRunnerService.test.ts` (99): fake `playwright`, every switch case, timeout with fake timers, scrubbing.
- **Rewritten / updated backend:**
  - `scriptGenerationService.test.ts` (45)
  - `crawlerLoginService.test.ts` (+6 for `buildCrawlLoginDetails`)
  - `dbService.test.ts` (98)
  - `api/actions.test.ts` (32)
  - `api/actionScripts.test.ts` (75): convert, edits, runs, guards.
  - `server.test.ts`
  - `validateRequestBodies.test.ts` (181)
- **New frontend:**
  - `actionPlanSteps.test.tsx` (69)
  - `ActionPlanSteps.component.test.tsx` (3): the macOS case-insensitive name clash is noted in `tests/README.md`.
  - `ActionPlanStepFields.test.tsx` (18)
  - `ActionPlanEditor.test.tsx` (15): keyboard drag-and-drop with faked card geometry.
- **Updated frontend:** `ActionDetailPage`, `ActionScriptComparePage`, `ActionScriptDetails`, `ActionScriptsSection`, `ActionScriptRunsSection`, `ActionScriptRunDetails`, `describeActionScriptRun`, `describeScriptStaleness`, `WebsiteItemCreatePage`, `WebsiteItemEditPage`, `TitleDescriptionForm`, `WebsiteItemSummary`, `useCredentials`, `routePaths`, and the `frontendTestHelpers.tsx` fixtures.
- **Removed, with the functionality, at the user's request:**
  - `scriptRunnerService.test.ts` and `findScriptRuleViolations.test.ts`;
  - rule-warning, exit-code / signal, and `.mjs` code-display cases, each replaced by tests of the new behaviour.
- **No test was skipped.**

### Verification performed
- `npm run test:coverage`: **100 files, 2004 tests passed.** All files: 99.55% statements, 98.92% branches, 100% functions, 99.85% lines (thresholds 80/70/80/80).
- `npm run lint`, `npm run tsc`, and `npm run tsc:client`: clean.
- **Prompt caching** (direct script, two conversions on Opus 5.5): the first wrote 7,784 tokens to the cache, the second read 7,784 from it. The API accepted the hand-built schema with the action `enum`.
- **Dev server** (the user's own `npm run dev`, already running): `/api/health` returned ok; homepage 200.
- **End to end with throwaway Playwright scripts** (`claude_tmp/verify/`) against the login fixture site (`claude_tmp/loginFixtureSite.mts`, port 3099, started and stopped by me):
  1. Created a website, credential, and logged-in crawl (6 pages).
  2. Created an action with "Log in as" Admin; the edit form preselects it.
  3. Converted with a real Claude call: 7 steps, 6 pages given to Claude, plan JSON in field order.
  4. Ran it: "Passed · 3.1 s"; the log shows the login and the steps, never the password.
  5. Edited: move up / down, delete, mouse drag (swapped two steps), add, a problem blocking Save. Saved as Version 2 "Edited from Version 1", which passed.
  6. Broke a target and saved Version 3: "Failed at step 4" with the error and a failure screenshot that loads.
  7. Compare page showed the Plan diff and labelled edited versions.
  8. Switching the action to logged out marked the versions "Out of date … credential".
  9. API: `evaluate`, `__proto__`, a goto to another site, and `{{credential.password}}` in a log step were all rejected with 400. A whole-value placeholder was accepted; running it while logged out was refused with 409.
  10. No browser console errors.
- **Re-checked after the follow-up fix:** a server-rejected save shows "Could not save", and reopening the editor shows no stale error.

### Notable during implementation
- The Playwright MCP hung (in `--extension` mode it waits for the Chrome extension), so the verifier agent could not drive it. The user picked the script fallback.
- I mistakenly ran `git rm --cached` on the old prompt file, which staged a deletion. I undid it at once with `git restore --staged`; the user's index is unchanged.
- `npm install` printed 4 high-severity audit warnings. They come from the existing Prisma dependencies (`deepmerge-ts`, `mysql2`), not from the new packages.
- The frontend test agent found that a failed save's error came back after reopening the editor, and that the compare page labelled a model-less generated version "edited". Both were fixed in source (`ActionScriptDetails`, `ActionScriptComparePage`) with new tests.
- Left in the dev database for the user to inspect: the "Login fixture" website (http://localhost:3099/) with its "Admin" credential, the "Open account settings" action (4 versions), and its runs.

---

## 2026-10-03 14:37 EDT — Website login URL (inherited, learned) + crawl button modes (built by multiple agents)

**Intent:**
- **Part A: a website login URL.**
  - A website gets an optional login page URL; blank means it doesn't require login.
  - Credentials inherit it unless they set their own.
  - A website without one **learns** it from a crawl that logged in successfully: once now for existing data, and from then on.
- **Part B: button modes for crawls.**
  - **Links only:** the default; no buttons are clicked.
  - **All except risky:** create, delete, update, logout, pay, confirm and similar are never clicked.
  - **Open only:** only "open" buttons, the strictest.
  - A click only counts when it lands on a new same-site URL. That URL is crawled like a link.
- At the user's request the work was split across **multiple agents** with disjoint file ownership. I did the shared groundwork first, then three agents worked in parallel, then I integrated and verified.

### Decisions (made by the user)
- **Login URL:**
  - A credential's login URL is an optional override; blank inherits the website's.
  - Credentials and "Crawl as" are hidden only when **neither** the website nor any credential has a login URL. A website with a login URL keeps "Logged out" as the crawl default.
  - The API answers 400 only when no login URL exists anywhere.
  - The website learns a login URL from a successful login, and the existing data was backfilled.
- **Buttons:**
  - Three modes, as above.
  - Only clicks that land on new same-site URLs are recorded.
  - The risky-word list, the 20-buttons-per-page cap, and never clicking unlabelled or disabled buttons were my proposals; the plan was approved with them.

### Data backfill (run once with psql, preview shown first)
- Each active website without a login URL took one from a credential whose crawl had logged in (`isLoggedIn`), using the most recent such run. Only **Forge Gym management** changed: it got `https://forge.aikazi.com/login`, from "Gym Owner".
- Its credentials keep their own matching URL, which can be blanked so they inherit.

### Step 0, groundwork (me)
| File | Change |
|---|---|
| `server/prisma/schema.prisma` | `Website.loginUrl String?`, `Credential.loginUrl String?` (was required), `CrawlRun.buttonMode String @default("linksOnly")`, `CrawledPage.buttonUrls String[] @default([])`, `CrawledPage.foundByButtonText String?`, and the doc comments. Ran `prisma db push` and `prisma generate`. |
| `server/utils/crawlButtonModes.ts` (new) | `CRAWL_BUTTON_MODES`, `CrawlButtonMode`, `DEFAULT_CRAWL_BUTTON_MODE`, `isCrawlButtonMode`. |
| `server/services/dbService.ts` | **New:** `adoptWebsiteLoginUrl(websiteId, loginUrl)` (an `updateMany` where `loginUrl` is null, so it never overwrites). **Changed:** `WebsiteInput.loginUrl?`, `CredentialInput.loginUrl: string \| null`, `CrawlRunInput.buttonMode?`, `CrawledPageInput.foundByButtonText` and `buttonUrls`; `CrawledPageSummary` and `listCrawledPageSummariesForRun` also omit `buttonUrls`. |
| `server/services/crawlerService.ts` | `crawlWebsite(..., buttonMode = DEFAULT_CRAWL_BUTTON_MODE)` with `CrawlContext.buttonMode` (Agent 2 then wired it). |
| `server/services/crawlRunService.ts` | `buildCredentialLogin(credential, website, ...)` uses the effective login URL `credential.loginUrl ?? website.loginUrl` and throws when both are null (Agent 1 took it from there). |
| Client record types | `WebsiteRecord.loginUrl`, `CredentialRecord.loginUrl` (nullable), `CrawlRunRecord.buttonMode` + `CrawlButtonModeRecord`, `CrawledPageSummaryRecord.foundByButtonText`, `CrawledPageRecord.buttonUrls`. |
| Tests | Builder fields in `tests/frontend/support/frontendTestHelpers.tsx`; fixture fields in `crawlRunService`, `dbService` and `crawlerService` specs; `dbService.test.ts`: `adoptWebsiteLoginUrl` (2 tests) and the summary omit; `tests/backend/server.test.ts`: `loginUrl: null` in the website wiring expectation, which Agent 1 flagged. |

### Step 1, agents (each owned its own files)
- **Agent 1, server API and run start:**
  - **`validateRequestBodies.ts`:**
    - New: `readOptionalHttpUrl`, `LOGIN_URL_INVALID_MESSAGE`, `readOptionalCrawlButtonMode`, `BUTTON_MODE_INVALID_MESSAGE`.
    - `validateWebsiteInput` returns `loginUrl`; `validateCredentialInput` makes `loginUrl` optional; `validateCrawlRunStartInput` and `CrawlRunStartInput` gain `buttonMode`.
  - **`credentials.ts`:** `NO_LOGIN_URL_ANYWHERE_MESSAGE` and `credentialHasNoEffectiveLoginUrl`; POST and PUT answer 400 when neither the body nor the website has a URL.
  - **`crawlRuns.ts`:** `CREDENTIAL_HAS_NO_EFFECTIVE_LOGIN_URL_MESSAGE`, a 400 for a credential with no effective URL, and `buttonMode` passed through.
  - **`websites.ts`:** JSDoc for `loginUrl`.
  - **`crawlRunService.ts`:** new `learnWebsiteLoginUrl` (calls `adoptWebsiteLoginUrl` and logs failures) and `buildCrawlLogin` (`recordLoginSucceeded` learns the URL when the website has none); `startCrawlRun(..., buttonMode = DEFAULT_CRAWL_BUTTON_MODE)` stores the mode and passes it on.
  - **Specs:** 5 specs, 287 tests (59 new).
- **Agent 2, crawler engine:**
  - **`pageActionService.ts` (new),** moved out of `crawlerLoginService`: `trackPageRequests`, `PageRequestTracker`, `waitForTrackedRequestsToFinish`, `waitOutMinimumWaitSince`, `ACTION_REQUESTS_QUIET_WINDOW_MS`, `ACTION_REQUESTS_POLL_INTERVAL_MS`.
  - **`crawlerButtonService.ts` (new):**
    - Constants: `CLICKABLE_BUTTON_SELECTOR`, `RISKY_BUTTON_WORDS`, `RISKY_BUTTON_TEXT_PATTERN`, `OPEN_BUTTON_TEXT_PATTERN`, `BUTTON_CLICKS_PER_PAGE_LIMIT` (20), `BUTTON_CLICK_TIMEOUT_MS`.
    - Exported: `readRawPageButtons` (runs in the browser, anonymous), `chooseButtonsToClick`, `followPageButtons`, and the `RawPageButton`, `ChosenButton` and `ButtonLink` types.
    - Private helpers: `buildRiskyWordPatternSource`, `buttonTextPassesMode`, `readPageButtons`, `reloadButtonPage`, `clickAndWaitForResult`, `readButtonLink`, `followOneButton`.
  - **`crawlerService.ts`:**
    - `QueuedCrawlUrl.foundByButtonText`, `PageVisit.buttonLinks`.
    - New `followButtonsWhenAsked`, `isUnseenAndSafeToQueue`, `claimUnseenButtonLinks`, `closePopupQuietly`.
    - `visitCrawlPage` takes the context and clicks buttons only on fully succeeded, same-origin pages, after the snapshot and links are read; its `durationMs` includes the clicks.
    - `crawlNextPage` claims links first, then buttons.
    - `crawlWithPage` closes pop-ups when buttons are on.
  - **`crawlerLoginService.ts`:** the helpers moved out, with no behaviour change.
  - **Specs:** 4 specs, 180 tests (new `pageActionService` with 12 and `crawlerButtonService` with 74; `crawlerService` gained 11).
- **Agent 3, frontend:**
  - `WebsiteForm` gets the "Login page URL" field (`WebsiteRequestBody.loginUrl`), passed through by `WebsiteCreatePage` and `WebsiteEditPage`.
  - `WebsiteDetailPage`:
    - shows the login line;
    - `loginFeaturesAreShown` hides Credentials and "Crawl as" when no URL exists anywhere;
    - holds the Buttons mode and POSTs `{ credentialId, buttonMode }`.
  - `CredentialForm` gains the `websiteLoginUrl` prop: an optional override with a placeholder, or required.
  - `CredentialCreatePage` uses `NEW_CREDENTIAL_VALUES` (all blank) instead of `buildNewCredentialValues`.
  - `CredentialEditPage` waits for both the credential and the website.
  - `describeCrawlRun` gets `describeCrawlButtonMode` and `formatCrawlButtonModeSuffix`.
  - `CrawlRunsSection`:
    - the Buttons select;
    - `crawlAsPickerIsShown`, `selectedButtonMode` and `onSelectedButtonModeChange` props;
    - `DEFAULT_CRAWL_BUTTON_MODE`;
    - the description no longer says "never clicks buttons";
    - history mode text.
  - `CrawlRunPage` shows the mode text.
  - `CrawlSiteMap` adds the "via “…”" suffix.
  - `CrawledPageDetails` gets the found-by text, a new internal `CrawledUrlList`, and a "Pages its buttons led to" list.
  - **Specs:** 587 frontend tests (37 new).

### Docs (me)
- `server/services/README.md` covers the new modules, the button modes section with the risky-word list, and the run start and learning.
- Also updated: `server/controllers/README.md`, `server/utils/README.md`, `server/prisma/README.md`, `src/pages/README.md`, `src/components/README.md`, `src/hooks/README.md` and `README.md`.

### Tests
- No test was removed or skipped.
- Updated expectations only where the behaviour changed: request bodies now carry `loginUrl` and `buttonMode`; the credential login URL starts blank; the run outcome objects gained fields.

### Verification performed
- **Checks:**
  - `npm run test:coverage`: **1462 tests in 95 files, all passing**. Statements 99.49%, branches 98.9%, functions 100%, lines 99.81%.
  - `npm run lint`, `npm run tsc`, and `npm run tsc:client`: clean.
- **Live API runs** against the user's dev server and the fixture site, extended with a buttons-only `/sessions` page. The site has open, neutral, risky, icon-only and disabled buttons, plus a dialog button, and counts hits on the forbidden targets.

  | Run | Result |
  |---|---|
  | Links only | no `/sessions/*` pages |
  | All except risky | yoga, pilates (a `pushState` URL change) and details, each with `foundByButtonText`; `/sessions.buttonUrls` lists all three |
  | Open only | yoga and pilates only |

  - **Across all three modes,** every risky, icon, disabled and logout target got **0 hits**.
  - **Part A:**
    - A credential with a blank URL inherits the website's and logs in.
    - A credential overriding with a broken URL fails with HTTP 404, which proves its own URL is used.
    - Website B, with no URL, learned `http://localhost:3099/login` from a credential's successful login.
    - Website C: creating a credential without a URL answers 400.
    - An unknown button mode answers 400.
- **Manual-verifier agent (Playwright MCP): VERIFIED.**
  - The login line on the website pages, with C hiding Credentials and "Crawl as".
  - The website and credential form fields, with C's credential URL required.
  - The Buttons select options.
  - The history and run page mode text.
  - The "via" labels and the "Pages its buttons led to" list.
  - Forge shows its backfilled login URL; it was not crawled.
  - 0 console errors.

### Notable during implementation
- **Every Prisma model type resolves to `any`** under `tsconfig.server.json` (`npm run tsc`, nodenext), so the server typecheck never catches Prisma field mistakes. `npm run tsc:client` (the bundler resolution, which includes the tests) resolves them correctly and caught them. This predates the change; no config was edited.
- The agents noted lint errors in `tests/` that predate the change (not covered by `npm run lint`); they were left alone.

---

## 2026-10-03 13:46 EDT — Crawled pages: record redirects where they landed

**Intent:**
- The user asked why Forge's `/calendar` page was "excluded" from a crawl. It wasn't. Forge redirects `/` to `/calendar` when you're logged in. The start page was recorded under the URL it was requested at (`/`), so the site map labelled the calendar page "/".
- The user wants redirects visible both in the data and on the crawled page.

### Decisions (made by the user)
- **"Name the row by where it landed":**
  - A redirected page is recorded under the origin + path the browser ended up on, with a new `wasRedirected` flag. `requestedUrl` keeps where it was sent.
  - If the landing page is already recorded in the crawl, the page keeps the identity it was requested at, so there are no duplicate rows, and its `finalUrl` names the page it landed on.

### Files changed — server
| File | Change |
|---|---|
| `server/prisma/schema.prisma` | **`CrawledPage`:** added `wasRedirected Boolean @default(false)`. The doc comment now explains that `url` is where the browser landed, and gives the exception. `prisma format` realigned the block. Ran `prisma db push` and `prisma generate`. |
| `server/services/dbService.ts` | `CrawledPageInput` gained `wasRedirected`; the `url` doc was updated. |
| `server/services/crawlerService.ts` | **New module-private:** `RecordedIdentity`; `decideRecordedIdentity(state, queuedUrl, finalUrl)`, which picks the landing identity unless it's already recorded; and `claimRecordedIdentity(state, url)`, which remembers the identity and drops it from the queue. **Changed:** `CrawlState` gained `recordedIdentityUrls`; `visitCrawlPage` and `buildUnreadablePageVisit` record the decided identity plus `wasRedirected`; `crawlNextPage` claims the identity before counting progress. The `crawlWebsite` doc was updated. |

### Files changed — client
| File | Change |
|---|---|
| `src/hooks/useCrawlRunProgress.ts` | `CrawledPageSummaryRecord` gained `wasRedirected`. |
| `src/utils/describeCrawlRun.ts` | **New:** `identifyCrawledUrl` (origin + path, like the crawler); `describeCrawledPagePath(page)`, which gives "/schools", "/calendar (from /)" or "/old-account → /account", and shows the full origin when a redirect left the site; and `CrawledPageLabelFields`. **Module-private:** `formatRedirectEnd`. |
| `src/components/CrawlSiteMap.tsx` | Rows are labelled with `describeCrawledPagePath`. |
| `src/components/CrawledPageDetails.tsx` | The heading uses `describeCrawledPagePath`. |
| `src/pages/CrawlRunPage.tsx` | **New module-private** `mapVisitedPagesByUrl`: pages are also found by their requested identity, so a link to "/" selects the page recorded as "/calendar". A recorded identity always wins. |

### Docs
`server/services/README.md`, `server/prisma/README.md`, `src/components/README.md`, and `src/pages/README.md`.

### Tests
- **`crawlerService.test.ts`:**
  - Updated to the new identity rule, as the user requested: the http→https www start page is now recorded as `https://www.example.com/`; the off-site redirect is recorded under its landing URL; "never loads a page a link already redirected to" became "records a redirected page under where it landed, and never loads that page again"; `wasRedirected: false` was added to two full-object expectations.
  - **New tests:**
    - The start page redirect (`/` → `/calendar`).
    - A redirect onto a still-queued page, which is taken off the queue and visited once.
    - A redirect onto an already-recorded page, which keeps the requested identity.
    - A query-string-only change, which is not a redirect.
    - A redirected page that never became ready.
- **`describeCrawlRun.test.tsx`:** `identifyCrawledUrl`, and six `describeCrawledPagePath` cases (none, landed, already recorded, off-site, already-recorded off-site, unparseable).
- **`CrawlRunPage.test.tsx`:** the site map and heading labels, plus a link to "/" from another page selecting the "/calendar (from /)" page.
- Fixtures (`crawlRunService`, `dbService`, `frontendTestHelpers`) gained `wasRedirected`.
- No test was removed or skipped.

### Verification performed
- **Checks:**
  - `npm run test:coverage`: **1267 tests, all passing**. Statements 99.45%, branches 98.79%, functions 100%, lines 99.8%.
  - `npm run lint`, `npm run tsc`, and `npm run tsc:client`: clean.
- **Live crawl** of the fixture site (`claude_tmp/loginFixtureSite.mts`), logged in, after adding four redirect cases:
  - `/` → `/dashboard` in the browser was recorded as `/dashboard`, `wasRedirected`.
  - `/to-settings` → 302 → `/account/settings`, while that page was still queued, was recorded as `/account/settings` and visited once.
  - `/account` was not redirected.
  - `/old-account` → 302 → the already-recorded `/account` was recorded as `/old-account` with `finalUrl` `/account`.
  - `/home` → `/dashboard`, already recorded, was recorded as `/home`.
- **Manual-verifier agent (Playwright MCP): VERIFIED.**
  - Site map rows read "/dashboard (from /)", "/account/settings (from /to-settings)", "/account", "/old-account → /account", and "/home → /dashboard".
  - The headings match.
  - The "/" link selects the dashboard page.
  - Logout links show as not visited.
  - 0 console errors.

### Notable during implementation
- Crawls run before this change keep their old rows: no backfill was done, so they still show "/" for a redirected start page. A new crawl records redirects the new way.

---

## 2026-10-03 13:30 EDT — Login: wait for the site's answer before judging it

**Intent:**
- The user saw logged-in crawls of their Forge site fail too soon.
- Diagnosis:
  - After the submit click, the crawler waited for `load` and for `waitForPageReadiness`. Both return at once on a single-page app that signs in with `fetch`: the page never navigates, and it was already network-idle before the click.
  - So the crawler judged the login about 30 ms after the click.
  - Evidence: Forge's failure screenshot showed the button still reading **"Signing in…"**, and the whole crawl took 1.5 s.

### Decisions (made by the user)
- Picked "wait for the form to go":
  - **On success**, the crawl goes on as soon as the password field disappears.
  - **A failure is only declared** once the requests the submit started have finished (capped by the website's network idle cap), the website's minimum wait has passed, and the password field is still there after a 15 s limit.

### Files changed — server
| File | Change |
|---|---|
| `server/services/crawlerLoginService.ts` | **Removed:** `LOGIN_NAVIGATION_TIMEOUT_MS` and the post-submit `waitForLoadState` + `waitForPageReadiness` step, with its "did not become ready" failure. **New constants:** `LOGIN_RESULT_TIMEOUT_MS` (15 s), `SIGN_IN_REQUESTS_QUIET_WINDOW_MS` (500 ms), `SIGN_IN_REQUESTS_POLL_INTERVAL_MS` (100 ms). **New module-private:** `SignInRequestTracker` and `trackSignInRequests` (count `request` / `requestfinished` / `requestfailed` from just before the submit, then detach); `waitForSignInRequestsToFinish`; `waitOutMinimumWaitSinceSubmit`; `waitForLoginFormToGo`; and `waitForLoginResult`, which waits for the form to go, then for the requests to finish, then for the minimum wait, then looks at the password field once more. **Changed:** `logInWithCredential` fills the fields, starts tracking, submits, and returns `waitForLoginResult`'s verdict. The tracker is always stopped in a `finally`. |

### Docs
- `server/services/README.md`: the login steps were rewritten.
- `README.md`: the crawl paragraph was extended.

### Tests
`tests/backend/services/crawlerLoginService.test.ts`. The fake page gained request events (`on`/`off`), `waitForTimeout`, a "hidden" state for `waitFor`, and click failures.
- **New tests:**
  - The exact order: ready → type → submit → wait for the form to go → 5 quiet checks → final look.
  - Waits for in-flight sign-in requests (7 busy checks + 5 quiet).
  - Stops at the website's idle cap.
  - Skips the wait when the cap is 0.
  - Honours the minimum wait since the submit.
  - Stops listening once done.
  - A click failure.
  - The form vanishing for a moment and coming back, which must fail.
  - The form outlasting the 15 s but gone at the final look, which succeeds.
- **Replaced:** "fails when the page after submitting never loads" became "fails when the page closes while waiting for the sign-in". The step it tested was removed as part of this requested change.
- **Changed:** the wrong-password test now checks the 15 s wait.

### Verification performed
- **Checks:**
  - `npm run test:coverage`: **1253 tests, all passing**. Statements 99.44%, branches 98.77%, functions 100%, lines 99.79%. `crawlerLoginService.ts` is at 100%.
  - `npm run lint`, `npm run tsc`, and `npm run tsc:client`: clean.
- **Live run** against the user's `npm run dev`. The fixture site (`claude_tmp/loginFixtureSite.mts`) gained `/spa-login`, a Forge-like app login: `fetch` to an API that answers after 2 s, "Signing in…" meanwhile, and a client-side swap to the dashboard. The test website used Forge's settings (5000 ms cap, 1 ms minimum).

  | Login | Result | Crawl time |
  |---|---|---|
  | App login, right password | **logged in**, 5 pages (the old code would have failed this) | 6.9 s |
  | App login, wrong password | failed, with "Still on the login form" | 16.4 s |
  | Classic form, right password | logged in | 4.3 s |
  | Classic form, wrong password | failed; the mid-reload vanish was not taken for success | 16.4 s |

  - The failure screenshot now shows the site's answer ("Wrong email or password", button back to "Sign in"), not "Signing in…".
  - Logout links were hit 0 times.
  - The app-login and classic-form runs were re-run after the final refactor, with the same results.

### Notable during implementation
- Forge's other failure (17:17:25, "No visible password field") is a separate problem. Its screenshot shows that `/login` rendered Forge's welcome card ("Log in / Create an account") instead of the form for the full 10 s, while the next run got the form. Not addressed here.

---

## 2026-10-03 13:08 EDT — Website credentials + logged-in crawls (with a login failure screenshot)

**Intent:**
- Add a **Credentials** table: a name, description, username, and password per website, with the password stored securely.
- Let a crawl be started **as a chosen credential**. The crawler logs in first and records nothing until the login has worked.
- Note on the **crawl run** whether it viewed the site logged in, and which credential produced it.
- Mid-task follow-ups from the user:
  - Take a **screenshot when the login fails**.
  - Make sure the crawler **waits for the page to finish loading** before it types the password, using the website's own timing minimums.

### Decisions (all made by the user)
- **Passwords are encrypted, not hashed.** The crawler has to type the real password, so it uses AES-256-GCM with `CREDENTIAL_ENCRYPTION_KEY`, 32 random bytes in base64. The user had already put a valid key in `.env.local`; it was kept, not regenerated. The API never returns the password or its ciphertext.
- **Finding the login form:** the credential stores a `loginUrl`. The crawler finds the username field, password field, and submit button itself. Optional CSS selectors on the credential override each guess.
- **A credential belongs to one website** (`websiteId`).
- **`isLoggedIn` lives on `CrawlRun`, not `CrawledPage`.** This was the user's correction to the first plan. No page is recorded until the login succeeds, so the run-level flag holds for every page. The run also keeps `credentialId`.
- **A failed login ends the run `failed`** with no pages, and `errorMessage` says `Login as "<name>" failed: <reason>`. The user first chose "crawl logged out" and then changed it to this.
- **While logged in, logout links are never followed** (`logout`, `log-out`, `sign_out`, `logoff`, and similar). They are still listed in the page's `linkedUrls`.
- **Login waits follow the website's own settings.** The login page gets the same `waitForPageReadiness` every crawled page gets: network idle up to `networkIdleTimeoutMs`, then paint, then the rest of `screenshotMinimumWaitMs`. Only after that are the fields typed into. The page after submitting gets the same wait before the result is checked.
- **The login failure screenshot follows the screenshot-run convention:** a PNG at `<websiteId>/<uuid>.png` in `SCREENSHOT_DIR`, served by a new route, and shown on the crawl run page.
- **My default:** `description` is optional, like `Website.description`.

### Files changed — server
| File | Change |
|---|---|
| `server/prisma/schema.prisma` | **New model:** `Credential` (`credentials`) with `name`, `description?`, `username`, `encryptedPassword`, `loginUrl`, and `usernameSelector?` / `passwordSelector?` / `submitSelector?`. **`CrawlRun`:** added `credentialId?` (with relation and index), `isLoggedIn` (default false), and `loginFailureScreenshotFileName?`. **`Website`:** added `credentials`. Doc comments updated. Ran `prisma db push` and `prisma generate`. |
| `server/utils/credentialEncryption.ts` (new) | `readCredentialEncryptionKey`, `credentialEncryptionIsConfigured`, `encryptCredentialPassword`, `decryptCredentialPassword`, `CREDENTIAL_KEY_NOT_CONFIGURED_MESSAGE`, `CREDENTIAL_ENCRYPTION_KEY_VARIABLE`. **Module-private:** `requireCredentialEncryptionKey`. |
| `server/services/dbService.ts` | **New:** `listCredentialsForWebsite`, `findCredentialForWebsite`, `findCredentialWithPasswordForWebsite`, `createCredentialForWebsite`, `updateCredentialForWebsite`, `softDeleteCredentialForWebsite`, `markCrawlRunLoggedIn`. **New types:** `CredentialInput`, `CredentialSummary`, `CrawlRunWithCredential`, `CrawlRunCredentialSummary`; `Credential` is re-exported. **Changed:** `softDeleteWebsite` also deletes credentials (nine tables); `CrawlRunInput` gained `credentialId`; `CrawlRunFinish` gained `loginFailureScreenshotFileName`; `listCrawlRunsForWebsite`, `findCrawlRunForWebsite`, and `createCrawlRunForWebsite` include `credential { id, name }`. **Module-private:** `CRAWL_RUN_CREDENTIAL_INCLUDE`, `OMIT_ENCRYPTED_PASSWORD`. |
| `server/utils/validateRequestBodies.ts` | **New:** `validateCredentialInput(body, { passwordIsRequired })`, `CredentialRequestInput`, `validateCrawlRunStartInput`, `CrawlRunStartInput`. **Module-private:** `readOptionalTrimmedText`, `CREDENTIAL_SELECTOR_FIELDS`. |
| `server/controllers/credentials.ts` (new) | `registerCredentialRoutes`: `GET`/`POST /api/websites/:websiteId/credentials` and `GET`/`PUT`/`DELETE .../credentials/:credentialId`. Responses carry `hasPassword: true` and never the password. PUT keeps the saved password when none is sent. **Module-private:** `toCredentialResponse`, `CredentialResponse`. |
| `server/controllers/crawlRuns.ts` | `registerCrawlRunRoutes(app, screenshotDirectory)`. **POST** reads an optional `{ credentialId }`: 400 for a bad id, 404 "Credential not found", 503 when the key is missing. **New route** `GET .../crawl-runs/:crawlRunId/login-failure-screenshot`. |
| `server/services/crawlerLoginService.ts` (new) | `logInWithCredential`, `captureLoginFailureScreenshot`, `CrawlLoginDetails`, `LoginAttempt`. **Constants:** `LOGIN_STEP_TIMEOUT_MS`, `LOGIN_NAVIGATION_TIMEOUT_MS`, `DEFAULT_PASSWORD_FIELD_SELECTOR`, `DEFAULT_USERNAME_FIELD_SELECTOR`, `DEFAULT_SUBMIT_BUTTON_SELECTOR`, `STILL_ON_LOGIN_FORM_MESSAGE`. **Module-private:** `loginFailed`, `describeSelectorSource`, `waitUntilVisible`, `locateLoginFormScope`, `submitLoginForm`. |
| `server/services/crawlerService.ts` | `crawlWebsite(..., login: CrawlLogin \| null = null)`. **New:** `isLogoutLink`, `CrawlLogin`; stop reason `loginFailed`; `CrawlOutcome` gained `loginErrorMessage` and `loginFailureScreenshotWasCaptured`. **Module-private:** `LOGOUT_PATH_PATTERN`, `LoginStep`, `logInWhenAsked`; `CrawlState` gained `isLoggedIn`. **Changed:** `claimUnseenLinks` skips logout links while logged in; `crawlWithPage` logs in first. |
| `server/services/crawlRunService.ts` | `startCrawlRun(website, credential, screenshotDirectory)` decrypts the password before claiming the website. **Module-private:** `CredentialLogin`, `CrawlRunEnding`, `buildCredentialLogin`, `describeCrawlRunEnding`. **Changed:** `runCrawlInBackground` marks the run logged in, maps `loginFailed` to a `failed` status, and records the screenshot name; `recordCrawlFailure` writes `loginFailureScreenshotFileName: null`. |
| `server/server.ts` | Registers `registerCredentialRoutes` and passes `SCREENSHOT_DIRECTORY` to `registerCrawlRunRoutes`. |
| `.env.example` | Documents `CREDENTIAL_ENCRYPTION_KEY` and how to generate it. |

### Files changed — client
| File | Change |
|---|---|
| `src/hooks/useCredentials.ts` (new) | `useCredentials`, `useCredential`, `CredentialRecord`, `CredentialRequestBody`. |
| `src/hooks/useCrawlRuns.ts` | `CrawlRunRecord` gained `credentialId`, `isLoggedIn`, `credential`, and `loginFailureScreenshotFileName`. New `CrawlRunCredentialRecord`. |
| `src/utils/routePaths.ts` | **New:** `newCredentialPath`, `credentialEditPath`, `credentialsApiUrl`, `credentialApiUrl`, `crawlRunLoginFailureScreenshotApiUrl`. |
| `src/utils/describeCrawlRun.ts` | **New:** `describeCrawlRunLogin`, `crawlRunLoginSeverity`, `CrawlRunLoginFields`. |
| `src/components/CredentialForm.tsx` (new) | The credential form, including the optional "Login form selectors" group. On edit, a blank password keeps the saved one. |
| `src/components/CredentialsSection.tsx` (new) | The "Credentials" section on a website's page. **Module-private:** `describeCredentialRow`. |
| `src/components/CrawlRunsSection.tsx` | "Crawl as" picker (`TextField select` with `displayEmpty`); new props `credentials`, `selectedCredentialId`, `onSelectedCredentialChange`; exports `CRAWL_LOGGED_OUT_VALUE`. History rows now show the login line. |
| `src/pages/CredentialCreatePage.tsx`, `src/pages/CredentialEditPage.tsx` (new) | Create and edit pages. Delete lives on the edit page. Routes added in `src/App.tsx`. |
| `src/pages/WebsiteDetailPage.tsx` | Fetches credentials, renders `CredentialsSection`, and holds the "Crawl as" state. `startCrawl` POSTs `{ credentialId }`. The delete dialog counts credentials. |
| `src/pages/CrawlRunPage.tsx` | A `role="note"` login line, plus a "Login failure screenshot" section when the run has one. |

### Docs
`README.md`, `USECASES.md`, `server/controllers/README.md`, `server/services/README.md`, `server/utils/README.md`, `server/prisma/README.md`, `src/pages/README.md`, `src/components/README.md`, and `src/hooks/README.md`.

### Tests
- **Backend, new:**
  - `tests/backend/api/credentials.test.ts`: every route and status, and that no response contains a password.
  - `tests/backend/utils/credentialEncryption.test.ts`: round trip, fresh IV, wrong or missing key, tampered values.
  - `tests/backend/services/crawlerLoginService.test.ts`: a fake login form; a test pinning **load → readiness with the website's settings → typing → submit → load → readiness**; every failure message; the failure screenshot.
- **Backend, updated:**
  - `crawlRuns.test.ts`: the credential body, 400, 404, 503, and the screenshot route.
  - `crawlRunService.test.ts`: decryption, login marking, failed login, screenshot name.
  - `crawlerService.test.ts`: login before the first page, logout links skipped, `isLogoutLink`, failed-login screenshot. The outcome objects gained two fields.
  - `dbService.test.ts`: credential queries, `omit`, the cascade to nine tables, `markCrawlRunLoggedIn`.
  - `validateRequestBodies.test.ts` and `server.test.ts` wiring.
- **Frontend, new:** `CredentialForm`, `CredentialCreatePage`, `CredentialEditPage`, `useCredentials`.
- **Frontend, updated:**
  - `CrawlRunsSection`: the picker and login labels.
  - `WebsiteDetailPage`: the credentials section, the POST body, the dialog text.
  - `CrawlRunPage`: the login note and screenshot.
  - `describeCrawlRun`, `routePaths`, `App` routes, and `frontendTestHelpers` (`buildCredentialRecord`, new run fields).
- No test was removed or skipped.

### Verification performed
- **Checks:**
  - `npm run test:coverage`: **1245 tests in 93 files, all passing**. Statements 99.43%, branches 98.77%, functions 100%, lines 99.79%.
  - `npm run lint`, `npm run tsc`, and `npm run tsc:client`: clean.
- **Live run** against the user's running `npm run dev` and a throwaway login fixture site (`claude_tmp/loginFixtureSite.mts` on :3099):
  - **Correct password:** run `finished` with `isLoggedIn: true` and the credential named. `/dashboard`, `/account`, and `/account/settings` were reached without redirecting to `/login`. The fixture's logout URLs were hit 0 times.
  - **Wrong password:** run `failed` with `Login as "Wrong password" failed: Still on the login form...` and 0 pages. The served screenshot shows the fixture's "Wrong email or password".
  - **No credential:** run logged out; protected pages ended at `/login`.
  - **API errors:** 400 and 404 behave as specified.
  - **Database:** the stored passwords are ciphertext only.
- **Manual-verifier agent (Playwright MCP), two passes, both VERIFIED:**
  - Credential create, edit (blank password keeps the saved one; a crawl still logs in), and delete (history keeps the name).
  - The "Crawl as" picker, history labels, and run page login notes.
  - The website delete dialog's credential count.
  - The login failure screenshot section, which appears only on failed-login runs.
  - No console errors.

### Notable during implementation
- The manual-verifier noticed the "Crawl as" select looked empty on first load: MUI renders a `""` value as blank. Fixed with `displayEmpty` and a shrunk label.
- MUI's `Alert` defaults to `role="alert"`. The login line is a standing fact, so it uses `role="note"` and no longer competes with real alerts.
- `prisma format` realigned the `CrawlRun` field block; nothing else in the schema changed.

---

## 2026-10-03 11:59 EDT — Website crawler: page tree + aria snapshot per page

**Intent:**
- **Change of strategy:** instead of only screenshotting a website's start URL, **crawl** it. The crawler follows the site's links, maps every page it reaches as a **tree**, and records each page's Playwright **aria snapshot** (`await page.locator('body').ariaSnapshot()`, the call the user asked for).
- First target was this app's own dev server (`http://localhost:5180/`).
- Before planning, a one-off script captured the aria snapshots of forge.aikazi.com and of the dev app into `claude_tmp/aria-snapshots/`.

### Decisions (all made by the user)
- **Full app feature:** Prisma tables, service, API, and UI, modelled on screenshot runs.
- **Links only:** read `<a href>` and visit same-origin URLs; never click buttons.
- **Background + live progress:** the POST answers at once with a `running` run, and the UI polls.
- **Limits:** a fixed cap of 50 pages (failed pages count) and a 10-minute time limit.
- **URL identity ignores both `#hash` and `?query`.** A page is loaded with the query of the first link that reached it.
- **Tree via a self-relation:** `CrawledPage.parentPageId` → `CrawledPage`, null for the start page. This was the user's feedback on the plan.
- **Browser closes mid-crawl** (a `tsx watch` restart): stop at once, record no fake pages, and mark the run `interrupted`.
- **Keep** the test website, its crawls, and `claude_tmp/`.
- The misleading run produced by the bug found during verification is **left in place**.
- Proposed defaults, approved with the plan:
  - one crawl at a time per website (409);
  - readiness reuses the website's screenshot timing settings;
  - trailing slash kept;
  - `<a download>` skipped;
  - links are read from every loaded page whose final URL is on the crawl's origin.

### Files changed — server
| File | Change |
|---|---|
| `server/prisma/schema.prisma` | **New models:** `CrawlRun` (`crawl_runs`) and `CrawledPage` (`crawled_pages`, with the `CrawledPageTree` self-relation `parentPage`/`childPages`, `@@unique([crawlRunId, url])`, and indexes on `websiteId` and `parentPageId`). **Back-relations:** `Website.crawlRuns` / `crawledPages`. Doc comments updated. `npx prisma db push` + `npx prisma generate` run; tables only added. |
| `server/services/dbService.ts` | **Added:** the `CrawlRun` / `CrawledPage` type re-exports, plus `CrawlRunStatus`, `FinishedCrawlRunStatus`, `CrawlRunInput`, `CrawlProgress`, `CrawlRunFinish`, `CrawledPageInput`, `CrawledPageSummary`. **New functions:** `listCrawlRunsForWebsite`, `findCrawlRunForWebsite`, `createCrawlRunForWebsite`, `recordCrawledPage` (one transaction: the counters, guarded by `status: running` / `deletedAt: null`, then the page), `finishCrawlRun`, `markRunningCrawlRunsInterrupted`, `listCrawledPageSummariesForRun` (Prisma `omit`), `findCrawledPageForRun`. **Changed:** `softDeleteWebsite` now also stamps crawl runs and crawled pages ("eight tables"). |
| `server/services/playwrightService.ts` | **Refactor, behaviour unchanged:** the new exported `waitForPageReadiness` (idle → paint → minimum wait, no try/catch) is split out of `captureWhenReady`. **Now exported:** `FIRST_FAILING_HTTP_STATUS`, `NavigationOutcome`, `measureElapsedMs`, `summarizeError`, `describeUnsuccessfulResponse`, `navigateToUrl`, `closeBrowserQuietly`. |
| `server/services/crawlerService.ts` (new) | **Exports:** `crawlWebsite`, `readRawPageLinks`, `CRAWL_PAGE_LIMIT`, `CRAWL_TIME_LIMIT_MS`, `ARIA_SNAPSHOT_TIMEOUT_MS`, `CrawlStopReason`, `CrawlOutcome`, `RecordVisitedPage`. **Module-private:** `buildStartEntry`, `rememberCrawlOriginOnce`, `markFinalUrlAsSeen`, `takeAriaSnapshot`, `readPageTitle`, `collectSameOriginLinks`, `readLinksWhenOnOrigin`, `buildUnreadablePageVisit`, `visitCrawlPage`, `claimUnseenLinks`, `decideWhetherToStop`, `crawlNextPage`, `crawlWithPage`. |
| `server/services/crawlRunService.ts` (new) | **Exports:** `startCrawlRun` (in-memory per-website guard, background crawl, `CrawlRunStart` result), `markUnfinishedCrawlRunsInterrupted`. **Module-private:** `runCrawlInBackground` (never rejects), `recordCrawlFailure`, `BROWSER_CLOSED_MESSAGE`. |
| `server/controllers/crawlRuns.ts` (new) | `registerCrawlRunRoutes(app)` with four routes: `GET`/`POST /api/websites/:websiteId/crawl-runs`, `GET .../:crawlRunId` (run + page summaries), `GET .../pages/:crawledPageId`. |
| `server/utils/normalizeCrawlUrl.ts` (new) | `normalizeCrawlUrl`, `isSameOriginUrl`, `MAX_CRAWL_URL_LENGTH`, `NormalizedCrawlUrl`. |
| `server/server.ts` | Registers `registerCrawlRunRoutes`. **Boot step:** `await markUnfinishedCrawlRunsInterrupted()` before `startListening` (skipped under test). |
| `server/controllers/websites.ts` | DELETE route JSDoc now lists every cascaded table (it was stale). |

### Files changed — client
| File | Change |
|---|---|
| `src/hooks/useCrawlRuns.ts` (new) | `CrawlRunStatus`, `CrawlRunRecord`, `useCrawlRuns`. |
| `src/hooks/usePolledJsonResource.ts` (new) | `PolledJsonResourceState`, `usePolledJsonResource`. **Module-private:** `buildFailedPoll`, `FinishedPoll`. |
| `src/hooks/useCrawlRunProgress.ts` (new) | `CRAWL_RUN_POLL_INTERVAL_MS`, `CrawledPageSummaryRecord`, `CrawlRunWithPagesRecord`, `useCrawlRunProgress`. **Module-private:** `crawlRunIsStillRunning`. |
| `src/hooks/useCrawledPage.ts` (new) | `CrawledPageRecord`, `useCrawledPage`. |
| `src/utils/describeCrawlRun.ts` (new) | `describeCrawlRunStatus`, `describeCrawlRunProgress`, `crawlRunSeverity`, `formatCrawledPagePath`, plus the types. **Module-private:** `describeCrawlRunState`. |
| `src/utils/buildCrawlSiteTree.ts` (new) | `buildCrawlSiteTree`, `flattenCrawlSiteTree`, plus the types. **Module-private:** `appendTreeRows`. |
| `src/components/CrawlRunsSection.tsx` (new) | The "Crawls" section, `CrawlRunsSectionProps`. |
| `src/components/CrawlSiteMap.tsx` (new) | The "Site map" tree, `CrawlSiteMapProps`. |
| `src/components/CrawledPageDetails.tsx` (new) | One page in full, `CrawledPageDetailsProps`. **Module-private:** `DetailRow`. |
| `src/pages/CrawlRunPage.tsx` (new) | The crawl page. **Module-private:** `findSelectedPage`, `PAGE_QUERY_PARAMETER`. |
| `src/pages/WebsiteDetailPage.tsx` | **Data:** owns `useCrawlRuns`. **New:** `startCrawl` / `handleCrawlClick` (POST, then navigate to the run) and `crawlRunCountText`. **UI:** renders `CrawlRunsSection`. The delete dialog now names crawl runs, and the JSDoc is updated. |
| `src/App.tsx` | Route `/websites/:websiteId/crawl-runs/:crawlRunId`. |
| `src/utils/routePaths.ts` | `crawlRunDetailPath`, `crawlRunsApiUrl`, `crawlRunApiUrl`, `crawledPageApiUrl`. |

### Docs
`README.md`, `server/controllers/README.md`, `server/services/README.md`, `server/prisma/README.md`, `server/utils/README.md`, `src/components/README.md`, `src/hooks/README.md`, `src/pages/README.md`, `tests/README.md`.

### Tests
- **Backend, new:** `services/crawlerService.test.ts` (a fake site behind a mocked `playwright`, plus the in-page link scan), `services/crawlRunService.test.ts`, `api/crawlRuns.test.ts`, `utils/normalizeCrawlUrl.test.ts`.
- **Backend, updated:**
  - `services/dbService.test.ts`: two new delegates, the crawl functions, and the cascade ("eight tables"); `mockTransaction` widened to `Promise<unknown>`.
  - `server.test.ts`: `crawlRunService` mocked, the route wiring, and "boot step not run on import".
  - `playwrightService.test.ts` needed no change.
- **Frontend, new:** `usePolledJsonResource` (fake timers), `useCrawlRuns`, `useCrawlRunProgress`, `useCrawledPage`, `describeCrawlRun`, `buildCrawlSiteTree`, `CrawlRunsSection`, `CrawlSiteMap`, `CrawledPageDetails`, `CrawlRunPage`.
- **Frontend, updated:**
  - `WebsiteDetailPage.test.tsx`: crawl-runs stub, new dialog strings, and a "crawls" group.
  - `App.test.tsx`: crawl route row.
  - `routePaths.test.tsx`.
  - Builders in `support/frontendTestHelpers.tsx`.
- No test was removed or skipped.

### Verification performed
- **Checks:**
  - `npm run test:coverage`: **1031 tests in 86 files, all passing**. Statements 99.44%, branches 98.65%, functions 100%, lines 99.84%. Every crawl file is fully covered except one type-narrowing guard.
  - `npm run lint`, `npm run tsc` and `npm run tsc:client`: clean.
- **Live run (Playwright MCP driving the user's Chrome, after a health check and homepage check on a dev server I started):**
  - **Setup:** created "easy-test dev" (`http://localhost:5180/`) and clicked **Crawl website**.
  - **409:** a second POST mid-crawl answered `409`.
  - **Live progress:** "Running · 5 pages so far · 10 links waiting".
  - **Result:** finished with **21 pages in 14.4 s**.
  - **Tree in psql:** only `/` has a null parent, and depths are 0–4.
  - **Snapshot check:** the stored snapshot of `/` matches the earlier `claude_tmp/aria-snapshots/easy-test-dev.yml` line for line, except the uptime text.
  - **`?page=`:** picking a page updates it (replace), and a reload keeps the selection.
- **Bug found and fixed during verification:**
  - **Symptom:** a `tsx watch` restart (SIGTERM → Playwright closes the browser) made the crawler record every queued URL as a fake "browser has been closed" failure and mark the run `finished`.
  - **First fix:** stop when `browser.isConnected()` is false.
  - **Second fix:** also stop when `page.isClosed()`, because the page closes a moment before the browser reports itself disconnected; a re-test showed one fake page slipping through.
  - **Final re-test:** the run was `interrupted` with only its 3 real pages, 3 links waiting, the reason shown, and the UI polling through the restart.
- **Boot backstop:** I killed the server process (`kill -9`) mid-crawl, which left the run `running`, and started `npm run dev` again. The log showed "[crawl] marked 1 unfinished crawl run(s) interrupted" before "listening", and the run was `interrupted`.
- **Cleanup:**
  - My dev servers were stopped, including a `tsx watch` left stuck by the `kill -9` test.
  - Ports 3010 and 5180 are free.
  - No orphaned Chromium processes.
- No git history was written.

### Notable during implementation
- **Test data left in the dev DB** (by the user's choice): the "easy-test dev" website and its 5 crawl runs. They are the 21-page crawl, the misleading pre-fix "Finished · 11 pages" run (7 fake failures), and 3 `interrupted` runs from the restart tests.
- **Aria snapshots store page text verbatim.** Crawling the dev app stored, for example, an action description containing login credentials inside the compare page's snapshot.
- **Crawling the dev app visits action pages,** each of which calls `GET /api/script-models`: one live Models API list call per action page, with no tokens spent.
- **The Playwright MCP runs in `--extension` mode.** The first navigation waited for the user to approve the connection in Chrome. Later, clicks timed out ("visible, enabled and stable") while the tab was in the background, so the restart re-tests started crawls with a POST via curl; the UI click path had already been verified.

---

## 2026-10-03 03:15 EDT — Model/effort picker, effort column, out-of-date versions, version diff page

**Intent:**
- **Model and effort dropdowns** on the action page. They list every Claude model the live Models API offers, and exactly the effort levels the chosen one supports.
- **Each saved script records the effort level sent.** The existing `modelId` already records the model that answered.
- **Out-of-date marks:** a version generated from a title or description the action no longer has is flagged, so the user knows to convert again.
- **Comparison page:** any two versions of an action side by side, covering their title, description, and code.

### Decisions (all made by the user)
- **Levels** are effort levels only. Models without an effort setting (Haiku 4.5, Sonnet 4.5) get a single "Standard".
- **Fallback is automatic** and read live:
  - Opus 4.8 when the chosen model allows it;
  - otherwise the model's first allowed fallback (Sonnet 5.5 → Sonnet 5);
  - otherwise none.
- **Model details:** a plain `effort` column. `modelId` keeps storing the model id string that answered. The user turned down a JSON column.
- **Diff layout:** side by side. **Scope:** versions of one action.
- **Out of date:** title or description changes only. A changed website URL is not flagged.
- **End-to-end checks** used a test website pointing at this app (`http://localhost:5180/`), as before.

### Files changed — server
| File | Change |
|---|---|
| `server/prisma/schema.prisma` | **New column:** `ActionScript.effort String?`. Doc comment updated. `npx prisma db push` + `npx prisma generate` run; the column is nullable, so no data loss. |
| `server/services/dbService.ts` | `ActionScriptInput.effort: string \| null`. |
| `server/services/anthropicClient.ts` (new) | **Moved here** from `scriptGenerationService.ts`: `ScriptGenerationError`, `ScriptGenerationFailureReason` (adds `unsupportedModel`), `readAnthropicApiKey`. **New:** `createAnthropicClient()`. |
| `server/services/scriptModelService.ts` (new) | **Exports:** `EFFORT_LADDER`, `EffortLevel`, `DEFAULT_SCRIPT_MODEL_ID`, `DEFAULT_SCRIPT_EFFORT`, `PREFERRED_FALLBACK_MODEL_ID`, `SERVER_SIDE_FALLBACK_BETA`, `ScriptModelReference`, `ScriptModelOption`, `ScriptModelChoiceDefaults`, `listScriptModels`, `findScriptModel`, `chooseEffortForModel`, `chooseDefaultScriptModel`. **Module-private:** `readEffortLevels`, `pickFallbackModel`. |
| `server/services/scriptGenerationService.ts` | **Signature:** `convertActionToScript(request, choice)`. **Request built from the choice:** `fallbacks` / `betas` only when the model has a fallback; `thinking: adaptive` only when supported; `effort` unless "Standard". **Returns** `effort`, and the log line names the model asked and the effort. **Removed:** `ACTION_SCRIPT_MODEL_ID`, `ACTION_SCRIPT_FALLBACK_MODEL_ID`, and the local copies of `ScriptGenerationError` / `readAnthropicApiKey` (moved). **Added:** the `ScriptModelChoice` interface. |
| `server/controllers/actionScripts.ts` | `POST .../scripts` validates `{ modelId, effort }` (400), looks the model up in the live catalog (400 "Unknown model"), and checks the level (400 naming what the model offers). It then saves `effort`. **New module-private:** `resolveEffortForModel`, `EffortResolution`. **Removed:** `statusForConversionFailure` and its status map, moved to utils as `statusForScriptGenerationFailure`. |
| `server/controllers/scriptModels.ts` (new) | `registerScriptModelRoutes(app)`: `GET /api/script-models` → `{ models, defaultModelId, defaultEffort }`; 503 without a key. |
| `server/server.ts` | Registers `registerScriptModelRoutes`. |
| `server/utils/statusForScriptGenerationFailure.ts` (new) | Shared status mapping for both Claude routes, now including `unsupportedModel` → 400. |
| `server/utils/validateRequestBodies.ts` | **Added:** `ScriptModelChoiceInput` and `validateScriptModelChoiceInput`. |

### Files changed — client
| File | Change |
|---|---|
| `src/hooks/useScriptModels.ts` (new) | `ScriptModelReference`, `ScriptModelOption`, `ScriptModelCatalog`, `useScriptModels`. |
| `src/hooks/useActionScripts.ts` | `ActionScriptRecord.effort`. |
| `src/components/ScriptModelPicker.tsx` (new) | The Model / Effort dropdowns, `ScriptModelPickerProps`. |
| `src/components/SideBySideDiff.tsx` (new) | The side-by-side diff section, `SideBySideDiffProps`. **Module-private:** `cellBackground`, `changedWordBackground`, `DiffCellView`. |
| `src/components/ActionScriptsSection.tsx` | **New props:** `canConvert`, `modelPicker`, `currentAction`, `comparePath`, `compareLinkState`. **UI:** the picker, the Compare versions link, model and effort on version rows, and the "Out of date" chip. |
| `src/components/ActionScriptDetails.tsx` | **New props:** `currentAction`, `catalogModels`. **UI:** a model + effort caption, the "Out of date" warning, and the "Generated from" title/description block. |
| `src/pages/ActionDetailPage.tsx` | **Picker state:** `pickedModelChoice`, falling back to the catalog's defaults. **Handlers:** `handleModelChange` / `handleEffortChange`. **Convert POST** sends `{ modelId, effort }`. **Module-private:** `ScriptModelChoice`, `chooseEffortForModel` (mirrors the server's), `PREFERRED_EFFORT`. |
| `src/pages/ActionScriptComparePage.tsx` (new) | The comparison page. **Module-private:** `findScriptIndex`, `describeVersion`, the query parameter constants. |
| `src/App.tsx` | Route `/websites/:websiteId/actions/:itemId/scripts/compare`. |
| `src/utils/routePaths.ts` | **Added:** `actionScriptComparePath`, `SCRIPT_MODELS_API_URL`. |
| `src/utils/describeScriptModel.ts` (new) | `describeScriptModel`, `DescribableScriptModel`. **Module-private:** `describeEffort`, which yields "high effort", "Standard effort", "effort not recorded", or "no effort level" while the model list is unknown. |
| `src/utils/describeScriptStaleness.ts` (new) | `findChangedActionFields`, `describeChangedActionFields`, and the types. |
| `src/utils/buildSideBySideDiff.ts` (new) | `buildSideBySideDiffRows`, using jsdiff's `diffLines` (newline at end of file ignored) and `diffWordsWithSpace` for paired lines. |

### Files changed — config, tooling, docs
| File | Change |
|---|---|
| `package.json` / `package-lock.json` | `npm install diff` (9.0.0; ships its own types; `@types/diff` is a deprecated stub). |
| `README.md`, `server/controllers/README.md`, `server/services/README.md`, `server/utils/README.md`, `server/prisma/README.md`, `server/prompts/README.md`, `src/hooks/README.md`, `src/components/README.md`, `src/pages/README.md`, `tests/README.md` | Updated for the above. |

### Tests
- **Backend, new:** `services/anthropicClient.test.ts`, `services/scriptModelService.test.ts`, `api/scriptModels.test.ts`, `utils/statusForScriptGenerationFailure.test.ts`.
- **Backend, updated:**
  - `services/scriptGenerationService.test.ts`: rewritten for the choice argument.
    - The unset/empty/whitespace key cases moved to `anthropicClient.test.ts`, where that logic now lives; one missing-key case stays.
    - The old "asks Claude Opus 5.5 with the named fallback, high effort" case became per-model request-shape cases (current model, older model without adaptive thinking, Standard model).
  - `api/actionScripts.test.ts`: every convert POST now sends a body. The model lookup is mocked. New 400 cases (no model, unknown model, unoffered level, missing level, level on a Standard model), a Standard conversion, and 503 from the catalog.
  - `utils/validateRequestBodies.test.ts`: the choice validator.
  - `services/dbService.test.ts`: `effort` in the fixtures.
  - `server.test.ts`: the catalog mock and the route wiring.
- **Frontend, new:** `useScriptModels`, `describeScriptModel`, `describeScriptStaleness`, `buildSideBySideDiff`, `SideBySideDiff`, `ScriptModelPicker`, `ActionScriptComparePage`.
- **Frontend, updated:**
  - `ActionDetailPage.test.tsx`: the model catalog is stubbed for every load, Convert waits for it, and the POST body is asserted. New "model choice" and "out-of-date versions and comparing" groups.
  - `ActionScriptsSection.test.tsx` / `ActionScriptDetails.test.tsx`: the new props. Two rerender-based cases now unmount and render through the shared helper.
  - `routePaths.test.tsx`; helpers `buildScriptModelOption` / `buildScriptModelCatalog` and `effort` on `buildActionScriptRecord`.
- No test was removed.

### Verification performed
- **Live Models API (read-only, before planning):** 13 models with structured outputs, with their effort levels, adaptive support, and allowed fallbacks.
- **`GET /api/script-models`** on a dev server I started: the same 13 models. Defaults are Opus 5.5 / high. Fallbacks: Opus 4.8 for Opus 5.5, Fable 5.1, Opus 5, and Fable 5; Sonnet 5 for Sonnet 5.5; none otherwise.
- **Bad convert bodies via curl:** all 400 with clear messages (no body, no model, unknown model, `xhigh` on Opus 4.6, a level on Haiku, a missing level, a blank level).
- **Playwright UI run** on a test website pointing at this app:
  - **Picker:** defaults to Opus 5.5 / high; 13 models; Opus 4.6 offers low/medium/high/max with no fallback; Haiku shows a disabled "Standard"; the picker is disabled while converting.
  - **Conversions:** Haiku / Standard took 3 s, Sonnet 5.5 / low about 4 s. Captions and rows show the model name, id, and effort.
  - **Out of date:** after editing the title in the UI, both older versions show "Out of date" and the alert names "title". A new conversion is not flagged.
  - **Run:** running the new version passed.
  - **Compare:** defaults to v2 vs v3. The title highlights " page", and the description says "No differences". Picking v1 updates `?from=`, which survives a reload. Code shows removed and added lines, and the breadcrumb returns to the action.
- **Direct API conversions:** Opus 5.5 / low (adaptive thinking + fallback chain) and Opus 4.5 / low (effort, no adaptive) both returned 201. psql shows `modelId` / `effort` stored for every version (`null` for Haiku).
- **Prompt cache, from the server log:**
  - Sonnet 5.5 wrote 2,549 tokens once, then read 2,549 on every later call.
  - Opus 5.5 wrote its own entry (caches are per model).
  - Haiku 4.5 and Opus 4.5 never cache: the ~2.2k-token prompt is below their 4,096-token minimum. This is documented, not a bug.
- **Checks:**
  - `npm run test:coverage`: **853 tests in 72 files, all passing**. Statements 99.41%, branches 98.4%, functions 100%, lines 99.93%.
  - `npm run lint`, `npm run tsc` and `npm run tsc:client`: clean.
- **Cleanup:**
  - The test website was soft deleted, so its scripts and runs are stamped.
  - My test run folder under `action-scripts/` and `claude_tmp/` were removed. The user's own run folder there is untouched.
  - The dev servers I started were stopped, including an orphaned `tsx watch` that `./stop-dev.sh` (listeners only) left behind.
- No git history was written.

### Notable during implementation
- **The model choice resets when the page remounts,** e.g. after a round trip to the Edit page. It goes back to the server's default; nothing remembers the last choice. Not requested, so not built.
- **The model list is a live API call** on each action-page load (~0.5–1 s). Until it arrives, Convert is disabled, the picker reads "Loading models…", and version labels show raw ids with "no effort level".
- **React Router 7 applies URL changes in a transition,** so on the comparison page the dropdown updates one render after `setSearchParams`. The browser test waits for it.
- **The user had edited `server/prompts/actionScriptGuidelines.md`** (allowing `console.log` for progress). It was left verbatim.

---

## 2026-10-02 21:33 EDT — Actions convert to immutable Playwright scripts (Convert to script / Run script)

**Intent:**
- An action's page gets a **Convert to script** button. The server sends the action, plus the website's name and URL, to **Claude Opus 5.5**. The user's script-writing guidelines are used **verbatim** as the system prompt.
- Claude answers with a summary, its assumptions, and a Playwright `.mjs` script that only does what a user could do with a mouse and keyboard.
- Each conversion is saved as a new, **immutable** version. The user can view every version (summary, assumptions, code) and **Run** it.
- A run executes the script with plain `node`, opening a visible browser on this machine. It records pass/fail, the step log, and a failure screenshot.
- This lays the groundwork for use cases, which will later call action scripts with parameters. That is out of scope here, but scripts and runs are create-only, and the runner and scanner are script-agnostic.

### Decisions (all made by the user)
- **LLM:** Claude Opus 5.5 (`claude-opus-5-5`) via `@anthropic-ai/sdk`. The key is `ANTHROPIC_API_KEY` in `.env.local`.
- **Refusal fallback:** a **named model**, `claude-opus-4-8`. If a safety classifier declines on Opus 5.5, the API retries on it inside the same call. The script records the model that answered.
- **Prompt caching** (asked mid-implementation) on the prompt sent to the LLM.
- **File type:** generated scripts stay **`.mjs`**, an explicit exception to CLAUDE.md's ".mts" rule (recorded in `server/prompts/README.md`). All project code stays TypeScript.
- **Rule check:** **save and only warn**. Violations are stored and shown; the script is still runnable.
- **Run mode:** **synchronous**, like Take screenshot, killed after **5 minutes**.
- **Script environment:** **no environment variables at all** (`env: {}`).
- **UI:** the shared detail page is split into **`ActionDetailPage`** and **`UseCaseDetailPage`**. Pages fetch, and components only take props.
- **End-to-end test site:** this app itself (`http://localhost:5180/`). example.com no longer has its link, and now asks not to be used for testing.
- **Defaults approved with the plan:**
  - pass = exit 0 + no timeout + no `failure.png`;
  - `ACTION_SCRIPT_DIR` must be inside the project;
  - 503 for a missing key, 502 for an unusable reply;
  - "Version N" is derived on the client;
  - output is capped at 200k characters, keeping the tail;
  - `effort: "high"`, `max_tokens` 16000;
  - CLAUDE.md is not edited.

### Files changed — server
| File | Change |
|---|---|
| `server/prisma/schema.prisma` | **New models.** `ActionScript` (`action_scripts`) and `ActionScriptRun` (`action_script_runs`), both create-only and soft deleted. **Back-relations:** `Website.actionScripts`, `Website.actionScriptRuns`, `Action.scripts`, `Action.scriptRuns`. **Doc comments** updated for the cascades. `npx prisma db push` and `npx prisma generate` were run; tables were only added. |
| `server/services/dbService.ts` | **Re-exported types:** `ActionScript`, `ActionScriptRun`. **Added interfaces:** `ActionScriptInput`, `ActionScriptRunInput`. **Added functions:** `listActionScriptsForAction`, `findActionScriptForAction`, `createActionScriptForAction`, `listActionScriptRunsForScript`, `findActionScriptRunForScript`, `createActionScriptRunForScript`. There are deliberately no update functions. **Changed:** `softDeleteWebsite` also stamps scripts and runs (six tables, one timestamp). `softDeleteActionForWebsite` is now a `$transaction` that stamps the action's scripts and runs with the action's timestamp (signature unchanged). |
| `server/services/scriptGenerationService.ts` (new) | **Exports:** `ACTION_SCRIPT_MODEL_ID`, `ACTION_SCRIPT_FALLBACK_MODEL_ID`, `ActionScriptConversionSchema` (zod), `ActionScriptConversionRequest`, `ActionScriptConversion`, `ScriptGenerationFailureReason`, `ScriptGenerationError`, `convertActionToScript`. **Module-private:** `buildConversionRequestMessage`, `readAnthropicApiKey`. **Request:** `client.beta.messages.parse` + `betaZodOutputFormat`, with fallbacks `[claude-opus-4-8]` (beta `server-side-fallback-2026-06-01`). **System prompt:** sent as a text block with `cache_control: ephemeral`. **Logging:** `[scripts]` usage lines (cache read/write). |
| `server/services/scriptRunnerService.ts` (new) | **Exports:** `SCRIPT_RUN_TIMEOUT_MS`, `SCRIPT_KILL_GRACE_MS`, `SCRIPT_OUTPUT_CHARACTER_LIMIT`, `SCRIPT_FILE_NAME`, `FAILURE_SCREENSHOT_FILE_NAME`, `ScriptRunResult`, `runPlaywrightScript`. **Module-private:** `RunOutputCollector` (tail cap, NUL stripping), `signalProcessGroup`, `fileExists`. **Run:** `spawn(process.execPath, ["script.mjs"], { cwd, env: {}, detached: true })`. **Time limit:** SIGTERM to the process group at 5 min, SIGKILL 5 s later. |
| `server/controllers/actionScripts.ts` (new) | **Exported:** `registerActionScriptRoutes(app, actionScriptDirectory)`. **Routes:** `GET`/`POST .../actions/:actionId/scripts`, `GET`/`POST .../scripts/:actionScriptId/runs`, `GET .../runs/:actionScriptRunId/failure-screenshot`. **Module-private:** `findWebsiteAndAction`, `findWebsiteActionAndScript`, `statusForConversionFailure`, `buildRunFolderName`, `STATUS_BY_SCRIPT_GENERATION_FAILURE`, and the message constants. |
| `server/controllers/playwright.ts` | `readSendErrorStatus` moved out to `server/utils/readSendErrorStatus.ts`; it is now imported. No behavior change. |
| `server/server.ts` | `ACTION_SCRIPT_DIRECTORY = resolveActionScriptDirectory()` is resolved at boot. `registerActionScriptRoutes(app, ACTION_SCRIPT_DIRECTORY)` is registered. |
| `server/utils/resolveConfiguredDirectory.ts` (new) | `resolveConfiguredDirectory(environmentVariableName)`: the body of the old `resolveScreenshotDirectory`, generalized. |
| `server/utils/resolveScreenshotDirectory.ts` | Now a one-line call to `resolveConfiguredDirectory("SCREENSHOT_DIR")`. The error text is identical, so its existing test is untouched. |
| `server/utils/resolveActionScriptDirectory.ts` (new) | `resolveActionScriptDirectory()`: requires `ACTION_SCRIPT_DIR` to sit strictly inside the project root. |
| `server/utils/findScriptRuleViolations.ts` (new) | `findScriptRuleViolations(code)`: the warn-only scan. **Module-private:** `SCRIPT_RULES`, `IMPORT_SPECIFIER_PATTERNS`, `ALLOWED_IMPORT_SPECIFIER`, `readImportSpecifier`. |
| `server/utils/readSendErrorStatus.ts` (new) | `readSendErrorStatus(sendError)`, extracted from the Playwright controller. |
| `server/prompts/actionScriptGuidelines.md` (new) | The user's guidelines, byte-for-byte from "# Role" through the template. |
| `server/prompts/README.md` (new) | Prompts are used verbatim. Records the `.mjs` exception. |

### Files changed — client
| File | Change |
|---|---|
| `src/pages/WebsiteItemDetailPage.tsx` | **Deleted.** Split into the two pages below. |
| `src/pages/UseCaseDetailPage.tsx` (new) | The use case's page (summary + delete). |
| `src/pages/ActionDetailPage.tsx` (new) | The action's page: summary + delete, `ActionScriptsSection`, and `ActionScriptRunsSection` for the selected version. **Inner handlers:** `convertToScript`, `handleConvertClick`, `runSelectedScript`, `handleRunClick`. |
| `src/App.tsx` | The detail routes render `UseCaseDetailPage` / `ActionDetailPage`. The route-key comment was updated. |
| `src/hooks/useJsonResource.ts` | `useJsonResource(resourceUrl: string \| null)`: a null url stays idle. `JsonResourceState` doc updated. |
| `src/hooks/useRecordListWithAdditions.ts` (new) | `useRecordListWithAdditions`, `RecordListWithAdditions`. |
| `src/hooks/useActionScripts.ts` (new) | `ActionScriptRecord`, `ActionScriptsState`, `useActionScripts`. |
| `src/hooks/useActionScriptRuns.ts` (new) | `ActionScriptRunRecord`, `ActionScriptRunsState`, `useActionScriptRuns`. |
| `src/hooks/useWebsiteItemDeletion.ts` (new) | `WebsiteItemDeletion`, `useWebsiteItemDeletion`, lifted from the old page. |
| `src/components/WebsiteItemSummary.tsx` (new) | `WebsiteItemSummary`, `WebsiteItemSummaryProps`. |
| `src/components/ActionScriptsSection.tsx`, `ActionScriptDetails.tsx`, `ActionScriptRunsSection.tsx`, `ActionScriptRunDetails.tsx`, `CodeBlock.tsx` (new) | The scripts UI, each with an exported `<Name>Props`. |
| `src/utils/routePaths.ts` | **Added:** `actionScriptsApiUrl`, `actionScriptRunsApiUrl`, `actionScriptRunFailureScreenshotApiUrl`. Now imports `ACTION_KIND`. |
| `src/utils/describeActionScriptRun.ts` (new) | `describeActionScriptRunOutcome`, `ActionScriptRunOutcomeFields`. |

### Files changed — config, tooling, docs
| File | Change |
|---|---|
| `package.json` / `package-lock.json` | `npm install @anthropic-ai/sdk zod` (runtime dependencies; both ship their own types). `npm audit` reports 4 high findings. They are pre-existing, in Prisma's `deepmerge-ts`/`mysql2` chain, not from these packages. |
| `.env` | `ACTION_SCRIPT_DIR=action-scripts`. It has to be committed: `server.ts` resolves it at import, and the server test imports `server.ts`. |
| `.env.example` | Documents `ACTION_SCRIPT_DIR` and `ANTHROPIC_API_KEY=` (real key only in `.env.local`). |
| `.gitignore` | `/action-scripts/`. |
| `README.md` | Feature paragraph, env table rows, and the runtime-deps note. |
| `server/README.md`, `server/controllers/README.md`, `server/services/README.md`, `server/utils/README.md`, `server/prisma/README.md`, `src/hooks/README.md`, `src/components/README.md`, `src/pages/README.md`, `tests/README.md` | Updated for the above. |

### Tests
- **Backend, added:** `api/actionScripts.test.ts` (32 tests), `services/scriptGenerationService.test.ts` (16), `services/scriptRunnerService.test.ts` (13), `utils/findScriptRuleViolations.test.ts` (43), `utils/resolveConfiguredDirectory.test.ts`, `utils/resolveActionScriptDirectory.test.ts`, `utils/readSendErrorStatus.test.ts`.
- **Backend fixture:** `fixtures/action-script-files/website-id-from-db/existing-run/failure.png`.
- **Backend, updated:** `services/dbService.test.ts` adds the two delegates and the six new functions. The website cascade test now covers six tables. The action delete tests were rewritten because the function now cascades in a transaction; the old test asserted it did *not* use a transaction. `server.test.ts` adds the new mocks plus wiring and boot-directory tests.
- **Frontend split:** `WebsiteItemDetailPage.test.tsx` became `UseCaseDetailPage.test.tsx` and `ActionDetailPage.test.tsx`. **Every one of its 11 cases was moved, not removed:** they live in `support/websiteItemDetailPageCases.tsx` and both pages run them. The action page adds 10 script/run cases; the use case page adds a "never asks for scripts" case.
- **Frontend, added:** `useRecordListWithAdditions`, `useActionScripts`, `useActionScriptRuns`, `useWebsiteItemDeletion`, `describeActionScriptRun`, `CodeBlock`, `WebsiteItemSummary`, `ActionScriptDetails`, `ActionScriptRunDetails`, `ActionScriptsSection`, `ActionScriptRunsSection`. `routePaths` and `useJsonResource` (null url) were extended. Helpers gained `buildActionScriptRecord` and `buildActionScriptRunRecord`.

### Verification performed
- **Runner smoke** (headless scripts via tsx): with `env: {}` a script imports `playwright` from the project and launches Chromium. Pass gave exit 0. Fail gave exit 1 with `failure.png` in the run folder.
- **Prompt caching** (two real conversions, back to back): the first wrote 2,535 tokens to the cache; the second read 2,535 from it.
  - Structured output and the named fallback were accepted together.
  - The script followed the template exactly.
- **End-to-end Playwright UI run** against the user's running dev servers, with a test website pointing at this app:
  - **Passing action** ("Click Websites in the header…"): converted in about 7 s; START_URL and `headless: false` were in the code. Run: visible Chromium, **Passed** with the step log.
  - **Failing action** ("Click 'Launch rocket'…"): **Failed · exit code 1**, and the failure screenshot loaded in the page.
  - **UI states:** empty state, disabled buttons with progress bars, version switching, run history, and a hand-saved script showing **6 rule warnings** while still runnable.
  - **Pages:** the use case page has no Scripts section and makes no `/scripts` requests. Take screenshot still works.
- **Missing key:** a separate server on port 3099 with `ANTHROPIC_API_KEY=` booted, and convert answered **503** with the explanation. That server was then stopped.
- **5 minute limit:** a hand-saved script that never finishes answered **201** after 305 s.
  - Recorded as `timedOut: true`, `exitSignal: SIGKILL`.
  - Playwright closed Chromium on SIGTERM; the stubborn script was SIGKILLed 5 s later.
  - No Chromium or `script.mjs` processes were left.
- **Restart orphan:** an earlier attempt was cut short at 120 s when an edit under `server/` made `tsx watch` restart the dev server. The response was lost and the script kept running, which is the documented limitation. Those orphaned processes were stopped by hand.
- **Delete cascades (psql):**
  - Deleting an action stamped it and its scripts with one `deletedAt`, and left other actions' scripts active.
  - Deleting the website stamped every remaining row (website, use case, actions, screenshot run, scripts, runs) with one timestamp, leaving 0 active rows.
  - The user's two websites were untouched.
- **Checks:**
  - `npm run test:coverage`: **741 tests in 61 files, all passing**. Statements 99.68%, branches 99.08%, functions 100%, lines 99.91%.
  - `npm run lint`, `npm run tsc` and `npm run tsc:client`: clean, with no rule disables and no config changes.
- **Cleanup:**
  - Test data was soft deleted.
  - `claude_tmp/` and the test run folders (`action-scripts/`) were removed.
  - The user's dev servers were left running as found.
  - No git history was written; everything is left uncommitted in the working tree.

### Notable during implementation
- **Two bugs caught by the new tests:**
  - `resolveActionScriptDirectory` treated a folder named `..runs` as outside the project. It now checks for a real `..` path segment.
  - Lint flagged a `let timedOut` that TypeScript narrows to `false` because it is set inside a timer callback. It now lives on a small state object.
- **Playwright's SIGTERM handler closes the browser but does not exit the process,** so a script that keeps itself alive needs the SIGKILL backstop. Template scripts end once the browser closes.
- **Known limitations** (documented in `server/controllers/README.md`):
  - A dev-server restart or `./stop-dev.sh` during a run loses the response, and the script keeps running. A script waiting in `page.pause()` stays open until closed by hand.
  - Run folders accumulate on disk.

---

## 2026-10-02 18:28 EDT — Minimum wait default lowered from 300 ms to 1 ms

**Intent:**
- At the user's request, a website's screenshot **minimum wait** now defaults to **1 ms** instead of 300 ms.
- In practice there is no floor, because network idle + paint always takes longer than 1 ms.
- The network idle cap default (5000 ms) is unchanged.

### Decisions (all made by the user)

- New default: `screenshotMinimumWaitMs` = 1.

### Files changed

| File | Change |
|---|---|
| `server/prisma/schema.prisma` | `Website.screenshotMinimumWaitMs` `@default(300)` → `@default(1)`. `db push` + `generate` were run; the Postgres column default is now `1`. |
| `server/utils/validateRequestBodies.ts` | `DEFAULT_SCREENSHOT_MINIMUM_WAIT_MS` 300 → 1. Its JSDoc and the `validateWebsiteInput` JSDoc are updated. |
| `server/controllers/websites.ts` | JSDoc only: "(defaults 5000 and 1)". |
| `src/pages/WebsiteCreatePage.tsx` | `NEW_WEBSITE_VALUES.screenshotMinimumWaitMs` 300 → 1. |
| `server/utils/README.md`, `server/prisma/README.md`, `README.md` | The documented default is now 1 ms. |
| **Tests** | Expectations that assert the *default* changed from 300 → 1. Explicit inputs that merely use 300 (for example "cap 200 below minimum 300") were left as is. Files: `tests/backend/utils/validateRequestBodies.test.ts` (`DEFAULT_TIMING_SETTINGS`, the "0 with the default minimum (1)" label), `tests/backend/api/websites.test.ts`, `tests/backend/server.test.ts`, `tests/frontend/support/frontendTestHelpers.tsx` (`buildWebsiteRecord`), `tests/frontend/WebsiteForm.test.tsx` (`BLANK_VALUES`, the submitted payload), `tests/frontend/WebsiteCreatePage.test.tsx`, `tests/frontend/WebsiteEditPage.test.tsx`. |

### Verification performed

- **psql:** `information_schema` shows the `screenshotMinimumWaitMs` column default is `1`.
- **Existing rows are not changed by a new default.**
  - "Forge Gym management" already had 1, because the user had set it.
  - **"Example Again" still has 300** from the old default. It was left as is and the user was told.
- **End-to-end Playwright script** against the user's running dev servers (health check and homepage sniff both passed):
  - The create form shows cap 5000 and minimum 1.
  - A website saved from the form stores 1, and its detail caption reads "at least 1 ms after the page loads".
  - A website created through the API without the fields gets 5000 / 1.
  - Both temporary websites were soft-deleted.
- **Checks:**
  - `npm run test:coverage`: 554 tests in 42 files, all passing. Statements 99.77%, branches 99.44%, functions 100%, lines 99.88%.
  - `npm run lint`, `npm run tsc` and `npm run tsc:client`: clean.
- **Not touched:** the user's dev servers were left running, as they started them.
- No git history was written. Everything is left uncommitted in the working tree.

---

## 2026-10-02 17:38 EDT — Screenshots wait for network idle + paint, with per-website timing settings

**Intent:**
- Screenshots were still catching a loading spinner. On the Forge Gym site the real content appears about 810 ms after the page's `load` event, so the fixed 1/200/300 ms delays of the previous entry could not fix it.
- At the user's request, the screenshot now waits for the page to be **ready** instead:
  1. network requests finished (capped);
  2. the page painted;
  3. a **minimum wait** since `load` has passed.
- The cap and the minimum are **settings on each website**, edited on the website form. This entry supersedes the fixed `SCREENSHOT_DELAY_MS` experiment below.

### Decisions (all made by the user)

- **Order:** load → network idle (capped) → painted → minimum wait satisfied → screenshot.
- **The minimum wait is a floor, not an extra delay.** If idle + paint already took at least the minimum, the screenshot is taken at once. Otherwise only the remainder is waited.
- **When the cap runs out** while the network is still busy, the paint wait is skipped and the screenshot is taken at once. Success is still judged by HTTP status.
- **The cap may not be lower than the minimum wait** (validated). So by the time the cap runs out, the minimum has always passed.
- **The paint wait's safety limit is 2 s.** It is fixed, not a setting.
- **The settings live on `Website`** and are edited on the create/edit form. Defaults are cap **5000 ms** and minimum **300 ms**; values are whole **milliseconds 0–30000**.
- **Runs are unchanged.** Nothing new is recorded on `ScreenshotRun`.
- **Approved in the plan:**
  - the minimum is measured from `load`;
  - a cap of `0` means "don't wait for idle", because Playwright reads `timeout: 0` as "forever";
  - the server fills in the defaults when the fields are omitted;
  - the detail page shows the settings as a caption.

### Files changed — server

| File | Change |
|---|---|
| `server/prisma/schema.prisma` | `Website` gained `networkIdleTimeoutMs Int @default(5000)` and `screenshotMinimumWaitMs Int @default(300)`, and its doc comment describes them. `db push` + `generate` were run. The 2 existing websites got the defaults; no data was lost. |
| `server/utils/validateRequestBodies.ts` | **Added:** exported constants `DEFAULT_NETWORK_IDLE_TIMEOUT_MS` (5000), `DEFAULT_SCREENSHOT_MINIMUM_WAIT_MS` (300), `MAX_TIMING_SETTING_MS` (30000); private helper `readOptionalMilliseconds`. **Changed** `validateWebsiteInput`: it reads both settings (JSON numbers only; missing or null become the defaults), rejects out-of-range or non-integer values, rejects a cap below the minimum, and returns both fields. Its JSDoc rules are updated. |
| `server/services/dbService.ts` | `WebsiteInput` gained the optional `networkIdleTimeoutMs?` and `screenshotMinimumWaitMs?`. JSDoc of `createWebsite` / `updateWebsite` updated. No logic change. |
| `server/services/playwrightService.ts` | See the breakdown below this table. |
| `server/controllers/playwright.ts` | The POST passes the found website's `networkIdleTimeoutMs` / `screenshotMinimumWaitMs` to `captureWebsiteScreenshot`. Its JSDoc describes the wait sequence. |
| `server/controllers/websites.ts` | JSDoc only: the POST/PUT `@param body` lines list the two settings and their rules. |

**`server/services/playwrightService.ts` in detail:**
- **Removed:** `SCREENSHOT_DELAY_MS`, and `saveViewportScreenshot`, which is replaced by `captureWhenReady`.
- **Added:**
  - `PAINT_WAIT_LIMIT_MS` (2000) and the exported `ScreenshotTimingSettings`;
  - the import of `errors` from `playwright`;
  - private helpers `waitForNetworkIdle` (a cap of 0 skips it; `errors.TimeoutError` → `false`; other errors rethrown), `waitForPaint` (an in-page `page.evaluate`: fonts ready + two `requestAnimationFrame`s, each raced against the 2 s limit) and `captureWhenReady` (idle → paint → remaining minimum → screenshot; cap ran out → screenshot at once).
- **Changed:** `captureWebsiteScreenshot` and `visitPageAndCapture` take `timingSettings`, and their JSDoc is updated.

### Files changed — client

| File | Change |
|---|---|
| `src/hooks/useWebsites.ts` | `WebsiteRecord` and `WebsiteRequestBody` gained `networkIdleTimeoutMs` and `screenshotMinimumWaitMs`. |
| `src/components/WebsiteForm.tsx` | **Added:** the "Screenshot settings" subheading; number fields "Network idle cap (ms)" and "Minimum wait (ms)" with helper text; state `networkIdleTimeoutMs` / `screenshotMinimumWaitMs` (held as text); handlers `handleNetworkIdleTimeoutChange` / `handleScreenshotMinimumWaitChange`; conditionals `networkIdleTimeoutIsFilled` / `screenshotMinimumWaitIsFilled`. **Changed:** submit is blocked while either is blank, and `onSubmit` sends them as numbers. JSDoc updated. |
| `src/pages/WebsiteCreatePage.tsx` | `EMPTY_WEBSITE_VALUES` renamed to `NEW_WEBSITE_VALUES`, with the 5000/300 defaults. JSDoc updated. |
| `src/pages/WebsiteEditPage.tsx` | `initialValues` includes both settings from the loaded website. JSDoc updated. |
| `src/components/ScreenshotRunsSection.tsx` | New props `networkIdleTimeoutMs` / `screenshotMinimumWaitMs`; new conditional `networkIdleWaitIsDisabled`; a `timingSettingsText` caption under the heading. JSDoc updated. |
| `src/pages/WebsiteDetailPage.tsx` | Passes the website's two settings to `ScreenshotRunsSection`. JSDoc updated. |

### Files changed — docs

- `server/services/README.md`:
  - the order of work is rewritten (it also fixes the stale "currently 200 ms");
  - a note warns that the in-page `__name` function must stay anonymous;
  - the result table gains the cap-expired row.
- `server/prisma/README.md` and `server/utils/README.md`: the Website rows.
- `server/controllers/README.md`: how the row's settings drive the wait.
- `src/components/README.md`: the form and section rows.
- Root `README.md`: the feature blurb.

### Tests

- **`tests/backend/services/playwrightService.test.ts`, rewritten:**
  - mocks `waitForLoadState`, `evaluate`, and `errors.TimeoutError` (`MockTimeoutError`), with a fake `performance.now` clock (`fakeNowMs`) and the helper `readPaintWaitScript`;
  - covers the sequence order and the remaining-minimum arithmetic (180 ms);
  - covers no extra wait once the minimum is met, including exactly at it;
  - covers a cap that runs out (no paint, no wait), a cap of 0, and a per-website cap;
  - covers failures at each step;
  - runs the **real in-page paint script** against stubbed `document.fonts` / `requestAnimationFrame` (two frames; gives up at 2 s when frames or fonts never come).
- **Changed `tests/backend/utils/validateRequestBodies.test.ts`:**
  - the success cases gain the defaults;
  - new cases for values that pass, invalid values for each field, and a cap below the minimum (explicit, a defaulted cap, and 0 with the default minimum).
- **Changed `tests/backend/api/websites.test.ts`:** expectations include the settings; a pass-through test for custom values; 400 tests for a cap below the minimum and an out-of-range cap.
- **Changed `tests/backend/server.test.ts` and `tests/backend/api/playwright.test.ts`:** fixtures and expectations include the settings. The controller test uses non-default values to prove the row's settings are passed through.
- **Frontend:**
  - `buildWebsiteRecord` gained the defaults.
  - `WebsiteForm.test.tsx`: helpers `BLANK_VALUES`, `getNetworkIdleCapField`, `getMinimumWaitField`; the fields seed from `initialValues` and have a heading and helper text; numbers are submitted; a blank field blocks submit.
  - The create and edit pages: pre-fill and exact request bodies.
  - `ScreenshotRunsSection` and `WebsiteDetailPage`: caption text, including the cap-0 wording.

### Verification performed

- **psql:** the existing websites read 5000 / 300 after `db push`.
- **The user's dev servers had stopped** by the time of verification. I started `npm run dev`, passed the health check and the homepage sniff test, and stopped it afterwards.
- **First end-to-end run caught a real bug:** `page.evaluate: ReferenceError: __name is not defined`. A named inner function in the in-page script had been wrapped by esbuild. Fixed by keeping the in-page code anonymous, which is now documented in the code and README. Unit tests could not catch this because they mock the browser.
- **End-to-end run** with a throwaway Playwright script (`claude_tmp/verify-readiness.mts`), using temporary websites only:
  - The create form shows 5000 / 300, and the detail caption shows the settings.
  - **Forge `/` now shows the landing card, not the spinner. Forge `/login` shows the email and password inputs.**
  - Validation messages appear for 30001, -1, 1.5, and cap 200 below minimum 300. A blank field disables Save. A valid edit (4000/4000) saves and the caption updates.
  - **Local test site timings** (POST round trip, including browser launch):

    | Page | Cap / minimum | Time |
    |---|---|---|
    | never-idle | 1500 / 1000 | 1646 ms (the cap ended the wait) |
    | never-idle | 0 / 0 | 181 ms |
    | static | 5000 / 0 | 684 ms |
    | static | 5000 / 3000 | 3153 ms (the minimum is a floor) |
    | Forge | 5000 / 300 | 1068 ms (no extra wait) |

- **Checks:**
  - `npm run test:coverage`: 554 tests in 42 files, all passing. Statements 99.77%, branches 99.44%, functions 100%, lines 99.88%.
  - `npm run lint`, `npm run tsc` and `npm run tsc:client`: clean.
- **Cleanup:** every temporary website was soft-deleted, and the local test site was closed. The user's "Forge Gym management" and "Example Again" websites gained no runs.

### Notable during implementation

- **Forge's `/` never has email/password inputs.** It is a landing card; the form is at `/login`. The user was told, and the stored URL was not changed.
- **Playwright treats `timeout: 0` as "no timeout"**, which is why a cap of 0 is special-cased rather than passed through.
- No git history was written. Everything is left uncommitted in the working tree.

---

## 2026-10-02 17:08 EDT — Screenshot delay after page load (experiment, currently 200 ms)

**Intent:**
- Screenshots were taken before the page was ready. On the user's "Forge Gym management" website (`https://forge.aikazi.com/`) the PNG showed a loading spinner instead of the page.
- At the user's request, add a fixed wait between the page's `load` event and the screenshot, and tune its value by experiment.

### Decisions (all made by the user)

- First try 1 ms, then 200 ms. The value is still being tuned.

### Files changed

| File | Change |
|---|---|
| `server/services/playwrightService.ts` | **Added** constant `SCREENSHOT_DELAY_MS` (currently `200`). **Changed** `saveViewportScreenshot`: it now calls `page.waitForTimeout(SCREENSHOT_DELAY_MS)` before `page.screenshot`, inside the same `try`, so a failed wait is reported as "The screenshot could not be saved: …". Its JSDoc is updated. The wait runs only when navigation completed, and it is not counted in `durationMs`. |
| `server/services/README.md` | The "order of work" list gains the wait step (now step 4 of 5). |
| `tests/backend/services/playwrightService.test.ts` | `mockPage.waitForTimeout` added. New constant `EXPECTED_SCREENSHOT_DELAY_MS`. New tests: the wait runs after `goto` and before `screenshot` with the configured delay; a failed wait becomes a failed run with no screenshot. The navigation-failure test now also asserts there is no wait. |

### Verification performed

- **End-to-end runs** with a throwaway Playwright script (`claude_tmp/verify-delay.mts`). For each delay it created a temporary website at `https://forge.aikazi.com/?verify=<ts>`, clicked **Take screenshot** in the UI against the user's running dev server, saved the image, and soft-deleted the website.
  - **1 ms:** still shows the spinner.
  - **200 ms:** still shows the spinner.
- **Timing probe** (read-only, nothing recorded), over 3 visits each of `/` and `/login`:
  - Forge's real content appears **about 810 ms after `load`**, every time (809–816 ms).
  - At `networkidle` (about 830 ms from navigation start), the `/login` inputs were already visible.
- **The stored URL `https://forge.aikazi.com/` never shows email or password inputs.** After loading it is a landing card with "Log in" / "Create an account" buttons. The login form, with 2 inputs, is at `https://forge.aikazi.com/login`. The user was told; the stored URL was not changed.
- **Checks:**
  - `npm run test:coverage`: 515 tests in 42 files, all passing. Statements 99.75%, branches 99.39%, functions 100%, lines 99.87%.
  - `npm run lint` and `npm run tsc`: clean.
- **Not touched:** the user's own dev servers were left running. The user's Forge website gained no runs from this testing.

---

## 2026-10-02 17:00 EDT — Playwright controller: screenshot a website on demand

**Intent:**
- Add a **Playwright controller**. It launches a headless Chromium on the host machine, visits a website's stored URL, saves a screenshot, and records whether the visit succeeded.
- For now it runs only when the user clicks **Take screenshot** on the website detail page.
- Every run is saved. The page shows the selected run's status and screenshot (newest by default), plus a "Run history" list to pick older runs from.
- At the user's request, the folder screenshots are saved to is configurable (`SCREENSHOT_DIR`).

### Decisions (all made by the user)

- The button is on the **website detail page**, beside Edit/Delete.
- **Every run is recorded in the DB.** The PNG is a file on disk; the DB stores only its file name, relative to the screenshot folder.
- The UI shows the **latest run and a list of past runs**, and clicking one shows its screenshot.
- **Headless** Chromium. The capture is **viewport-only at 1280×720**.
- **Success** means navigation completed and the HTTP status was below 400.
  - A 404/500 page is a failed run that still has a screenshot.
  - A DNS error, refused connection, or timeout is a failed run with no screenshot.
- The default image folder is `screenshots/` at the repo root (gitignored). It is configurable via `SCREENSHOT_DIR`.
- **Screenshot runs follow the soft-delete convention** (`deletedAt`) and are soft-deleted together with their website.
- `playwright` **moved from devDependencies to dependencies**, at the same version.
- Approved in the plan:
  - a 30 s navigation timeout;
  - the POST answers **201 even for a failed visit**, because the run was still recorded;
  - the delete-website dialog also counts screenshot runs.

### Files changed — server

| File | Change |
|---|---|
| `server/prisma/schema.prisma` | **Added** model `ScreenshotRun` (`screenshot_runs`). Fields: `id`, `websiteId`, `requestedUrl`, `succeeded`, `httpStatus?`, `errorMessage?`, `screenshotFileName?`, `durationMs`, `createdAt`, `updatedAt`, `deletedAt?`, `website`. Index on `websiteId`. `Website` gained `screenshotRuns`, and its doc comment now says runs are soft-deleted with it. `db push` and `generate` were run; this was a new table only, with no data-loss prompt. |
| `server/services/dbService.ts` | **Added:** the `ScreenshotRun` type re-export; interface `ScreenshotRunInput`; `listScreenshotRunsForWebsite`, `findScreenshotRunForWebsite`, `createScreenshotRunForWebsite`. **Changed:** `softDeleteWebsite` (inner `softDeleteWebsiteAndItsChildren`) now also stamps the website's active screenshot runs with the shared `deletedAt`, and its JSDoc says so. |
| `server/services/playwrightService.ts` | **New.** See the breakdown below this table. |
| `server/controllers/playwright.ts` | **New.** See the breakdown below this table. |
| `server/utils/resolveScreenshotDirectory.ts` | **New.** `resolveScreenshotDirectory()` reads `SCREENSHOT_DIR`, trims it, resolves a relative value against `process.cwd()`, and throws if the value is missing or blank. |
| `server/server.ts` | **Added** `SCREENSHOT_DIRECTORY = resolveScreenshotDirectory()` at boot (fail fast) and `registerPlaywrightRoutes(app, SCREENSHOT_DIRECTORY)`. |

**`server/services/playwrightService.ts` in detail:**
- **Exports:** `ScreenshotCaptureResult` and `captureWebsiteScreenshot(url, screenshotFilePath)`.
- **Constants:** `NAVIGATION_TIMEOUT_MS`, `SCREENSHOT_VIEWPORT`, `FIRST_FAILING_HTTP_STATUS`.
- **Private type:** `NavigationOutcome`.
- **Private helpers:**
  - `measureElapsedMs`, `summarizeError` (keeps the first line only), `describeUnsuccessfulResponse`
  - `navigateToUrl`, `saveViewportScreenshot`, `visitPageAndCapture`
  - `closeBrowserQuietly`
- **Order of work:** create the folder (before launch), launch Chromium, open a page, visit, screenshot. The browser is closed in `finally`.

**`server/controllers/playwright.ts` in detail:**
- **Entry point:** `registerPlaywrightRoutes(app, screenshotDirectory)`.
- **Routes:**
  - `GET /api/websites/:websiteId/screenshot-runs`
  - `POST /api/websites/:websiteId/screenshot-runs`
  - `GET /api/websites/:websiteId/screenshot-runs/:screenshotRunId/screenshot`
- **Message constants:** `WEBSITE_NOT_FOUND_MESSAGE`, `SCREENSHOT_RUN_NOT_FOUND_MESSAGE`, `RUN_HAS_NO_SCREENSHOT_MESSAGE`, `SCREENSHOT_FILE_NOT_FOUND_MESSAGE`.
- **Private helpers:** `buildScreenshotFileName`, which gives `<website.id>/<uuid>.png`, and `readSendErrorStatus`.
- **How the image is served:** `res.sendFile(name, { root })` with a callback (`handleScreenshotFileSent`) that answers send errors itself.

### Files changed — client

| File | Change |
|---|---|
| `src/utils/routePaths.ts` | **Added** `screenshotRunsApiUrl(websiteId)` and `screenshotRunImageApiUrl(websiteId, screenshotRunId)`. |
| `src/utils/describeScreenshotRun.ts` | **New.** `ScreenshotRunOutcomeFields`, `describeScreenshotRunOutcome` ("Succeeded · HTTP 200" / "Failed · No response"), `formatRunDuration` ("1.2 s"). |
| `src/hooks/useScreenshotRuns.ts` | **New.** `ScreenshotRunRecord`, `ScreenshotRunsState`, `useScreenshotRuns(websiteId)` → `{ runs, isLoading, errorMessage, addTakenRun }`. Runs taken on this visit are shown first: they are filtered by `websiteId`, and fetched runs are de-duplicated by id. No refetch. |
| `src/components/ScreenshotRunsSection.tsx` | **New.** `ScreenshotRunsSectionProps` and `ScreenshotRunsSection`: the "Screenshots" section with a progress bar, a take-error alert, `LoadStatusNotice`, the empty state, the selected run, and the "Run history" list. Constants `HEADING_ID` and `HISTORY_HEADING_ID`. |
| `src/components/ScreenshotRunDetails.tsx` | **New.** `ScreenshotRunDetailsProps` and `ScreenshotRunDetails`: a `role="status"` outcome alert, the "Taken … · url" caption, and the `<img>` (or "No screenshot was captured for this run."). |
| `src/pages/WebsiteDetailPage.tsx` | **Added:** `screenshotRuns` / `addTakenRun` (`useScreenshotRuns`); a second `useJsonMutation` (`sendScreenshotRequest`, `screenshotIsInFlight`, `screenshotErrorMessage`); `selectedRunId` state; `screenshotRunCountText`; `takeScreenshot`; `handleTakeScreenshotClick`; the "Take screenshot" / "Taking screenshot…" button; `<ScreenshotRunsSection>`. **Changed:** the button row wraps (`useFlexGap`, `flexWrap`), the delete dialog message counts screenshot runs, and the page JSDoc. |

### Files changed — config, tooling, docs

- **`package.json` / `package-lock.json`:** `playwright@^1.58.2` moved from `devDependencies` to `dependencies`. `npm install` dropped its `dev` flags in the lockfile; installed version 1.63.0 is unchanged.
- **`.env`:** added `SCREENSHOT_DIR=screenshots`.
- **`.env.example`:** added a documented `SCREENSHOT_DIR`. `.env.local` was not touched.
- **`.gitignore`:** added `/screenshots/`.
- **READMEs updated:**
  - root `README.md`: feature blurb, `npx playwright install chromium` in setup, env table, tripwire note.
  - server: `server/controllers/README.md`, `server/services/README.md`, `server/utils/README.md`, `server/prisma/README.md`.
  - client: `src/hooks/README.md`, `src/components/README.md`, `src/pages/README.md`.
  - `tests/README.md`.

### Tests

**Backend:**
- **New specs:**
  - `tests/backend/utils/resolveScreenshotDirectory.test.ts`
  - `tests/backend/services/playwrightService.test.ts`, which mocks `playwright` and `node:fs/promises` so no real browser launches.
  - `tests/backend/api/playwright.test.ts`, with helpers `createPlaywrightApp` and `readRequestedScreenshotFilePath`. It covers every status in the route matrix, including path traversal (500 "Forbidden", no file served) and a directory name (500 "EISDIR, read").
- **New fixture:** `tests/backend/fixtures/screenshot-files/website-id-from-db/existing-run.png`, a 1×1 PNG served through the real `res.sendFile`.
- **Changed `tests/backend/services/dbService.test.ts`:**
  - `mockScreenshotRunDelegate` and `sampleScreenshotRun`.
  - The `softDeleteWebsite` tests now cover runs; one was renamed to "all four tables".
  - A new `describe("screenshot runs")` with 4 tests.
- **Changed `tests/backend/server.test.ts`:**
  - Mocks for the 3 new dbService functions and the Playwright service.
  - `sampleScreenshotRun`.
  - 2 wiring tests. One asserts the capture path is inside `resolveScreenshotDirectory()`.

**Frontend:**
- **New specs:** `describeScreenshotRun.test.tsx`, `useScreenshotRuns.test.tsx`, `ScreenshotRunsSection.test.tsx` (helpers `renderSection`, `getRunHistory`), `ScreenshotRunDetails.test.tsx`.
- **Changed `frontendTestHelpers.tsx`:** added `buildScreenshotRunRecord`.
- **Changed `routePaths.test.tsx`:** 3 tests for the screenshot run URLs.
- **Changed `App.test.tsx`:** `stubEveryPageRequest` stubs the runs list.
- **Changed `WebsiteDetailPage.test.tsx`:**
  - `SCREENSHOT_RUNS_API_URL` added. `stubLoadedWebsite` stubs the runs list as `[]`.
  - The delete-dialog texts were updated for the run count, and one new count test was added.
  - The loading and not-found tests also assert there is no Take screenshot button.
  - A new `describe("screenshots")` with 7 tests: in-flight state, POST once and no refetch, POST failure, list failure, selection.

### Verification performed

- **curl smoke test against the real dev server and DB:**
  - A run against the app's own homepage returned 201 `succeeded: true`, HTTP 200, and a PNG file that was 1280×720.
  - An Express 404 URL returned 201 `succeeded: false`, HTTP 404, with a screenshot.
  - A closed port returned 201 `succeeded: false`, `net::ERR_CONNECTION_REFUSED`, and `screenshotFileName: null`.
  - The image route answered 200 `image/png`. It answered 404 for a run with no image, an unknown run, a run of another website, and an unknown website.
- **manual-verifier agent** (Playwright, headless Chromium): **VERIFIED**, all 9 scenarios.
  - Statuses and images are correct, and the image's natural size is 1280×720.
  - The in-flight state was observed: the button disabled with "Taking screenshot…" and the progress bar shown.
  - A new run goes to the top and is selected. Runs persist across a reload. Selecting an older run works.
  - The empty state, a DNS failure, and both the singular and plural delete-dialog counts.
  - After a website is deleted, its runs list answers 404.
  - No console errors. The buttons wrap at 300 px.
- **`SCREENSHOT_DIR` override:** the server was started alone with `claude_tmp/alt-shots` (relative), an absolute path, and `claude_tmp/.hidden/shots` (a dot-folder). Each time:
  - the PNG landed in that folder, not in `screenshots/`;
  - the image route served it with 200.
  - An empty or whitespace-only value makes the server exit at startup with "SCREENSHOT_DIR is not defined in environment variables".
- **`npm run test:coverage`:** **513 tests in 42 files, all passing.**
  - Statements 99.75%, branches 99.39%, functions 100%, lines 99.87%, against thresholds of 80/70/80/80.
  - Uncovered: the NODE_ENV-guarded `startListening` in `server.ts`, and the `res.headersSent` (client aborted mid-download) guard in `playwright.ts`.
- `npm run lint`: clean. `npm run tsc` and `npm run tsc:client`: clean.
- **Cleanup:**
  - The 4 smoke-test websites were soft-deleted through the API. All 14 test runs now carry `deletedAt`, which confirms the cascade in Postgres.
  - The user's "Forge Gym management" and "Example Again" websites were left untouched.
  - `screenshots/` (test PNGs only) and every `claude_tmp/` file were removed.
  - The dev servers and a surviving `tsx watch` parent were stopped. Ports 3010 and 5180 are free.

### Notable during implementation

- **Port 1 is not a "connection refused" target.** Chromium blocks it as `net::ERR_UNSAFE_PORT` before connecting. Use a closed high port such as 59997.
- **A run that never reached a page still leaves an empty `<websiteId>/` folder,** because the folder is created before the browser launches, so that a bad `SCREENSHOT_DIR` fails fast.
- **The `tsx watch` parent ignored SIGTERM** after its child was gone, and needed SIGKILL (same root cause as in the previous entry).
- **Playwright's error text reaches the UI verbatim** (e.g. `page.goto: net::ERR_CONNECTION_REFUSED at …`), trimmed to its first line.
- No git history was written. Everything is left uncommitted in the working tree.

---

## 2026-10-02 16:14 EDT — Websites / Use cases / Actions CRUD, soft delete, JSDoc lint

**Intent:**
- Give the `websites` table a full CRUD API and UI, with a page per website.
- Add two website-owned concepts, **UseCase** and **Action** (title + description each), with their own CRUD API and pages.
- Make sure browser Back and Forward keep working across every screen.
- At the user's request, enforce JSDoc with `eslint-plugin-jsdoc` (`recommended-tsdoc-error`) and widen `npm run lint` from `server/` to `server/` + `src/`.

### Decisions (all made by the user)

- **Forms are separate routed pages**, not dialogs, so every screen is a history entry.
- **Soft delete on all three tables** (`deletedAt`). Deleting a website soft-deletes its active use cases and actions in one transaction with the same timestamp.
- **Website URL is unique among active websites only.** This uses Prisma 7.10's `partialIndexes` preview feature: `@@unique([url], where: { deletedAt: null })`. A deleted website's URL can be re-added.
- **URLs are normalized** with `new URL(input).href` (`HTTPS://Example.COM` → `https://example.com/`).
- **Use case and action descriptions are required.** The website description stays optional.
- **`@route` is registered** as a JSDoc tag. It is set through the `jsdoc/check-tag-names` rule option; `settings.jsdoc.definedTags` was verified not to work.
- **`npx prisma db push --accept-data-loss`** was run with explicit user consent. Prisma's AI-agent guard required the `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION` env var. The `websites` table had 0 rows.
- **`.claude/agents/manual-verifier.md`** wrote its memory into `/Users/khalah/Projects/new_plex/...`. At the user's choice it now points at this project's `.claude/agent-memory/manual-verifier/`.

### Files changed — server

| File | Change |
|---|---|
| `server/prisma/schema.prisma` | `previewFeatures = ["partialIndexes"]`. `Website`: added `deletedAt`, `useCases`, and `actions`; `@unique` on `url` replaced by the partial `@@unique`. **Added** models `UseCase` (`use_cases`) and `Action` (`actions`): `id`, `websiteId`, `title`, `description`, `createdAt`, `updatedAt`, `deletedAt`, plus an index on `websiteId`. |
| `server/services/dbService.ts` | See the breakdown below this table. |
| `server/utils/describeError.ts` | **New.** `describeError(error)`. |
| `server/utils/validateRequestBodies.ts` | **New.** Exports `ValidationResult<T>`, `validateWebsiteInput`, and `validateTitleDescriptionInput`. Private helpers: `isJsonObject`, `readTrimmedString`, `normalizeHttpUrl`. |
| `server/controllers/websites.ts` | **New.** `registerWebsiteRoutes(app)`: `GET`/`POST /api/websites`, `GET`/`PUT`/`DELETE /api/websites/:websiteId`. Constants `WEBSITE_NOT_FOUND_MESSAGE` and `DUPLICATE_URL_MESSAGE`. |
| `server/controllers/useCases.ts` | **New.** `registerUseCaseRoutes(app)`: `/api/websites/:websiteId/use-cases[/:useCaseId]`. |
| `server/controllers/actions.ts` | **New.** `registerActionRoutes(app)`: `/api/websites/:websiteId/actions[/:actionId]`. |
| `server/server.ts` | Registers the three new controllers. `startListening` JSDoc restyled (no `{Type}`). |
| `server/controllers/health.ts` | JSDoc restyled for the tsdoc preset. No code change. |
| `server/utils/resolveServerPort.ts` | JSDoc restyled. No code change. |

**`server/services/dbService.ts` in detail:**
- **Renamed** `CreateWebsiteInput` to `WebsiteInput`.
- **Added types:** `TitleDescriptionInput`, `UseCaseInput`, `ActionInput`. Also re-exports the `UseCase` and `Action` types.
- **Added error checks:** `isUniqueConstraintViolation` (P2002) and `isRecordNotFound` (P2025), sharing the private helper `hasPrismaErrorCode`.
- **Website functions added:** `findWebsiteById`, `updateWebsite` (atomic update; P2025 → null), and `softDeleteWebsite` (an interactive transaction; its callback is `softDeleteWebsiteAndItsChildren`).
- **Website functions changed:** `listWebsites` now filters out deleted rows; `findWebsiteByUrl` now uses `findFirst` and filters out deleted rows.
- **Removed:** `deleteWebsiteByUrl` (unused, and a hard delete contradicts soft delete).
- **Use case functions added:** `listUseCasesForWebsite`, `findUseCaseForWebsite`, `createUseCaseForWebsite`, `updateUseCaseForWebsite`, `softDeleteUseCaseForWebsite`.
- **Action functions added:** the same five, named `...ActionForWebsite` / `listActionsForWebsite`.
- **Implementation note:** the `$transaction` callback needs an explicit `Prisma.TransactionClient` type; without it, tsc reports an implicit `any`.

### Files changed — client

| File | Change |
|---|---|
| `src/App.tsx` | Renders `AppHeader` and the 10 routes. Each use case / action route element has its own `key`. |
| `src/main.tsx` | The `!` non-null assertion became a checked `rootElement` lookup that throws a clear error (lint). |
| `src/hooks/useHealth.ts` | `String(response.status)` in the template (lint). Added JSDoc to the inner `loadHealth`. Return JSDoc restyled. |
| `src/pages/HomePage.tsx` | JSDoc restyled. No code change. |
| `src/utils/describeError.ts` | **New.** `describeError` and `readResponseErrorMessage`. |
| `src/utils/routePaths.ts` | **New.** Page paths: `WEBSITE_LIST_PATH`, `NEW_WEBSITE_PATH`, `websiteDetailPath`, `websiteEditPath`, `newWebsiteItemPath`, `websiteItemDetailPath`, `websiteItemEditPath`. API URLs: `WEBSITES_API_URL`, `websiteApiUrl`, `websiteItemsApiUrl`, `websiteItemApiUrl`. |
| `src/utils/websiteItemKinds.ts` | **New.** `WebsiteItemKind`, `USE_CASE_KIND`, `ACTION_KIND`, `WebsiteItemPageProps`. |
| `src/utils/formatCount.ts` | **New.** `formatCount`. |
| `src/hooks/useJsonResource.ts` | **New.** `JsonResourceState<T>` and `useJsonResource(url)`. Its result is keyed by URL, it uses a `cancelled` flag, and its inner function is `loadResource`. |
| `src/hooks/useJsonMutation.ts` | **New.** `MutationMethod`, `MutationResult`, `SendJsonRequest`, `useJsonMutation()`. |
| `src/hooks/useWebsites.ts` | **New.** `WebsiteRecord`, `WebsiteRequestBody`, `useWebsites`, `useWebsite`. |
| `src/hooks/useWebsiteItems.ts` | **New.** `WebsiteItemRecord`, `WebsiteItemRequestBody`, `useWebsiteItems`, `useWebsiteItem`. |
| `src/hooks/useRequiredRouteParam.ts` | **New.** `useRequiredRouteParam`. |
| `src/hooks/useReturnNavigation.ts` | **New.** `ReturnState`, `useReturnToHereState`, `useReturnNavigation` (returns `returnTo` and `replaceKeepingReturnState`). Private helper `readReturnTo`. |
| `src/components/*.tsx` | **New.** `AppHeader`, `PageBreadcrumbs` (`BreadcrumbItem`), `LoadStatusNotice`, `ConfirmDeleteDialog`, `WebsiteForm`, `TitleDescriptionForm`, `WebsiteItemListSection`. Each comes with its `<Name>Props` interface. |
| `src/pages/Website*.tsx` | **New.** `WebsiteListPage`, `WebsiteCreatePage`, `WebsiteEditPage`, `WebsiteDetailPage`, `WebsiteItemCreatePage`, `WebsiteItemDetailPage`, `WebsiteItemEditPage`. |

**History rule:**
- Links into forms and detail pages carry `state.returnTo`.
- Cancel, edit-Save, and Delete go back one entry when `returnTo` matches the destination, and otherwise replace the current entry.
- Create-Save replaces the form entry with the new record's page and keeps that state.
- Result: history never holds a stale form or a duplicate `[detail, detail]`.

### Files changed — config, tooling, docs

- `package.json` / `package-lock.json`:
  - Added devDependency `eslint-plugin-jsdoc@^65.0.2`, which ships its own types.
  - `"lint"` is now `npx eslint server src`.
- `eslint.config.ts`:
  - Added the constant `jsdocTsdocPreset`.
  - Added a block applying it to `./server/**` and `./src/**`, with the `@route` `check-tag-names` option.
- `.claude/agents/manual-verifier.md`: memory path fixed (line 191).
- **READMEs updated:**
  - root `README.md`
  - `server/controllers/`, `server/services/`, `server/prisma/`, `server/utils/`
  - `src/`, `src/hooks/`, `src/pages/`
- **README added:** `src/components/README.md`.

### Tests

**Backend:**
- **New specs:**
  - `tests/backend/utils/describeError.test.ts`
  - `tests/backend/utils/validateRequestBodies.test.ts`
  - `tests/backend/api/websites.test.ts` (helper `createWebsitesApp`)
  - `tests/backend/api/useCases.test.ts` (helper `createUseCasesApp`)
  - `tests/backend/api/actions.test.ts` (helper `createActionsApp`)
- **Changed `tests/backend/services/dbService.test.ts`:**
  - Mocks for the `useCase`/`action` delegates and `$transaction`.
  - Helpers `createMockModelDelegate` and `readDeletedAtWrittenBy`.
  - The `deleteWebsiteByUrl` test was replaced by soft-delete tests, because that function was removed.
  - Two existing tests were renamed for soft-delete semantics.
- **Changed `tests/backend/server.test.ts`:**
  - Mocks dbService.
  - Four new "routes are wired" tests.
  - All original tests kept.

**Frontend:**
- **New specs:** one `tests/frontend/<Source>.test.tsx` per new util, hook, component, and page (24 files).
- **New shared module `tests/frontend/support/frontendTestHelpers.tsx`:**
  - `stubFetchRoutes`, `buildJsonResponse`, `buildUnparseableResponse`, `countRequests`
  - `createDeferred`, `createRejectedFetch`
  - `buildWebsiteRecord`, `buildWebsiteItemRecord`, `ITEM_KIND_TEST_CASES`
  - `LocationProbe`, `renderPageRoutes`, `readProbeAfterLanding`, `readBreadcrumbTrail`
  - Their types.
- **Changed `tests/frontend/App.test.tsx`:**
  - Added a `describe("App routes")` block with helper `stubEveryPageRequest`.
  - The original tests are unchanged.

The backend and frontend specs were written by two parallel subagents. Both were limited to `tests/` and reported no source bugs.

### Verification performed

- **Database:**
  - `psql \d websites` shows `websites_url_key UNIQUE ... WHERE "deletedAt" IS NULL`.
  - The `use_cases` and `actions` tables exist with their FKs and the `websiteId` index.
- **curl smoke test against the real DB:**
  - URL normalization works.
  - Duplicate URL returns 409 (P2002 arrives through the pg adapter).
  - Invalid bodies return 400.
  - Website delete stamps one identical `deletedAt` on the website, its use case, and its action, after which all three return 404.
  - Re-adding the deleted URL returns 201.
  - The test rows were then removed.
- **manual-verifier agent** (Playwright, about 75 checks): **VERIFIED**.
  - Create, view, edit, and delete for all three record types.
  - Back and Forward after save, cancel, and delete, with no stale forms and no duplicate entries.
  - Deep links and reloads work.
  - The delete dialog shows the counts.
  - Forward onto a deleted record shows "… not found".
  - No JS errors.
  - It left soft-deleted test rows and one active "Example Again" website in `easy_test_dev`.
- `npm run test:coverage`: **427 tests in 35 files, all passing.**
  - Statements 99.84%, branches 99.61%, functions 100%, lines 99.84%, against thresholds of 80/70/80/80.
  - The only uncovered line is the NODE_ENV-guarded `startListening(app, PORT)` in `server.ts`.
- `npm run lint` (server + src): clean. `npm run tsc` and `npm run tsc:client`: clean.

### Notable during implementation

- Prisma refuses `db push --accept-data-loss` from an AI agent until it gets consent in the moment. Earlier approval does not count.
- `./stop-dev.sh` kills only the **listeners** on 3010/5180. After the verifier's `npm run dev`, the parent `tsx watch` process survived and started a new server when server files were edited. It was found with `lsof` and stopped by PID. The script itself was not changed.
- `tests/` is outside `npm run lint`'s scope, by the user's choice. Some pre-existing test files still use `{Type}` JSDoc and would fail the jsdoc and strict TypeScript rules if they were ever linted.
- No git history was written. Everything is left uncommitted in the working tree.

---

## 2026-09-17 16:27 EDT — Initial development scaffold

**Intent:** Stand up a new project from empty, mirroring the architecture of the
`new_plex` repo, with a health API, a Hello World homepage that displays that
health live, and a Prisma `Website` table for saving URLs to test. Development
only — no production build, PM2, Docker, or CI.

The `new_plex` GitHub URL 404s (private repo); the architecture was taken from
the local clone at `/Users/khalah/Projects/new_plex`, which was read but never
modified.

### Decisions

- **Database:** local Homebrew PostgreSQL 18, database `easy_test_dev`, user
  `khalah`, no password. Not SQLite (which is what `new_plex` uses).
- **Ports:** `SERVER_PORT=3010`, `VITE_PORT=5180` — clear of every other project
  on this machine. `3011`/`5181` reserved for a future production pair.
- **Tests:** unit tests only, per user request. No `tests/playwright/` directory
  and no `playwright.config.ts`; Playwright is still used to drive end-to-end
  checks, but as throwaway scripts in `claude_tmp/`.
- **Git:** left uninitialized. The user runs `git init` themselves.
- **Tooling in `devDependencies`** (unlike `new_plex`, which needs it in
  `dependencies` for its `--omit=dev` production install). Tripwire recorded in
  `README.md`.

### Prisma 7 notes

Three findings that shaped the wiring, verified against the installed packages:

1. A **driver adapter is mandatory** — `PrismaClientOptions` types `adapter` as
   required unless `accelerateUrl` is given, so plain `new PrismaClient()`
   neither typechecks nor runs. Uses `@prisma/adapter-pg`.
2. npm's `prisma@latest` is **`8.0.0-rc.15`**, a prerelease. The Prisma trio is
   pinned `^7.3.0`, resolving to 7.10.0.
3. `@prisma/adapter-pg` ships `pg` and `@types/pg` as its own dependencies, so
   neither is declared here.

The datasource URL lives in `prisma.config.ts`, not `schema.prisma`.

### Files created

**Config / env:** `.gitignore`, `.env`, `.env.example`, `.env.local`,
`package.json`, `tsconfig.json`, `tsconfig.server.json`, `vite.config.ts`,
`vitest.config.ts`, `eslint.config.ts`, `stop-dev.sh`, `prisma.config.ts`.

**Server:**

| File | Added |
|---|---|
| `server/bootEnv.ts` | Module-load `dotenv.config()` for `.env.local` then `.env`. No exports. |
| `server/prisma/schema.prisma` | `Website` model (`id`, `url` unique, `name`, `description?`, `createdAt`, `updatedAt`), mapped to table `websites`. |
| `server/utils/resolveServerPort.ts` | `resolveServerPort(): number` |
| `server/controllers/health.ts` | `registerHealthRoutes(app: Express): void` → `GET /api/health` returning `{ status: "ok", uptime }` |
| `server/services/dbService.ts` | `CreateWebsiteInput` interface; `createWebsite`, `listWebsites`, `findWebsiteByUrl`, `deleteWebsiteByUrl`; module-private `prisma` and `adapter`; re-exports the `Website` type. |
| `server/server.ts` | `startListening(expressApp, port): Server`; exports `app`. Module-body `listen` guarded by `NODE_ENV !== "test"`. |

**Client:**

| File | Added |
|---|---|
| `index.html` | Vite entry. |
| `src/index.css` | Reset + dark page background. |
| `src/main.tsx` | Inline MUI dark `theme`; React root render. |
| `src/hooks/useHealth.ts` | `HealthStatus` interface; `useHealth()` returning `{ health, isLoading, errorMessage }`. |
| `src/pages/HomePage.tsx` | `HomePage()` — Hello World + live health chip. |
| `src/App.tsx` | `App()` — `BrowserRouter` with the `/` route. |

**Tests:** `tests/setup.ts`, `tests/backend/utils/resolveServerPort.test.ts`,
`tests/backend/api/health.test.ts`, `tests/backend/server.test.ts`,
`tests/backend/services/dbService.test.ts` (adds local helper
`createHealthApp()` in the health spec), `tests/frontend/App.test.tsx`,
`tests/frontend/HomePage.test.tsx` (adds local helper `createDeferredFetch()`).

**Docs:** `README.md`, this file, and a `README.md` in `server/`,
`server/controllers/`, `server/services/`, `server/utils/`, `server/prisma/`,
`src/`, `src/hooks/`, `src/pages/`, `tests/`.

### Notable during implementation

- **`npm run lint` initially failed** on `dbService.ts` with "was not found by
  the project service". Root cause: nothing imported it, so it belonged to no
  TypeScript project. Fixed by adding
  `tests/backend/services/dbService.test.ts` — which the module needed anyway —
  rather than by touching any config.
- The first version of that spec stubbed `PrismaClient` with `vi.fn(() => ...)`;
  vitest rejects a non-constructible mock for a `new` call. Changed both stubs
  to `class` declarations.

### Verification performed

- `createdb easy_test_dev`; `npm install` ran `prisma generate && prisma db push`
  cleanly. `npm ls` confirms `prisma`, `@prisma/client`, `@prisma/adapter-pg`
  all at 7.10.0.
- `psql -c '\d websites'` shows all six columns plus the unique index on `url`.
- Throwaway `claude_tmp/verifyDb.mts` did a full create → find → list → delete
  round trip through `dbService`, proving the pg adapter reaches Postgres.
  `@default(cuid())` generated fine with no deprecation warning.
- `npm run tsc` and `npm run tsc:client` — both clean.
- `npm run lint` — clean.
- `npm run test:coverage` — 28 tests pass; 97.05% statements, 93.1% branches,
  100% functions, 96.92% lines, all above the 80/70/80/80 thresholds.
- `npm run dev` came up on both ports. `GET /api/health` returns
  `{"status":"ok","uptime":...}` both directly on :3010 and through the Vite
  proxy on :5180; homepage returns 200.
- Throwaway `claude_tmp/verifyHomepage.mts` drove headless Chromium against
  :5180 and confirmed the "Hello World" heading and the live `ok` health chip
  both render, with no console errors. (`npx playwright install chromium` was
  needed first.)
- Dev servers stopped with `./stop-dev.sh`; `claude_tmp/` deleted.
