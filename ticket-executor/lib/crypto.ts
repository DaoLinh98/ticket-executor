import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";

// At-rest encryption for provider secrets (PAT / access token).
// Uses AES-256-GCM. Tokens are ALWAYS encrypted before hitting the DB: the key
// comes from SETTINGS_ENC_KEY, falling back to DATABASE_URL (env-only, never in
// the repo) and finally to a local-dev constant. Set SETTINGS_ENC_KEY in
// production — changing the key invalidates stored tokens, which then read back
// as empty and have to be re-entered in Settings.
const PREFIX = "enc:v1:";
const DEV_KEY = "ticket-executor-local-dev";

function key(): Buffer {
  const raw = process.env.SETTINGS_ENC_KEY || process.env.DATABASE_URL || DEV_KEY;
  // Accept any-length secret; derive a stable 32-byte key.
  return createHash("sha256").update(raw, "utf8").digest();
}

export function isEncrypted(stored: string | null | undefined): boolean {
  return !!stored && stored.startsWith(PREFIX);
}

export function encryptSecret(plain: string): string {
  if (!plain) return plain;
  const k = key();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + [iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":");
}

export function decryptSecret(stored: string | null | undefined): string {
  if (!stored) return "";
  if (!stored.startsWith(PREFIX)) return stored; // legacy plaintext
  const k = key();
  try {
    const [ivb, tagb, ctb] = stored.slice(PREFIX.length).split(":");
    const decipher = createDecipheriv("aes-256-gcm", k, Buffer.from(ivb, "base64"));
    decipher.setAuthTag(Buffer.from(tagb, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(ctb, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return "";
  }
}
