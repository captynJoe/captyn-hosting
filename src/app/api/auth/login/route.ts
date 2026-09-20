import { NextRequest, NextResponse } from "next/server";
import { verifyAdminCredentials } from "@/lib/adminAuth";
import { createSessionToken, SESSION_COOKIE_NAME } from "@/lib/session";
import { isLoginRateLimited, recordLoginAttempt } from "@/lib/loginRateLimit";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (isLoginRateLimited(ip) || isLoginRateLimited(email)) {
    return NextResponse.json({ error: "Too many login attempts. Try again later." }, { status: 429 });
  }

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
  }

  const admin = await verifyAdminCredentials(email, password);
  if (!admin) {
    recordLoginAttempt(ip);
    recordLoginAttempt(email);
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  const token = await createSessionToken(admin.id);
  const response = NextResponse.json({ success: true });
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60,
  });
  return response;
}
