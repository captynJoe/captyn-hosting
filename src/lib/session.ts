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

function timingSafeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function createSessionToken(adminUserId: string): Promise<string> {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const payload = `${adminUserId}.${expiresAt}`;
  const signature = await hmac(payload, getSecret());
  return `${payload}.${signature}`;
}

export async function readSession(
  token: string | undefined | null
): Promise<{ adminUserId: string } | null> {
  if (!token) return null;
  const [adminUserId, expiresAtRaw, signature] = token.split(".");
  if (!adminUserId || !expiresAtRaw || !signature) return null;
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return null;

  const expected = await hmac(`${adminUserId}.${expiresAtRaw}`, getSecret());
  // Web Crypto has no timingSafeEqual; XOR-fold comparison instead.
  if (!timingSafeStringEqual(expected, signature)) return null;

  return { adminUserId };
}

export async function isValidSessionToken(token: string | undefined | null): Promise<boolean> {
  return (await readSession(token)) !== null;
}
