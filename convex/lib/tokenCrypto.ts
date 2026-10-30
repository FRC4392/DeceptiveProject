// AES-GCM encryption for OAuth tokens at rest (convex/schema.ts's onshapeAuth
// table stores accessToken/refreshToken through this). Key comes from the
// ONSHAPE_TOKEN_ENC_KEY Convex env var — a 32-byte AES-256 key, base64
// encoded. Ciphertext is stored as base64(iv || data) so it still fits a
// single v.string() schema field.

const IV_LENGTH = 12; // bytes, standard for AES-GCM

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++)
    binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function getKey(): Promise<CryptoKey> {
  const raw = process.env.ONSHAPE_TOKEN_ENC_KEY;
  if (!raw) {
    throw new Error(
      "ONSHAPE_TOKEN_ENC_KEY is not set. Generate one with " +
        "`openssl rand -base64 32` and set it via " +
        "`npx convex env set ONSHAPE_TOKEN_ENC_KEY <value>`.",
    );
  }
  return crypto.subtle.importKey(
    "raw",
    base64ToBytes(raw) as BufferSource,
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptToken(plaintext: string): Promise<string> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const data = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    data as BufferSource,
  );
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return bytesToBase64(combined);
}

export async function decryptToken(encoded: string): Promise<string> {
  const key = await getKey();
  const combined = base64ToBytes(encoded);
  const iv = combined.slice(0, IV_LENGTH);
  const ciphertext = combined.slice(IV_LENGTH);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    ciphertext as BufferSource,
  );
  return new TextDecoder().decode(plaintext);
}
