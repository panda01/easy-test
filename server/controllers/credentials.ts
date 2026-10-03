import { type Express } from "express";
import {
  findWebsiteById,
  listCredentialsForWebsite,
  findCredentialForWebsite,
  createCredentialForWebsite,
  updateCredentialForWebsite,
  softDeleteCredentialForWebsite,
  type CredentialSummary,
} from "../services/dbService.js";
import { describeError } from "../utils/describeError.js";
import { validateCredentialInput } from "../utils/validateRequestBodies.js";
import {
  CREDENTIAL_KEY_NOT_CONFIGURED_MESSAGE,
  credentialEncryptionIsConfigured,
  encryptCredentialPassword,
} from "../utils/credentialEncryption.js";

const WEBSITE_NOT_FOUND_MESSAGE = "Website not found";
const CREDENTIAL_NOT_FOUND_MESSAGE = "Credential not found";
const NO_LOGIN_URL_ANYWHERE_MESSAGE =
  "A login page URL is required - this website doesn't have one yet";

/** A credential as the API sends it: never the password, only the fact that one is saved. */
type CredentialResponse = CredentialSummary & {
  /** Always true - every credential has a saved password - so the UI can say so without ever receiving it. */
  hasPassword: true;
};

/**
 * Checks whether a credential would have no login page to log in on: it has
 * no login URL of its own, and its website has none to inherit either.
 * @param credentialLoginUrl - The credential's own login URL, as validated (null to inherit the website's)
 * @param websiteLoginUrl - The website's login URL, or null when it has none
 * @returns True when neither has a login URL, so the credential could never log in
 */
function credentialHasNoEffectiveLoginUrl(
  credentialLoginUrl: string | null,
  websiteLoginUrl: string | null,
): boolean {
  const credentialHasNoLoginUrl = credentialLoginUrl === null;
  const websiteHasNoLoginUrl = websiteLoginUrl === null;
  return credentialHasNoLoginUrl && websiteHasNoLoginUrl;
}

/**
 * Shapes a credential for a response. The row already lacks the encrypted
 * password (`CredentialSummary`); this only adds `hasPassword`.
 * @param credential - The credential, without its password
 * @returns The credential as the API sends it
 */
function toCredentialResponse(credential: CredentialSummary): CredentialResponse {
  return { ...credential, hasPassword: true };
}

/**
 * Registers the credential CRUD routes on the given express app. A credential
 * is a username and password for one website, used to crawl it logged in.
 * Every path is nested under `/api/websites/:websiteId`, and every route first
 * confirms that website is active - a deleted or unknown website answers 404
 * "Website not found" before the credential is even looked up.
 *
 * PASSWORDS: a password is sent in only (on POST and PUT), encrypted with
 * `CREDENTIAL_ENCRYPTION_KEY` before it is stored, and NEVER sent back - no
 * response contains the password or its encrypted form, only
 * `hasPassword: true`. Saving a password needs the key: without it POST, and
 * a PUT that sends a new password, answer 503.
 *
 * LOGIN URL: a credential's own `loginUrl` is an optional override. Left out
 * (null), the credential logs in on its website's `loginUrl`. POST and PUT
 * answer 400 when the credential has no login URL and its website has none
 * either, since it could never log in.
 *
 * Deletes are SOFT: `DELETE` stamps `deletedAt` and reads ignore such rows.
 * Crawl runs that used a deleted credential still name it.
 * @param app - The express application to attach the routes to
 */
export function registerCredentialRoutes(app: Express): void {
  /**
   * Lists a website's active credentials, newest first, without their passwords.
   * @route GET /api/websites/:websiteId/credentials
   * @param websiteId - Path parameter: the owning website's cuid
   * @returns 200 with an array of credentials (no passwords); 404 with `{ error }` when the website does not exist or was deleted; 500 with `{ error }` when a query fails
   */
  app.get("/api/websites/:websiteId/credentials", async (req, res) => {
    try {
      const website = await findWebsiteById(req.params.websiteId);
      if (website === null) {
        res.status(404).json({ error: WEBSITE_NOT_FOUND_MESSAGE });
        return;
      }
      const credentials = await listCredentialsForWebsite(website.id);
      res.json(credentials.map(toCredentialResponse));
    } catch (error: unknown) {
      res.status(500).json({ error: describeError(error) });
    }
  });

  /**
   * Creates a credential on a website. The password is encrypted before it is
   * stored and is not part of the response.
   * @route POST /api/websites/:websiteId/credentials
   * @param websiteId - Path parameter: the owning website's cuid
   * @param body - JSON `{ name, description?, username, password, loginUrl?, usernameSelector?, passwordSelector?, submitSelector? }`; `name`, `username`, and `password` are required; `loginUrl` is an optional http/https override - left out, null, or blank means "use the website's login URL"; the selectors are optional CSS selectors
   * @returns 201 with the created credential (no password); 400 with `{ error }` for an invalid body, or when the body has no `loginUrl` and the website has no login URL either; 404 with `{ error }` when the website does not exist or was deleted; 503 with `{ error }` when CREDENTIAL_ENCRYPTION_KEY is not configured; 500 with `{ error }` otherwise
   */
  app.post("/api/websites/:websiteId/credentials", async (req, res) => {
    const validation = validateCredentialInput(req.body, { passwordIsRequired: true });
    if (!validation.isValid) {
      res.status(400).json({ error: validation.errorMessage });
      return;
    }

    try {
      const website = await findWebsiteById(req.params.websiteId);
      if (website === null) {
        res.status(404).json({ error: WEBSITE_NOT_FOUND_MESSAGE });
        return;
      }
      const { credential, password } = validation.input;
      if (credentialHasNoEffectiveLoginUrl(credential.loginUrl, website.loginUrl)) {
        res.status(400).json({ error: NO_LOGIN_URL_ANYWHERE_MESSAGE });
        return;
      }
      // The validator already requires a password on create; this check only
      // narrows its type for the encryption below.
      const passwordIsMissing = password === null;
      if (passwordIsMissing) {
        res.status(400).json({ error: "A password is required" });
        return;
      }
      if (!credentialEncryptionIsConfigured()) {
        res.status(503).json({ error: CREDENTIAL_KEY_NOT_CONFIGURED_MESSAGE });
        return;
      }
      const created = await createCredentialForWebsite(
        website.id,
        credential,
        encryptCredentialPassword(password),
      );
      res.status(201).json(toCredentialResponse(created));
    } catch (error: unknown) {
      res.status(500).json({ error: describeError(error) });
    }
  });

  /**
   * Fetches one active credential of a website, without its password.
   * @route GET /api/websites/:websiteId/credentials/:credentialId
   * @param websiteId - Path parameter: the owning website's cuid
   * @param credentialId - Path parameter: the credential's cuid
   * @returns 200 with the credential (no password); 404 with `{ error }` when the website or the credential does not exist or was deleted; 500 with `{ error }` when a query fails
   */
  app.get("/api/websites/:websiteId/credentials/:credentialId", async (req, res) => {
    try {
      const website = await findWebsiteById(req.params.websiteId);
      if (website === null) {
        res.status(404).json({ error: WEBSITE_NOT_FOUND_MESSAGE });
        return;
      }
      const credential = await findCredentialForWebsite(website.id, req.params.credentialId);
      if (credential === null) {
        res.status(404).json({ error: CREDENTIAL_NOT_FOUND_MESSAGE });
        return;
      }
      res.json(toCredentialResponse(credential));
    } catch (error: unknown) {
      res.status(500).json({ error: describeError(error) });
    }
  });

  /**
   * Replaces an active credential's fields. The password is the one
   * exception to "PUT replaces": leaving it out (or sending null or "") keeps
   * the saved password, because the client never receives it to send back.
   * @route PUT /api/websites/:websiteId/credentials/:credentialId
   * @param websiteId - Path parameter: the owning website's cuid
   * @param credentialId - Path parameter: the credential's cuid
   * @param body - JSON `{ name, description?, username, password?, loginUrl?, usernameSelector?, passwordSelector?, submitSelector? }`; same rules as POST (a left-out `loginUrl` clears the override, so the website's is used), except `password` may be left out to keep the saved one
   * @returns 200 with the updated credential (no password); 400 with `{ error }` for an invalid body, or when the body has no `loginUrl` and the website has no login URL either; 404 with `{ error }` when the website or the credential does not exist or was deleted; 503 with `{ error }` when a new password was sent but CREDENTIAL_ENCRYPTION_KEY is not configured; 500 with `{ error }` otherwise
   */
  app.put("/api/websites/:websiteId/credentials/:credentialId", async (req, res) => {
    const validation = validateCredentialInput(req.body, { passwordIsRequired: false });
    if (!validation.isValid) {
      res.status(400).json({ error: validation.errorMessage });
      return;
    }

    try {
      const website = await findWebsiteById(req.params.websiteId);
      if (website === null) {
        res.status(404).json({ error: WEBSITE_NOT_FOUND_MESSAGE });
        return;
      }
      const { credential, password } = validation.input;
      if (credentialHasNoEffectiveLoginUrl(credential.loginUrl, website.loginUrl)) {
        res.status(400).json({ error: NO_LOGIN_URL_ANYWHERE_MESSAGE });
        return;
      }
      const passwordIsBeingReplaced = password !== null;
      const newPasswordCannotBeEncrypted =
        passwordIsBeingReplaced && !credentialEncryptionIsConfigured();
      if (newPasswordCannotBeEncrypted) {
        res.status(503).json({ error: CREDENTIAL_KEY_NOT_CONFIGURED_MESSAGE });
        return;
      }
      const encryptedPassword = passwordIsBeingReplaced
        ? encryptCredentialPassword(password)
        : null;
      const updated = await updateCredentialForWebsite(
        website.id,
        req.params.credentialId,
        credential,
        encryptedPassword,
      );
      if (updated === null) {
        res.status(404).json({ error: CREDENTIAL_NOT_FOUND_MESSAGE });
        return;
      }
      res.json(toCredentialResponse(updated));
    } catch (error: unknown) {
      res.status(500).json({ error: describeError(error) });
    }
  });

  /**
   * Soft deletes one active credential of a website. Crawl runs that used it
   * keep naming it.
   * @route DELETE /api/websites/:websiteId/credentials/:credentialId
   * @param websiteId - Path parameter: the owning website's cuid
   * @param credentialId - Path parameter: the credential's cuid
   * @returns 204 with no body; 404 with `{ error }` when the website or the credential does not exist or was already deleted; 500 with `{ error }` when a query fails
   */
  app.delete("/api/websites/:websiteId/credentials/:credentialId", async (req, res) => {
    try {
      const website = await findWebsiteById(req.params.websiteId);
      if (website === null) {
        res.status(404).json({ error: WEBSITE_NOT_FOUND_MESSAGE });
        return;
      }
      const credentialWasDeleted = await softDeleteCredentialForWebsite(
        website.id,
        req.params.credentialId,
      );
      if (!credentialWasDeleted) {
        res.status(404).json({ error: CREDENTIAL_NOT_FOUND_MESSAGE });
        return;
      }
      res.status(204).end();
    } catch (error: unknown) {
      res.status(500).json({ error: describeError(error) });
    }
  });
}
