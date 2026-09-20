import bcrypt from "bcrypt";
import { prisma } from "@/lib/prisma";

// A fixed dummy hash so a lookup for a non-existent email takes the same
// time as a real failed password check (mirrors byg-global's own
// admin-login timing-safety measure).
const DUMMY_PASSWORD_HASH = "$2b$10$CwTycUXWue0Thq9StjUM0uJ8OqLdSaU7lArAmr9CDkzKgP2VSVBSK";

export interface AdminUser {
  id: string;
  email: string;
}

/**
 * Verifies against byg-global's real User table (same DB) -- operators
 * sign in with the same email/password they already use for the
 * ecommerce admin, no separate password to manage for this app.
 */
export async function verifyAdminCredentials(
  email: string,
  password: string
): Promise<AdminUser | null> {
  const normalizedEmail = email.trim().toLowerCase();

  const user = await prisma.user.findFirst({
    where: { email: { equals: normalizedEmail, mode: "insensitive" } },
  });

  if (!user) {
    await bcrypt.compare(password, DUMMY_PASSWORD_HASH).catch(() => false);
    return null;
  }

  if (!user.isAdmin || user.status !== "active" || !user.passwordHash) {
    return null;
  }

  const isValidPassword = await bcrypt.compare(password, user.passwordHash);
  if (!isValidPassword) return null;

  return { id: user.id, email: user.email };
}
