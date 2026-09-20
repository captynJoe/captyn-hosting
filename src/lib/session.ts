export const SESSION_COOKIE_NAME = "captyn_hosting_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function getSecret(): string {
  const secret = process.env.HOSTING_SESSION_SECRET?.trim();
  if (!secret) {
    throw new Error("HOSTING_SESSION_SECRET is not configured.");
  }
  return secret;
}

async function hmac(value: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function createSessionToken(): Promise<string> {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const signature = await hmac(String(expiresAt), getSecret());
  return `${expiresAt}.${signature}`;
}

export async function isValidSessionToken(token: string | undefined | null): Promise<boolean> {
  if (!token) return false;
  const [expiresAtRaw, signature] = token.split(".");
  if (!expiresAtRaw || !signature) return false;
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;

  const expected = await hmac(expiresAtRaw, getSecret());
  if (expected.length !== signature.length) return false;

  // Constant-time comparison (Web Crypto has no timingSafeEqual; XOR-fold instead).
  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) {
    mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return mismatch === 0;
}

export function checkAdminPassword(candidate: string): boolean {
  const expected = process.env.HOSTING_ADMIN_PASSWORD?.trim();
  if (!expected) return false;
  if (candidate.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) {
    mismatch |= candidate.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}
