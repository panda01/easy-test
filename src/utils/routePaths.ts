import { ACTION_KIND, type WebsiteItemKind } from "./websiteItemKinds";

/*
 * Every page URL and API URL in the client is built here, so a link, a
 * navigate() call, and a fetch can never disagree about where something lives.
 * The route PATTERNS (with `:websiteId`) are declared literally in `App.tsx`.
 *
 * Ids are cuids and need no escaping, but they are still passed through
 * encodeURIComponent so a malformed id can never change the path's shape.
 */

// === Page paths ===

/**
 * The website list: the dashboard, which is the home page. The old
 * `/websites` URL redirects here (see `App.tsx`).
 */
export const WEBSITE_LIST_PATH = "/";

/** The create-website form page. */
export const NEW_WEBSITE_PATH = "/websites/new";

/**
 * Builds the path of a website's detail page.
 * @param websiteId - The website's cuid
 * @returns `/websites/<websiteId>`
 */
export function websiteDetailPath(websiteId: string): string {
  return `/websites/${encodeURIComponent(websiteId)}`;
}

/**
 * Builds the path of a website's edit form page.
 * @param websiteId - The website's cuid
 * @returns `/websites/<websiteId>/edit`
 */
export function websiteEditPath(websiteId: string): string {
  return `${websiteDetailPath(websiteId)}/edit`;
}

/**
 * Builds the path of the create form page for a use case or action.
 * @param itemKind - Which kind of website item
 * @param websiteId - The owning website's cuid
 * @returns `/websites/<websiteId>/<use-cases|actions>/new`
 */
export function newWebsiteItemPath(itemKind: WebsiteItemKind, websiteId: string): string {
  return `${websiteDetailPath(websiteId)}/${itemKind.pathSegment}/new`;
}

/**
 * Builds the path of a use case's or action's detail page.
 * @param itemKind - Which kind of website item
 * @param websiteId - The owning website's cuid
 * @param itemId - The item's cuid
 * @returns `/websites/<websiteId>/<use-cases|actions>/<itemId>`
 */
export function websiteItemDetailPath(
  itemKind: WebsiteItemKind,
  websiteId: string,
  itemId: string,
): string {
  return `${websiteDetailPath(websiteId)}/${itemKind.pathSegment}/${encodeURIComponent(itemId)}`;
}

/**
 * Builds the path of a use case's or action's edit form page.
 * @param itemKind - Which kind of website item
 * @param websiteId - The owning website's cuid
 * @param itemId - The item's cuid
 * @returns `/websites/<websiteId>/<use-cases|actions>/<itemId>/edit`
 */
export function websiteItemEditPath(
  itemKind: WebsiteItemKind,
  websiteId: string,
  itemId: string,
): string {
  return `${websiteItemDetailPath(itemKind, websiteId, itemId)}/edit`;
}

/**
 * Builds the path of the page that compares two of an action's script
 * versions side by side. Which two is kept in the page's own query string
 * (`?from=<scriptId>&to=<scriptId>`), so it is not part of this path.
 * @param websiteId - The owning website's cuid
 * @param actionId - The action's cuid
 * @returns `/websites/<websiteId>/actions/<actionId>/scripts/compare`
 */
export function actionScriptComparePath(websiteId: string, actionId: string): string {
  return `${websiteItemDetailPath(ACTION_KIND, websiteId, actionId)}/scripts/compare`;
}

/**
 * Builds the path of one action run's own page: the run's details and the
 * screenshots it took after each step.
 * @param websiteId - The owning website's cuid
 * @param actionId - The action's cuid
 * @param actionScriptId - The version that was run
 * @param actionScriptRunId - The run's cuid
 * @returns `/websites/<websiteId>/actions/<actionId>/scripts/<actionScriptId>/runs/<actionScriptRunId>`
 */
export function actionScriptRunDetailPath(
  websiteId: string,
  actionId: string,
  actionScriptId: string,
  actionScriptRunId: string,
): string {
  const actionPath = websiteItemDetailPath(ACTION_KIND, websiteId, actionId);
  return `${actionPath}/scripts/${encodeURIComponent(actionScriptId)}/runs/${encodeURIComponent(actionScriptRunId)}`;
}

/**
 * Builds the path of an action's page opened on one version and one of its
 * runs (the page reads `?script=` and `?run=` to select them) - where the
 * run page's breadcrumb leads back to.
 * @param websiteId - The owning website's cuid
 * @param actionId - The action's cuid
 * @param actionScriptId - The version to select
 * @param actionScriptRunId - The run to select
 * @returns `/websites/<websiteId>/actions/<actionId>?script=<actionScriptId>&run=<actionScriptRunId>`
 */
export function actionDetailPathWithRun(
  websiteId: string,
  actionId: string,
  actionScriptId: string,
  actionScriptRunId: string,
): string {
  const actionPath = websiteItemDetailPath(ACTION_KIND, websiteId, actionId);
  return `${actionPath}?script=${encodeURIComponent(actionScriptId)}&run=${encodeURIComponent(actionScriptRunId)}`;
}

/**
 * Builds the path of one crawl run's page: the tree of pages the crawl found
 * and each page's aria snapshot. Which page is selected is kept in the page's
 * own query string (`?page=<crawledPageId>`), so it is not part of this path.
 * @param websiteId - The owning website's cuid
 * @param crawlRunId - The crawl run's cuid
 * @returns `/websites/<websiteId>/crawl-runs/<crawlRunId>`
 */
export function crawlRunDetailPath(websiteId: string, crawlRunId: string): string {
  return `${websiteDetailPath(websiteId)}/crawl-runs/${encodeURIComponent(crawlRunId)}`;
}

/**
 * Builds the path of one crawl run's page opened on its site map's Objects
 * view: the crawl's pages grouped into web objects.
 * @param websiteId - The owning website's cuid
 * @param crawlRunId - The crawl run's cuid
 * @returns `/websites/<websiteId>/crawl-runs/<crawlRunId>?view=objects`
 */
export function crawlRunObjectsPath(websiteId: string, crawlRunId: string): string {
  return `${crawlRunDetailPath(websiteId, crawlRunId)}?view=objects`;
}

/**
 * Builds the path of the create form page for a website's credential.
 * @param websiteId - The owning website's cuid
 * @returns `/websites/<websiteId>/credentials/new`
 */
export function newCredentialPath(websiteId: string): string {
  return `${websiteDetailPath(websiteId)}/credentials/new`;
}

/**
 * Builds the path of a credential's edit form page (which also holds its
 * Delete button - a credential has no separate detail page).
 * @param websiteId - The owning website's cuid
 * @param credentialId - The credential's cuid
 * @returns `/websites/<websiteId>/credentials/<credentialId>/edit`
 */
export function credentialEditPath(websiteId: string, credentialId: string): string {
  return `${websiteDetailPath(websiteId)}/credentials/${encodeURIComponent(credentialId)}/edit`;
}

// === API urls (relative: the Vite dev server proxies /api to Express) ===

/** The website collection endpoint. */
export const WEBSITES_API_URL = "/api/websites";

/** The live list of models "Convert to script" can use, with their effort levels. */
export const SCRIPT_MODELS_API_URL = "/api/script-models";

/**
 * Builds the API url of one website.
 * @param websiteId - The website's cuid
 * @returns `/api/websites/<websiteId>`
 */
export function websiteApiUrl(websiteId: string): string {
  return `${WEBSITES_API_URL}/${encodeURIComponent(websiteId)}`;
}

/**
 * Builds the API url of a website's login-form check (POST: look for a
 * login form and, when one is found, make the website's Login action).
 * @param websiteId - The website's cuid
 * @returns `/api/websites/<websiteId>/login-check`
 */
export function websiteLoginCheckApiUrl(websiteId: string): string {
  return `${websiteApiUrl(websiteId)}/login-check`;
}

/** The query parameter that tells the website page a login form was just found when it was created. */
export const LOGIN_FORM_FOUND_QUERY_PARAMETER = "loginForm";

/**
 * Builds the path the website create page opens when the login-form check
 * found a login form: the new website's Credentials tab, saying so.
 * @param websiteId - The website's cuid
 * @returns `/websites/<websiteId>?tab=credentials&loginForm=found`
 */
export function websiteCredentialsAfterLoginFormFoundPath(websiteId: string): string {
  return `${websiteDetailPath(websiteId)}?tab=credentials&${LOGIN_FORM_FOUND_QUERY_PARAMETER}=found`;
}

/**
 * Builds the API url of a website's use case or action collection.
 * @param itemKind - Which kind of website item
 * @param websiteId - The owning website's cuid
 * @returns `/api/websites/<websiteId>/<use-cases|actions>`
 */
export function websiteItemsApiUrl(itemKind: WebsiteItemKind, websiteId: string): string {
  return `${websiteApiUrl(websiteId)}/${itemKind.pathSegment}`;
}

/**
 * Builds the API url of one use case or action.
 * @param itemKind - Which kind of website item
 * @param websiteId - The owning website's cuid
 * @param itemId - The item's cuid
 * @returns `/api/websites/<websiteId>/<use-cases|actions>/<itemId>`
 */
export function websiteItemApiUrl(
  itemKind: WebsiteItemKind,
  websiteId: string,
  itemId: string,
): string {
  return `${websiteItemsApiUrl(itemKind, websiteId)}/${encodeURIComponent(itemId)}`;
}

/**
 * Builds the API url of a website's screenshot run collection: GET lists the
 * recorded runs, POST visits the website and records a new run.
 * @param websiteId - The owning website's cuid
 * @returns `/api/websites/<websiteId>/screenshot-runs`
 */
export function screenshotRunsApiUrl(websiteId: string): string {
  return `${websiteApiUrl(websiteId)}/screenshot-runs`;
}

/**
 * Builds the API url of one screenshot run's PNG, for an `<img src>`.
 * @param websiteId - The owning website's cuid
 * @param screenshotRunId - The screenshot run's cuid
 * @returns `/api/websites/<websiteId>/screenshot-runs/<screenshotRunId>/screenshot`
 */
export function screenshotRunImageApiUrl(websiteId: string, screenshotRunId: string): string {
  return `${screenshotRunsApiUrl(websiteId)}/${encodeURIComponent(screenshotRunId)}/screenshot`;
}

/**
 * Builds the API url of an action's script collection: GET lists every saved
 * version, POST converts the action into a new version with Claude.
 * @param websiteId - The owning website's cuid
 * @param actionId - The action's cuid
 * @returns `/api/websites/<websiteId>/actions/<actionId>/scripts`
 */
export function actionScriptsApiUrl(websiteId: string, actionId: string): string {
  return `${websiteItemApiUrl(ACTION_KIND, websiteId, actionId)}/scripts`;
}

/**
 * Builds the API url of a script's run collection: GET lists the recorded
 * runs, POST runs the script and records a new run.
 * @param websiteId - The owning website's cuid
 * @param actionId - The owning action's cuid
 * @param actionScriptId - The script's cuid
 * @returns `/api/websites/<websiteId>/actions/<actionId>/scripts/<actionScriptId>/runs`
 */
export function actionScriptRunsApiUrl(
  websiteId: string,
  actionId: string,
  actionScriptId: string,
): string {
  return `${actionScriptsApiUrl(websiteId, actionId)}/${encodeURIComponent(actionScriptId)}/runs`;
}

/**
 * Builds the API url that saves an edited plan as a NEW version of an
 * action: POST `{ plan }`, edited from the given version.
 * @param websiteId - The owning website's cuid
 * @param actionId - The owning action's cuid
 * @param actionScriptId - The version that was edited
 * @returns `/api/websites/<websiteId>/actions/<actionId>/scripts/<actionScriptId>/edits`
 */
export function actionScriptEditsApiUrl(
  websiteId: string,
  actionId: string,
  actionScriptId: string,
): string {
  return `${actionScriptsApiUrl(websiteId, actionId)}/${encodeURIComponent(actionScriptId)}/edits`;
}

/**
 * Builds the API url of one run, as the run page reads it: the run with its
 * created and deleted objects, its cleanup links, and its step screenshots.
 * @param websiteId - The owning website's cuid
 * @param actionId - The owning action's cuid
 * @param actionScriptId - The script's cuid
 * @param actionScriptRunId - The run's cuid
 * @returns `/api/websites/<websiteId>/actions/<actionId>/scripts/<actionScriptId>/runs/<actionScriptRunId>`
 */
export function actionScriptRunApiUrl(
  websiteId: string,
  actionId: string,
  actionScriptId: string,
  actionScriptRunId: string,
): string {
  const runsApiUrl = actionScriptRunsApiUrl(websiteId, actionId, actionScriptId);
  return `${runsApiUrl}/${encodeURIComponent(actionScriptRunId)}`;
}

/**
 * Builds the API url of one step screenshot PNG of a run, for an `<img src>`.
 * @param websiteId - The owning website's cuid
 * @param actionId - The owning action's cuid
 * @param actionScriptId - The script's cuid
 * @param actionScriptRunId - The run's cuid
 * @param screenshotId - The step screenshot's cuid
 * @returns `/api/websites/<websiteId>/actions/<actionId>/scripts/<actionScriptId>/runs/<actionScriptRunId>/screenshots/<screenshotId>`
 */
export function actionScriptRunScreenshotApiUrl(
  websiteId: string,
  actionId: string,
  actionScriptId: string,
  actionScriptRunId: string,
  screenshotId: string,
): string {
  const runApiUrl = actionScriptRunApiUrl(websiteId, actionId, actionScriptId, actionScriptRunId);
  return `${runApiUrl}/screenshots/${encodeURIComponent(screenshotId)}`;
}

/**
 * Builds the API url of one failed run's screenshot PNG, for an `<img src>`.
 * @param websiteId - The owning website's cuid
 * @param actionId - The owning action's cuid
 * @param actionScriptId - The script's cuid
 * @param actionScriptRunId - The run's cuid
 * @returns `/api/websites/<websiteId>/actions/<actionId>/scripts/<actionScriptId>/runs/<actionScriptRunId>/failure-screenshot`
 */
export function actionScriptRunFailureScreenshotApiUrl(
  websiteId: string,
  actionId: string,
  actionScriptId: string,
  actionScriptRunId: string,
): string {
  const runsApiUrl = actionScriptRunsApiUrl(websiteId, actionId, actionScriptId);
  return `${runsApiUrl}/${encodeURIComponent(actionScriptRunId)}/failure-screenshot`;
}

/**
 * Builds the API url that refines a failed run's version into a NEW version
 * of the action: POST `{ note }`, and Claude (the model that wrote the
 * version) is sent the run's error, failure screenshot, and failing page.
 * @param websiteId - The owning website's cuid
 * @param actionId - The owning action's cuid
 * @param actionScriptId - The version that was run
 * @param actionScriptRunId - The failed run's cuid
 * @returns `/api/websites/<websiteId>/actions/<actionId>/scripts/<actionScriptId>/runs/<actionScriptRunId>/refinements`
 */
export function actionScriptRunRefinementsApiUrl(
  websiteId: string,
  actionId: string,
  actionScriptId: string,
  actionScriptRunId: string,
): string {
  const runsApiUrl = actionScriptRunsApiUrl(websiteId, actionId, actionScriptId);
  return `${runsApiUrl}/${encodeURIComponent(actionScriptRunId)}/refinements`;
}

/**
 * Builds the API url that starts an auto-refine job from one version: POST
 * `{ parameterValues }` runs that version in the background with those
 * run-form values and, on failure, refines it and runs the refined version,
 * up to five refinements. The server answers 201 with the job at once.
 * @param websiteId - The owning website's cuid
 * @param actionId - The owning action's cuid
 * @param actionScriptId - The version the job starts from
 * @returns `/api/websites/<websiteId>/actions/<actionId>/scripts/<actionScriptId>/auto-refine-jobs`
 */
export function autoRefineJobsApiUrl(
  websiteId: string,
  actionId: string,
  actionScriptId: string,
): string {
  return `${actionScriptsApiUrl(websiteId, actionId)}/${encodeURIComponent(actionScriptId)}/auto-refine-jobs`;
}

/**
 * Builds the API url of an action's auto-refine job collection: GET lists
 * every job of the action, newest first (the page reads it on load to find a
 * job still running).
 * @param websiteId - The owning website's cuid
 * @param actionId - The action's cuid
 * @returns `/api/websites/<websiteId>/actions/<actionId>/auto-refine-jobs`
 */
export function actionAutoRefineJobsApiUrl(websiteId: string, actionId: string): string {
  return `${websiteItemApiUrl(ACTION_KIND, websiteId, actionId)}/auto-refine-jobs`;
}

/**
 * Builds the API url of one auto-refine job: GET reads it, polled while it
 * runs.
 * @param websiteId - The owning website's cuid
 * @param actionId - The owning action's cuid
 * @param autoRefineJobId - The job's cuid
 * @returns `/api/websites/<websiteId>/actions/<actionId>/auto-refine-jobs/<autoRefineJobId>`
 */
export function autoRefineJobApiUrl(websiteId: string, actionId: string, autoRefineJobId: string): string {
  return `${actionAutoRefineJobsApiUrl(websiteId, actionId)}/${encodeURIComponent(autoRefineJobId)}`;
}

/**
 * Builds the API url that asks a running auto-refine job to stop after the
 * step in flight: POST with no body, answered 200 with the job.
 * @param websiteId - The owning website's cuid
 * @param actionId - The owning action's cuid
 * @param autoRefineJobId - The job's cuid
 * @returns `/api/websites/<websiteId>/actions/<actionId>/auto-refine-jobs/<autoRefineJobId>/stop`
 */
export function autoRefineJobStopApiUrl(websiteId: string, actionId: string, autoRefineJobId: string): string {
  return `${autoRefineJobApiUrl(websiteId, actionId, autoRefineJobId)}/stop`;
}

/**
 * Builds the API url of a website's crawl run collection: GET lists the runs,
 * POST starts a new crawl in the background.
 * @param websiteId - The owning website's cuid
 * @returns `/api/websites/<websiteId>/crawl-runs`
 */
export function crawlRunsApiUrl(websiteId: string): string {
  return `${websiteApiUrl(websiteId)}/crawl-runs`;
}

/**
 * Builds the API url of one crawl run: the run plus its page summaries (the
 * page tree, without snapshots), polled while the crawl runs.
 * @param websiteId - The owning website's cuid
 * @param crawlRunId - The crawl run's cuid
 * @returns `/api/websites/<websiteId>/crawl-runs/<crawlRunId>`
 */
export function crawlRunApiUrl(websiteId: string, crawlRunId: string): string {
  return `${crawlRunsApiUrl(websiteId)}/${encodeURIComponent(crawlRunId)}`;
}

/**
 * Builds the API url of the screenshot a crawl took when its login failed,
 * for an `<img src>`.
 * @param websiteId - The owning website's cuid
 * @param crawlRunId - The crawl run's cuid
 * @returns `/api/websites/<websiteId>/crawl-runs/<crawlRunId>/login-failure-screenshot`
 */
export function crawlRunLoginFailureScreenshotApiUrl(websiteId: string, crawlRunId: string): string {
  return `${crawlRunApiUrl(websiteId, crawlRunId)}/login-failure-screenshot`;
}

/**
 * Builds the API url of one crawled page in full, aria snapshot included.
 * @param websiteId - The owning website's cuid
 * @param crawlRunId - The crawl run's cuid
 * @param crawledPageId - The page's cuid
 * @returns `/api/websites/<websiteId>/crawl-runs/<crawlRunId>/pages/<crawledPageId>`
 */
export function crawledPageApiUrl(
  websiteId: string,
  crawlRunId: string,
  crawledPageId: string,
): string {
  return `${crawlRunApiUrl(websiteId, crawlRunId)}/pages/${encodeURIComponent(crawledPageId)}`;
}

/**
 * Builds the API url of a website's credential collection: GET lists them
 * (never with passwords), POST creates one.
 * @param websiteId - The owning website's cuid
 * @returns `/api/websites/<websiteId>/credentials`
 */
export function credentialsApiUrl(websiteId: string): string {
  return `${websiteApiUrl(websiteId)}/credentials`;
}

/**
 * Builds the API url of a website's web objects: GET lists the ones its
 * latest crawl found.
 * @param websiteId - The owning website's cuid
 * @returns `/api/websites/<websiteId>/web-objects`
 */
export function webObjectsApiUrl(websiteId: string): string {
  return `${websiteApiUrl(websiteId)}/web-objects`;
}

/**
 * Builds the API url of one web object: PUT `{ name }` renames it.
 * @param websiteId - The owning website's cuid
 * @param webObjectId - The web object's cuid
 * @returns `/api/websites/<websiteId>/web-objects/<webObjectId>`
 */
export function webObjectApiUrl(websiteId: string, webObjectId: string): string {
  return `${webObjectsApiUrl(websiteId)}/${encodeURIComponent(webObjectId)}`;
}

/**
 * Builds the API url of one credential: GET reads it, PUT replaces it, DELETE
 * removes it.
 * @param websiteId - The owning website's cuid
 * @param credentialId - The credential's cuid
 * @returns `/api/websites/<websiteId>/credentials/<credentialId>`
 */
export function credentialApiUrl(websiteId: string, credentialId: string): string {
  return `${credentialsApiUrl(websiteId)}/${encodeURIComponent(credentialId)}`;
}

/**
 * Builds the API url of one version's parameters: GET reads them (with the
 * action's object role, the object choices, and a Create action's confirm
 * step and name parameter), POST adds one of the user's own.
 * @param websiteId - The owning website's cuid
 * @param actionId - The owning action's cuid
 * @param actionScriptId - The version's cuid
 * @returns `/api/websites/<websiteId>/actions/<actionId>/scripts/<actionScriptId>/parameters`
 */
export function actionScriptParametersApiUrl(
  websiteId: string,
  actionId: string,
  actionScriptId: string,
): string {
  return `${actionScriptsApiUrl(websiteId, actionId)}/${encodeURIComponent(actionScriptId)}/parameters`;
}

/**
 * Builds the API url of one of an action's parameters: PUT
 * `{ userLabel, userRequiredChoice }` changes it, DELETE removes one the user
 * added.
 * @param websiteId - The owning website's cuid
 * @param actionId - The owning action's cuid
 * @param parameterKey - The parameter's key
 * @returns `/api/websites/<websiteId>/actions/<actionId>/parameters/<parameterKey>`
 */
export function actionParameterApiUrl(websiteId: string, actionId: string, parameterKey: string): string {
  return `${websiteItemApiUrl(ACTION_KIND, websiteId, actionId)}/parameters/${encodeURIComponent(parameterKey)}`;
}

/**
 * Builds the API url of a website's created objects: GET lists the record of
 * the objects its Create actions made.
 * @param websiteId - The owning website's cuid
 * @returns `/api/websites/<websiteId>/created-objects`
 */
export function createdObjectsApiUrl(websiteId: string): string {
  return `${websiteApiUrl(websiteId)}/created-objects`;
}

/**
 * Builds the API url of one created object: DELETE removes it from the record.
 * @param websiteId - The owning website's cuid
 * @param createdObjectId - The created object's cuid
 * @returns `/api/websites/<websiteId>/created-objects/<createdObjectId>`
 */
export function createdObjectApiUrl(websiteId: string, createdObjectId: string): string {
  return `${createdObjectsApiUrl(websiteId)}/${encodeURIComponent(createdObjectId)}`;
}

/**
 * Builds the path of the page that adds the Delete action cleaning up after
 * a Create action (step 2 of making a Create action, reached again later from
 * the action's page when it was skipped).
 * @param websiteId - The owning website's cuid
 * @param actionId - The Create action's cuid
 * @returns `/websites/<websiteId>/actions/<actionId>/delete-action/new`
 */
export function newDeleteActionPath(websiteId: string, actionId: string): string {
  return `${websiteItemDetailPath(ACTION_KIND, websiteId, actionId)}/delete-action/new`;
}

/**
 * Builds the API url that asks Claude to propose the Delete action for a
 * Create action (POST; nothing is saved).
 * @param websiteId - The owning website's cuid
 * @param actionId - The Create action's cuid
 * @returns `/api/websites/<websiteId>/actions/<actionId>/delete-action/proposal`
 */
export function deleteActionProposalApiUrl(websiteId: string, actionId: string): string {
  return `${websiteItemApiUrl(ACTION_KIND, websiteId, actionId)}/delete-action/proposal`;
}

/**
 * Builds the API url that creates and links a Create action's Delete action
 * (POST `{ title, description }`).
 * @param websiteId - The owning website's cuid
 * @param actionId - The Create action's cuid
 * @returns `/api/websites/<websiteId>/actions/<actionId>/delete-action`
 */
export function deleteActionApiUrl(websiteId: string, actionId: string): string {
  return `${websiteItemApiUrl(ACTION_KIND, websiteId, actionId)}/delete-action`;
}

/**
 * Builds the API url of a Login action's login runs: GET lists them, newest
 * first; POST runs the login once ("Run login") and records it.
 * @param websiteId - The owning website's cuid
 * @param actionId - The Login action's cuid
 * @returns `/api/websites/<websiteId>/actions/<actionId>/login-runs`
 */
export function loginRunsApiUrl(websiteId: string, actionId: string): string {
  return `${websiteItemApiUrl(ACTION_KIND, websiteId, actionId)}/login-runs`;
}

/**
 * Builds the API url of one login run's screenshot (GET, a PNG): logged in,
 * or what the failed login showed.
 * @param websiteId - The owning website's cuid
 * @param actionId - The Login action's cuid
 * @param loginRunId - The login run's cuid
 * @returns `/api/websites/<websiteId>/actions/<actionId>/login-runs/<loginRunId>/screenshot`
 */
export function loginRunScreenshotApiUrl(websiteId: string, actionId: string, loginRunId: string): string {
  return `${loginRunsApiUrl(websiteId, actionId)}/${encodeURIComponent(loginRunId)}/screenshot`;
}
