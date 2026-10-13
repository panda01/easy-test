import { type JsonResourceState, useJsonResource } from "./useJsonResource";
import { credentialApiUrl, credentialsApiUrl } from "../utils/routePaths";

/**
 * A website credential as the API returns it: everything except the password,
 * which the server never sends back (`hasPassword` only says one is saved).
 * Dates arrive as ISO strings because they travel as JSON. Declared here
 * rather than imported from the server: the client never imports server code.
 */
export interface CredentialRecord {
  id: string;
  websiteId: string;
  /** The user's label for the credential. */
  name: string;
  /** An optional longer note, or null. */
  description: string | null;
  /** What the crawler types into the username field. */
  username: string;
  /** The credential's own login page, or null to use its website's login page. */
  loginUrl: string | null;
  /** A CSS selector for the username field, or null when the crawler finds it. */
  usernameSelector: string | null;
  /** A CSS selector for the password field, or null when the crawler finds it. */
  passwordSelector: string | null;
  /** A CSS selector for the submit button, or null when the crawler finds it. */
  submitSelector: string | null;
  /** Always true: a password is saved (but never sent to the browser). */
  hasPassword: true;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/**
 * The body the client sends to create or replace a credential. On replace an
 * empty `password` keeps the saved one. Blank optional fields are stored as
 * null by the server.
 */
export interface CredentialRequestBody {
  name: string;
  description: string;
  username: string;
  password: string;
  /**
   * The credential's own login page; blank to use the website's. The server
   * refuses a blank one when the website has no login page either.
   */
  loginUrl: string;
  usernameSelector: string;
  passwordSelector: string;
  submitSelector: string;
}

/**
 * Fetches a website's active credentials
 * (`GET /api/websites/:websiteId/credentials`), newest first.
 *
 * `isNeeded` lets a page that only sometimes shows credentials (the shared
 * use case / action forms) call this hook unconditionally: when it is false
 * nothing is fetched and the state stays idle.
 * @param websiteId - The owning website's cuid
 * @param isNeeded - False to skip the request; true (the default) to fetch
 * @returns The loading / error / data state of the credential list
 */
export function useCredentials(
  websiteId: string,
  isNeeded = true,
): JsonResourceState<CredentialRecord[]> {
  const credentialsResource = useJsonResource(isNeeded ? credentialsApiUrl(websiteId) : null);
  // The API is the contract for this shape; see useJsonResource for why the
  // generic hook returns unknown.
  return credentialsResource as JsonResourceState<CredentialRecord[]>;
}

/**
 * Fetches one active credential
 * (`GET /api/websites/:websiteId/credentials/:credentialId`). A deleted or
 * unknown id reports the server's "Credential not found" as `errorMessage`.
 * @param websiteId - The owning website's cuid
 * @param credentialId - The credential's cuid
 * @returns The loading / error / data state of that credential
 */
export function useCredential(
  websiteId: string,
  credentialId: string,
): JsonResourceState<CredentialRecord> {
  const credentialResource = useJsonResource(credentialApiUrl(websiteId, credentialId));
  return credentialResource as JsonResourceState<CredentialRecord>;
}
