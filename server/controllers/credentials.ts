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

/** A credential as the API sends it: never the password, only the fact that one is saved. */
type CredentialResponse = CredentialSummary & {
  /** Always true - every credential has a saved password - so the UI can say so without ever receiving it. */
  hasPassword: true;
};

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
 * is a username and password for one website - the account a Login action
 * logs in as (where and how it logs in belongs to the Login action).
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
 * Deletes are SOFT: `DELETE` stamps `deletedAt` and reads ignore such rows.
 * Crawl runs that used a deleted credential still name it; the actions that
 * ran as it are unlinked from it (they run logged out).
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
   * @param body - JSON `{ name, description?, username, password }`; `name`, `username`, and `password` are required
   * @returns 201 with the created credential (no password); 400 with `{ error }` for an invalid body; 404 with `{ error }` when the website does not exist or was deleted; 503 with `{ error }` when CREDENTIAL_ENCRYPTION_KEY is not configured; 500 with `{ error }` otherwise
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
   * @param body - JSON `{ name, description?, username, password? }`; same rules as POST, except `password` may be left out to keep the saved one
   * @returns 200 with the updated credential (no password); 400 with `{ error }` for an invalid body; 404 with `{ error }` when the website or the credential does not exist or was deleted; 503 with `{ error }` when a new password was sent but CREDENTIAL_ENCRYPTION_KEY is not configured; 500 with `{ error }` otherwise
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
   * keep naming it; the actions that ran as it are unlinked from it (they
   * run logged out until they are given another).
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
