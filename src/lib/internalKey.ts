import { NextRequest } from "next/server";

export function hasValidInternalKey(request: NextRequest): boolean {
  const expected = process.env.HOSTING_AUTOMATION_KEY?.trim();
  if (!expected) return false;
  const presented = request.headers.get("x-internal-key")?.trim() || "";
  if (presented.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) {
    mismatch |= presented.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}
