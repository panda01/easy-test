import { describe, it, expect, afterEach } from "vitest";
import { randomBytes } from "node:crypto";
import {
  CREDENTIAL_KEY_NOT_CONFIGURED_MESSAGE,
  credentialEncryptionIsConfigured,
  decryptCredentialPassword,
  encryptCredentialPassword,
  readCredentialEncryptionKey,
} from "../../../server/utils/credentialEncryption.js";

/** The key in the environment before this spec ran, restored after each test. */
const originalEncryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY;

/** A valid key: 32 random bytes, base64 encoded. */
const VALID_KEY = randomBytes(32).toString("base64");

/** A second valid key, to prove a value only decrypts with the key it was encrypted with. */
const OTHER_VALID_KEY = randomBytes(32).toString("base64");

afterEach(() => {
  if (originalEncryptionKey === undefined) {
    delete process.env.CREDENTIAL_ENCRYPTION_KEY;
  } else {
    process.env.CREDENTIAL_ENCRYPTION_KEY = originalEncryptionKey;
  }
});

describe("readCredentialEncryptionKey", () => {
  it("returns the 32 key bytes for a valid base64 key, ignoring surrounding whitespace", () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = `  ${VALID_KEY}\n`;

    const key = readCredentialEncryptionKey();

    expect(key).toEqual(Buffer.from(VALID_KEY, "base64"));
    expect(credentialEncryptionIsConfigured()).toBe(true);
  });

  it.each([
    { label: "missing", value: undefined },
    { label: "blank", value: "   " },
    { label: "not base64", value: "this is not base64!!" },
    { label: "16 bytes instead of 32", value: randomBytes(16).toString("base64") },
    { label: "64 bytes instead of 32", value: randomBytes(64).toString("base64") },
  ])("returns null when the key is $label", ({ value }) => {
    if (value === undefined) {
      delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    } else {
      process.env.CREDENTIAL_ENCRYPTION_KEY = value;
    }

    expect(readCredentialEncryptionKey()).toBeNull();
    expect(credentialEncryptionIsConfigured()).toBe(false);
  });
});

describe("encryptCredentialPassword / decryptCredentialPassword", () => {
  it("round-trips a password exactly, spaces and non-ASCII characters included", () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = VALID_KEY;
    const password = "  correct horse 🐴 battery staple ü  ";

    const encryptedPassword = encryptCredentialPassword(password);

    expect(decryptCredentialPassword(encryptedPassword)).toBe(password);
  });

  it("stores three base64 parts and never the password itself", () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = VALID_KEY;

    const encryptedPassword = encryptCredentialPassword("correct horse");

    expect(encryptedPassword).not.toContain("correct horse");
    const parts = encryptedPassword.split(".");
    expect(parts).toHaveLength(3);
    const [iv, authTag] = parts.map((part) => Buffer.from(part, "base64"));
    expect(iv).toHaveLength(12);
    expect(authTag).toHaveLength(16);
  });

  it("gives a different value each time, because every encryption draws a fresh IV", () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = VALID_KEY;

    const first = encryptCredentialPassword("same password");
    const second = encryptCredentialPassword("same password");

    expect(first).not.toBe(second);
    expect(decryptCredentialPassword(first)).toBe("same password");
    expect(decryptCredentialPassword(second)).toBe("same password");
  });

  it("refuses to encrypt when no valid key is configured", () => {
    delete process.env.CREDENTIAL_ENCRYPTION_KEY;

    expect(() => encryptCredentialPassword("correct horse")).toThrow(
      CREDENTIAL_KEY_NOT_CONFIGURED_MESSAGE,
    );
  });

  it("refuses to decrypt when no valid key is configured", () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = VALID_KEY;
    const encryptedPassword = encryptCredentialPassword("correct horse");
    process.env.CREDENTIAL_ENCRYPTION_KEY = "";

    expect(() => decryptCredentialPassword(encryptedPassword)).toThrow(
      CREDENTIAL_KEY_NOT_CONFIGURED_MESSAGE,
    );
  });

  it("fails to decrypt with a different key, saying the key probably changed", () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = VALID_KEY;
    const encryptedPassword = encryptCredentialPassword("correct horse");
    process.env.CREDENTIAL_ENCRYPTION_KEY = OTHER_VALID_KEY;

    expect(() => decryptCredentialPassword(encryptedPassword)).toThrow(
      /could not be decrypted - CREDENTIAL_ENCRYPTION_KEY has probably changed/,
    );
  });

  it("fails to decrypt a value whose ciphertext was altered, because GCM authenticates it", () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = VALID_KEY;
    const [iv, authTag, ciphertext] = encryptCredentialPassword("correct horse").split(".");
    const ciphertextBytes = Buffer.from(ciphertext, "base64");
    ciphertextBytes[0] = ciphertextBytes[0] ^ 0xff;
    const alteredValue = [iv, authTag, ciphertextBytes.toString("base64")].join(".");

    expect(() => decryptCredentialPassword(alteredValue)).toThrow(/could not be decrypted/);
  });

  it.each([
    { label: "has only two parts", value: "aaaa.bbbb" },
    { label: "has four parts", value: "aaaa.bbbb.cccc.dddd" },
    { label: "has an IV of the wrong length", value: `${Buffer.alloc(8).toString("base64")}.${Buffer.alloc(16).toString("base64")}.abcd` },
    { label: "has an auth tag of the wrong length", value: `${Buffer.alloc(12).toString("base64")}.${Buffer.alloc(4).toString("base64")}.abcd` },
  ])("rejects a stored value that $label", ({ value }) => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = VALID_KEY;

    expect(() => decryptCredentialPassword(value)).toThrow(
      "The saved password is not in the expected encrypted format",
    );
  });
});
