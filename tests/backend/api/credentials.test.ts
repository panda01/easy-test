import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import { randomBytes } from "node:crypto";

/** One mock per dbService function the credential controller imports. */
const mockDbService = vi.hoisted(() => ({
  findWebsiteById: vi.fn(),
  listCredentialsForWebsite: vi.fn(),
  findCredentialForWebsite: vi.fn(),
  createCredentialForWebsite: vi.fn(),
  updateCredentialForWebsite: vi.fn(),
  softDeleteCredentialForWebsite: vi.fn(),
}));

// The real dbService builds a PrismaClient at load time; this spec is about
// the HTTP contract of the routes, so the whole service is replaced. The
// encryption is NOT replaced: each test sets a real key, so the stored value
// can be decrypted and compared.
vi.mock("../../../server/services/dbService.js", () => mockDbService);

import { registerCredentialRoutes } from "../../../server/controllers/credentials.js";
import {
  CREDENTIAL_KEY_NOT_CONFIGURED_MESSAGE,
  decryptCredentialPassword,
} from "../../../server/utils/credentialEncryption.js";

/**
 * Builds a minimal app carrying only the credential routes, mounted the same
 * way server.ts mounts them (JSON body parsing first).
 * @returns An app with JSON body parsing and the credential routes registered
 */
function createCredentialApp(): Express {
  const app = express();
  app.use(express.json());
  registerCredentialRoutes(app);
  return app;
}

const WEBSITE_NOT_FOUND_MESSAGE = "Website not found";
const CREDENTIAL_NOT_FOUND_MESSAGE = "Credential not found";
const NO_LOGIN_URL_ANYWHERE_MESSAGE =
  "A login page URL is required - this website doesn't have one yet";

/** The key in the environment before this spec ran, restored after each test. */
const originalEncryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY;

// The ids in the request path and the ids on the rows the lookups return are
// deliberately different, so each test can prove the later queries use the
// FOUND website's id, not the raw path parameter.
const REQUESTED_WEBSITE_ID = "website-id-from-path";
const REQUESTED_CREDENTIAL_ID = "credential-id-from-path";
const foundWebsite = {
  id: "website-id-from-db",
  url: "https://example.com/",
  name: "Example",
  description: null,
  networkIdleTimeoutMs: 5000,
  screenshotMinimumWaitMs: 1,
  /** No login URL of its own: a credential must bring one (the other tests send one). */
  loginUrl: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
};

/** The same website, with a login page its credentials inherit. */
const websiteWithLoginUrl = { ...foundWebsite, loginUrl: "https://example.com/sign-in" };

const CREDENTIALS_PATH = `/api/websites/${REQUESTED_WEBSITE_ID}/credentials`;
const CREDENTIAL_PATH = `${CREDENTIALS_PATH}/${REQUESTED_CREDENTIAL_ID}`;

/** A credential as dbService returns it: never with its encrypted password. */
const savedCredential = {
  id: "credential-id-from-db",
  websiteId: foundWebsite.id,
  name: "Admin",
  description: "The admin account",
  username: "admin@example.com",
  loginUrl: "https://example.com/login",
  usernameSelector: null,
  passwordSelector: null,
  submitSelector: null,
  createdAt: "2026-01-02T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  deletedAt: null,
};

/** The credential as the API answers with it. */
const credentialResponse = { ...savedCredential, hasPassword: true };

/** A valid create body without a login URL of its own (it inherits the website's). */
const createBodyWithoutLoginUrl = {
  name: "Admin",
  description: "The admin account",
  username: "admin@example.com",
  password: "correct horse",
};

/** A valid create body. */
const createBody = { ...createBodyWithoutLoginUrl, loginUrl: "https://example.com/login" };

/** The fields dbService receives for `createBody`, password excluded. */
const expectedCredentialInput = {
  name: "Admin",
  description: "The admin account",
  username: "admin@example.com",
  loginUrl: "https://example.com/login",
  usernameSelector: null,
  passwordSelector: null,
  submitSelector: null,
};

/**
 * Asserts that a response body carries no password in any form.
 * @param responseBody - The parsed response body
 */
function expectNoPasswordIn(responseBody: unknown): void {
  const responseText = JSON.stringify(responseBody);
  expect(responseText).not.toContain("correct horse");
  expect(responseText).not.toContain("encryptedPassword");
  expect(responseText).not.toMatch(/"password"/);
}

/**
 * Reads the encrypted password the controller handed to a dbService mock.
 * @param dbServiceMock - `createCredentialForWebsite` or `updateCredentialForWebsite`
 * @param argumentIndex - Where the encrypted password is in the call's arguments
 * @returns The encrypted password that was passed
 */
function readEncryptedPasswordPassedTo(
  dbServiceMock: typeof mockDbService.createCredentialForWebsite,
  argumentIndex: number,
): unknown {
  const callArguments = dbServiceMock.mock.calls[0] as unknown[];
  return callArguments[argumentIndex];
}

describe("Credential routes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    mockDbService.findWebsiteById.mockResolvedValue(foundWebsite);
  });

  afterEach(() => {
    if (originalEncryptionKey === undefined) {
      delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    } else {
      process.env.CREDENTIAL_ENCRYPTION_KEY = originalEncryptionKey;
    }
  });

  describe("GET /api/websites/:websiteId/credentials", () => {
    it("returns 200 with the found website's credentials, marked hasPassword and without passwords", async () => {
      mockDbService.listCredentialsForWebsite.mockResolvedValue([savedCredential]);

      const res = await request(createCredentialApp()).get(CREDENTIALS_PATH);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([credentialResponse]);
      expectNoPasswordIn(res.body);
      expect(mockDbService.findWebsiteById).toHaveBeenCalledWith(REQUESTED_WEBSITE_ID);
      expect(mockDbService.listCredentialsForWebsite).toHaveBeenCalledWith(foundWebsite.id);
    });

    it("works without an encryption key, since nothing is encrypted or decrypted", async () => {
      delete process.env.CREDENTIAL_ENCRYPTION_KEY;
      mockDbService.listCredentialsForWebsite.mockResolvedValue([]);

      const res = await request(createCredentialApp()).get(CREDENTIALS_PATH);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("returns 404 Website not found when the website does not exist or was deleted", async () => {
      mockDbService.findWebsiteById.mockResolvedValue(null);

      const res = await request(createCredentialApp()).get(CREDENTIALS_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: WEBSITE_NOT_FOUND_MESSAGE });
      expect(mockDbService.listCredentialsForWebsite).not.toHaveBeenCalled();
    });

    it("returns 500 with the error message when a query fails", async () => {
      mockDbService.listCredentialsForWebsite.mockRejectedValue(new Error("connection lost"));

      const res = await request(createCredentialApp()).get(CREDENTIALS_PATH);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "connection lost" });
    });
  });

  describe("POST /api/websites/:websiteId/credentials", () => {
    it("encrypts the password, stores the credential under the found website, and answers 201 without the password", async () => {
      mockDbService.createCredentialForWebsite.mockResolvedValue(savedCredential);

      const res = await request(createCredentialApp()).post(CREDENTIALS_PATH).send(createBody);

      expect(res.status).toBe(201);
      expect(res.body).toEqual(credentialResponse);
      expectNoPasswordIn(res.body);
      expect(mockDbService.createCredentialForWebsite).toHaveBeenCalledWith(
        foundWebsite.id,
        expectedCredentialInput,
        expect.any(String),
      );
      const encryptedPassword = readEncryptedPasswordPassedTo(
        mockDbService.createCredentialForWebsite,
        2,
      );
      expect(encryptedPassword).not.toContain("correct horse");
      expect(decryptCredentialPassword(String(encryptedPassword))).toBe("correct horse");
    });

    it("returns 400 for an invalid body and saves nothing", async () => {
      const res = await request(createCredentialApp())
        .post(CREDENTIALS_PATH)
        .send({ ...createBody, password: "" });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "A password is required" });
      expect(mockDbService.findWebsiteById).not.toHaveBeenCalled();
      expect(mockDbService.createCredentialForWebsite).not.toHaveBeenCalled();
    });

    it("saves a credential's own login URL on a website that has none", async () => {
      mockDbService.createCredentialForWebsite.mockResolvedValue(savedCredential);

      const res = await request(createCredentialApp()).post(CREDENTIALS_PATH).send(createBody);

      expect(res.status).toBe(201);
      expect(mockDbService.createCredentialForWebsite).toHaveBeenCalledWith(
        foundWebsite.id,
        expect.objectContaining({ loginUrl: "https://example.com/login" }),
        expect.any(String),
      );
    });

    it.each([
      ["left out", undefined],
      ["null", null],
      ["blank", "   "],
    ])(
      "saves the login URL as null (inherit the website's) when it is %s and the website has one",
      async (_label, loginUrl) => {
        mockDbService.findWebsiteById.mockResolvedValue(websiteWithLoginUrl);
        const inheritingCredential = { ...savedCredential, loginUrl: null };
        mockDbService.createCredentialForWebsite.mockResolvedValue(inheritingCredential);

        const res = await request(createCredentialApp())
          .post(CREDENTIALS_PATH)
          .send({ ...createBodyWithoutLoginUrl, loginUrl });

        expect(res.status).toBe(201);
        expect(res.body).toEqual({ ...inheritingCredential, hasPassword: true });
        expect(mockDbService.createCredentialForWebsite).toHaveBeenCalledWith(
          foundWebsite.id,
          { ...expectedCredentialInput, loginUrl: null },
          expect.any(String),
        );
      },
    );

    it("returns 400 and saves nothing when neither the body nor the website has a login URL", async () => {
      const res = await request(createCredentialApp())
        .post(CREDENTIALS_PATH)
        .send(createBodyWithoutLoginUrl);

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: NO_LOGIN_URL_ANYWHERE_MESSAGE });
      expect(mockDbService.findWebsiteById).toHaveBeenCalledWith(REQUESTED_WEBSITE_ID);
      expect(mockDbService.createCredentialForWebsite).not.toHaveBeenCalled();
    });

    it("returns 404 Website not found when the website does not exist or was deleted", async () => {
      mockDbService.findWebsiteById.mockResolvedValue(null);

      const res = await request(createCredentialApp()).post(CREDENTIALS_PATH).send(createBody);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: WEBSITE_NOT_FOUND_MESSAGE });
      expect(mockDbService.createCredentialForWebsite).not.toHaveBeenCalled();
    });

    it("returns 503 and saves nothing when CREDENTIAL_ENCRYPTION_KEY is not configured", async () => {
      delete process.env.CREDENTIAL_ENCRYPTION_KEY;

      const res = await request(createCredentialApp()).post(CREDENTIALS_PATH).send(createBody);

      expect(res.status).toBe(503);
      expect(res.body).toEqual({ error: CREDENTIAL_KEY_NOT_CONFIGURED_MESSAGE });
      expect(mockDbService.createCredentialForWebsite).not.toHaveBeenCalled();
    });

    it("returns 500 with the error message when the insert fails", async () => {
      mockDbService.createCredentialForWebsite.mockRejectedValue(new Error("connection refused"));

      const res = await request(createCredentialApp()).post(CREDENTIALS_PATH).send(createBody);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "connection refused" });
    });
  });

  describe("GET /api/websites/:websiteId/credentials/:credentialId", () => {
    it("returns 200 with the credential, looked up under the found website, without its password", async () => {
      mockDbService.findCredentialForWebsite.mockResolvedValue(savedCredential);

      const res = await request(createCredentialApp()).get(CREDENTIAL_PATH);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(credentialResponse);
      expectNoPasswordIn(res.body);
      expect(mockDbService.findCredentialForWebsite).toHaveBeenCalledWith(
        foundWebsite.id,
        REQUESTED_CREDENTIAL_ID,
      );
    });

    it("returns 404 Website not found when the website does not exist or was deleted", async () => {
      mockDbService.findWebsiteById.mockResolvedValue(null);

      const res = await request(createCredentialApp()).get(CREDENTIAL_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: WEBSITE_NOT_FOUND_MESSAGE });
      expect(mockDbService.findCredentialForWebsite).not.toHaveBeenCalled();
    });

    it("returns 404 Credential not found when the credential does not exist or was deleted", async () => {
      mockDbService.findCredentialForWebsite.mockResolvedValue(null);

      const res = await request(createCredentialApp()).get(CREDENTIAL_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: CREDENTIAL_NOT_FOUND_MESSAGE });
    });

    it("returns 500 with the error message when a query fails", async () => {
      mockDbService.findCredentialForWebsite.mockRejectedValue(new Error("connection lost"));

      const res = await request(createCredentialApp()).get(CREDENTIAL_PATH);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "connection lost" });
    });
  });

  describe("PUT /api/websites/:websiteId/credentials/:credentialId", () => {
    it("replaces the fields and keeps the saved password when none is sent", async () => {
      mockDbService.updateCredentialForWebsite.mockResolvedValue(savedCredential);
      const { password: _password, ...bodyWithoutPassword } = createBody;

      const res = await request(createCredentialApp())
        .put(CREDENTIAL_PATH)
        .send(bodyWithoutPassword);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(credentialResponse);
      expect(mockDbService.updateCredentialForWebsite).toHaveBeenCalledWith(
        foundWebsite.id,
        REQUESTED_CREDENTIAL_ID,
        expectedCredentialInput,
        null,
      );
    });

    it("keeps the saved password without needing the encryption key", async () => {
      delete process.env.CREDENTIAL_ENCRYPTION_KEY;
      mockDbService.updateCredentialForWebsite.mockResolvedValue(savedCredential);

      const res = await request(createCredentialApp())
        .put(CREDENTIAL_PATH)
        .send({ ...createBody, password: "" });

      expect(res.status).toBe(200);
      expect(mockDbService.updateCredentialForWebsite).toHaveBeenCalledWith(
        foundWebsite.id,
        REQUESTED_CREDENTIAL_ID,
        expectedCredentialInput,
        null,
      );
    });

    it("encrypts and replaces the password when a new one is sent, answering without it", async () => {
      mockDbService.updateCredentialForWebsite.mockResolvedValue(savedCredential);

      const res = await request(createCredentialApp())
        .put(CREDENTIAL_PATH)
        .send({ ...createBody, password: "new password" });

      expect(res.status).toBe(200);
      expectNoPasswordIn(res.body);
      const encryptedPassword = readEncryptedPasswordPassedTo(
        mockDbService.updateCredentialForWebsite,
        3,
      );
      expect(decryptCredentialPassword(String(encryptedPassword))).toBe("new password");
    });

    it("returns 503 and saves nothing when a new password is sent but the key is not configured", async () => {
      delete process.env.CREDENTIAL_ENCRYPTION_KEY;

      const res = await request(createCredentialApp())
        .put(CREDENTIAL_PATH)
        .send({ ...createBody, password: "new password" });

      expect(res.status).toBe(503);
      expect(res.body).toEqual({ error: CREDENTIAL_KEY_NOT_CONFIGURED_MESSAGE });
      expect(mockDbService.updateCredentialForWebsite).not.toHaveBeenCalled();
    });

    it("returns 400 for an invalid body and saves nothing", async () => {
      const res = await request(createCredentialApp())
        .put(CREDENTIAL_PATH)
        .send({ ...createBody, loginUrl: "not a url" });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: "The login page URL must be a valid http:// or https:// address",
      });
      expect(mockDbService.updateCredentialForWebsite).not.toHaveBeenCalled();
    });

    it("clears the credential's own login URL, so it inherits the website's, when the body leaves it blank", async () => {
      mockDbService.findWebsiteById.mockResolvedValue(websiteWithLoginUrl);
      const inheritingCredential = { ...savedCredential, loginUrl: null };
      mockDbService.updateCredentialForWebsite.mockResolvedValue(inheritingCredential);

      const res = await request(createCredentialApp())
        .put(CREDENTIAL_PATH)
        .send({ ...createBodyWithoutLoginUrl, password: "", loginUrl: "" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ...inheritingCredential, hasPassword: true });
      expect(mockDbService.updateCredentialForWebsite).toHaveBeenCalledWith(
        foundWebsite.id,
        REQUESTED_CREDENTIAL_ID,
        { ...expectedCredentialInput, loginUrl: null },
        null,
      );
    });

    it("returns 400 and saves nothing when neither the body nor the website has a login URL", async () => {
      const res = await request(createCredentialApp())
        .put(CREDENTIAL_PATH)
        .send(createBodyWithoutLoginUrl);

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: NO_LOGIN_URL_ANYWHERE_MESSAGE });
      expect(mockDbService.updateCredentialForWebsite).not.toHaveBeenCalled();
    });

    it("returns 404 Website not found when the website does not exist or was deleted", async () => {
      mockDbService.findWebsiteById.mockResolvedValue(null);

      const res = await request(createCredentialApp()).put(CREDENTIAL_PATH).send(createBody);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: WEBSITE_NOT_FOUND_MESSAGE });
      expect(mockDbService.updateCredentialForWebsite).not.toHaveBeenCalled();
    });

    it("returns 404 Credential not found when no active credential matched", async () => {
      mockDbService.updateCredentialForWebsite.mockResolvedValue(null);

      const res = await request(createCredentialApp()).put(CREDENTIAL_PATH).send(createBody);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: CREDENTIAL_NOT_FOUND_MESSAGE });
    });

    it("returns 500 with the error message when the update fails", async () => {
      mockDbService.updateCredentialForWebsite.mockRejectedValue(new Error("deadlock detected"));

      const res = await request(createCredentialApp()).put(CREDENTIAL_PATH).send(createBody);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "deadlock detected" });
    });
  });

  describe("DELETE /api/websites/:websiteId/credentials/:credentialId", () => {
    it("soft deletes the credential under the found website and answers 204", async () => {
      mockDbService.softDeleteCredentialForWebsite.mockResolvedValue(true);

      const res = await request(createCredentialApp()).delete(CREDENTIAL_PATH);

      expect(res.status).toBe(204);
      expect(res.body).toEqual({});
      expect(mockDbService.softDeleteCredentialForWebsite).toHaveBeenCalledWith(
        foundWebsite.id,
        REQUESTED_CREDENTIAL_ID,
      );
    });

    it("returns 404 Website not found when the website does not exist or was deleted", async () => {
      mockDbService.findWebsiteById.mockResolvedValue(null);

      const res = await request(createCredentialApp()).delete(CREDENTIAL_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: WEBSITE_NOT_FOUND_MESSAGE });
      expect(mockDbService.softDeleteCredentialForWebsite).not.toHaveBeenCalled();
    });

    it("returns 404 Credential not found when no active credential matched", async () => {
      mockDbService.softDeleteCredentialForWebsite.mockResolvedValue(false);

      const res = await request(createCredentialApp()).delete(CREDENTIAL_PATH);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: CREDENTIAL_NOT_FOUND_MESSAGE });
    });

    it("returns 500 with the error message when the update fails", async () => {
      mockDbService.softDeleteCredentialForWebsite.mockRejectedValue(new Error("connection lost"));

      const res = await request(createCredentialApp()).delete(CREDENTIAL_PATH);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: "connection lost" });
    });
  });
});
