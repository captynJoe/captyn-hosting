import { isSitePaused } from "@/lib/hostingBilling";

// nginx asks on every request to a gated domain; a short cache keeps that
// to one database read per domain per window. A payment clears the entry.
const TTL_MS = 20_000;
const cache = new Map<string, { paused: boolean; at: number }>();

export async function siteIsPaused(domain: string): Promise<boolean> {
  const hit = cache.get(domain);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.paused;
  const paused = await isSitePaused(domain);
  cache.set(domain, { paused, at: Date.now() });
  return paused;
}

export function forgetSiteStatus(domain: string): void {
  cache.delete(domain);
}
