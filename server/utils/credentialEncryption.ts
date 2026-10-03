import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** The environment variable that holds the key, base64 encoded. */
export const CREDENTIAL_ENCRYPTION_KEY_VARIABLE = "CREDENTIAL_ENCRYPTION_KEY";

/** AES-256-GCM: authenticated encryption, so a tampered value fails to decrypt instead of decrypting to garbage. */
const CIPHER_ALGORITHM = "aes-256-gcm";

/** AES-256 needs exactly 32 key bytes (256 bits). */
const KEY_BYTE_LENGTH = 32;

/** GCM's recommended IV size. A fresh random IV is drawn for every encryption. */
const IV_BYTE_LENGTH = 12;

/** GCM's full-length authentication tag. */
const AUTH_TAG_BYTE_LENGTH = 16;

/** Separates the three base64 parts of a stored value. `.` never appears in base64. */
const PART_SEPARATOR = ".";

/**
 * Why a credential password cannot be encrypted or decrypted because the key
 * is missing or malformed. Controllers answer 503 for this (a server
 * configuration problem), the same way a missing `ANTHROPIC_API_KEY` does.
 */
export const CREDENTIAL_KEY_NOT_CONFIGURED_MESSAGE = `${CREDENTIAL_ENCRYPTION_KEY_VARIABLE} is not set in .env.local (or is not 32 bytes of base64), so credential passwords cannot be saved or used`;

/**
 * Reads the credential encryption key from `CREDENTIAL_ENCRYPTION_KEY`.
 *
 * Read on every call (not cached at module load) so the server still boots
 * without it - only the credential features need it - and tests can change
 * it between cases.
 * @returns The 32 key bytes, or null when the variable is missing, blank, not base64, or not exactly 32 bytes long
 */
export function readCredentialEncryptionKey(): Buffer | null {
  const encodedKey = process.env[CREDENTIAL_ENCRYPTION_KEY_VARIABLE]?.trim() ?? "";
  const keyIsBlank = encodedKey === "";
  if (keyIsBlank) {
    return null;
  }
  const keyIsBase64 = /^[A-Za-z0-9+/]+={0,2}$/.test(encodedKey);
  if (!keyIsBase64) {
    return null;
  }
  const keyBytes = Buffer.from(encodedKey, "base64");
  const keyHasTheRightLength = keyBytes.length === KEY_BYTE_LENGTH;
  return keyHasTheRightLength ? keyBytes : null;
}

/**
 * Checks whether credential passwords can be encrypted and decrypted right
 * now, i.e. whether a valid key is configured.
 * @returns True when `CREDENTIAL_ENCRYPTION_KEY` holds 32 bytes of base64
 */
export function credentialEncryptionIsConfigured(): boolean {
  const key = readCredentialEncryptionKey();
  return key !== null;
}

/**
 * Reads the key, or throws the "not configured" error when there is none.
 * @returns The 32 key bytes
 * @throws When no valid key is configured
 */
function requireCredentialEncryptionKey(): Buffer {
  const key = readCredentialEncryptionKey();
  if (key === null) {
    throw new Error(CREDENTIAL_KEY_NOT_CONFIGURED_MESSAGE);
  }
  return key;
}

/**
 * Encrypts a credential password for storage, with AES-256-GCM and a fresh
 * random IV, so encrypting the same password twice gives two different
 * values.
 * @param plainPassword - The password exactly as the user typed it
 * @returns `iv.authTag.ciphertext`, each part base64 - what `Credential.encryptedPassword` stores
 * @throws When no valid key is configured
 */
export function encryptCredentialPassword(plainPassword: string): string {
  const key = requireCredentialEncryptionKey();
  const iv = randomBytes(IV_BYTE_LENGTH);
  const cipher = createCipheriv(CIPHER_ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_BYTE_LENGTH,
  });
  const ciphertext = Buffer.concat([cipher.update(plainPassword, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, ciphertext].map((part) => part.toString("base64")).join(PART_SEPARATOR);
}

/**
 * Decrypts a stored credential password so the crawler can type it.
 * @param encryptedPassword - A value produced by `encryptCredentialPassword`
 * @returns The password exactly as the user typed it
 * @throws When no valid key is configured; when the value is not in the stored format; or when it does not decrypt with this key (the key changed, or the value was altered)
 */
export function decryptCredentialPassword(encryptedPassword: string): string {
  const key = requireCredentialEncryptionKey();
  const parts = encryptedPassword.split(PART_SEPARATOR);
  const valueHasThreeParts = parts.length === 3;
  if (!valueHasThreeParts) {
    throw new Error("The saved password is not in the expected encrypted format");
  }
  const [iv, authTag, ciphertext] = parts.map((part) => Buffer.from(part, "base64"));
  const partsHaveTheRightLengths =
    iv.length === IV_BYTE_LENGTH && authTag.length === AUTH_TAG_BYTE_LENGTH;
  if (!partsHaveTheRightLengths) {
    throw new Error("The saved password is not in the expected encrypted format");
  }
  try {
    const decipher = createDecipheriv(CIPHER_ALGORITHM, key, iv, {
      authTagLength: AUTH_TAG_BYTE_LENGTH,
    });
    decipher.setAuthTag(authTag);
    const plainBytes = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plainBytes.toString("utf8");
  } catch {
    throw new Error(
      `The saved password could not be decrypted - ${CREDENTIAL_ENCRYPTION_KEY_VARIABLE} has probably changed since it was saved. Enter the password again on the credential's edit page.`,
    );
  }
}
