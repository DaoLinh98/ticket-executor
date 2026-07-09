import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";

// At-rest encryption for provider secrets (PAT / access token).
// Uses AES-256-GCM with a key derived from SETTINGS_ENC_KEY. If no key is
// configured (e.g. local dev), values are stored as-is so nothing breaks —
// set SETTINGS_ENC_KEY in production to enable encryption.
const PREFIX = "enc:v1:";

function key(): Buffer | null {
  const raw = process.env.SETTINGS_ENC_KEY;
  if (!raw) return null;
  // Accept any-length secret; derive a stable 32-byte key.
  return createHash("sha256").update(raw, "utf8").digest();
}

export function isEncrypted(stored: string | null | undefined): boolean {
  return !!stored && stored.startsWith(PREFIX);
}

export function encryptSecret(plain: string): string {
  if (!plain) return plain;
  const k = key();
  if (!k) return plain; // no key -> store plaintext (dev/local)
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
  if (!k) return ""; // encrypted but no key available
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
