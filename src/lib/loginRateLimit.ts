const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 8;
const attempts = new Map<string, number[]>();

export function isLoginRateLimited(key: string): boolean {
  const now = Date.now();
  const timestamps = (attempts.get(key) || []).filter((t) => now - t < WINDOW_MS);
  attempts.set(key, timestamps);
  return timestamps.length >= MAX_ATTEMPTS;
}

export function recordLoginAttempt(key: string): void {
  const timestamps = attempts.get(key) || [];
  timestamps.push(Date.now());
  attempts.set(key, timestamps);
}
