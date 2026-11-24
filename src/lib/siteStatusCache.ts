import { isSitePaused } from "@/lib/hostingBilling";

// nginx asks on every request to a gated domain and gives up after 3s (then
// serves the site). The answer is cached per domain; once it is older than
// TTL_MS the last answer is still returned at once while one read refreshes
// it in the background, so a visitor never waits on the database -- waiting
// made nginx time out several times a day, each costing that visitor 3s.
// A pause or a payment still takes effect within about TTL_MS; a payment also
// clears the entry (forgetSiteStatus) so the site reopens straight away.
const TTL_MS = 20_000;
// Past this, don't trust a stale answer: read the database before replying.
const MAX_STALE_MS = 10 * 60_000;
const cache = new Map<string, { paused: boolean; at: number }>();
const refreshing = new Map<string, Promise<boolean>>();

function refresh(domain: string): Promise<boolean> {
  let pending = refreshing.get(domain);
  if (!pending) {
    pending = isSitePaused(domain)
      .then((paused) => {
        cache.set(domain, { paused, at: Date.now() });
        return paused;
      })
      .finally(() => {
        refreshing.delete(domain);
      });
    refreshing.set(domain, pending);
  }
  return pending;
}

export async function siteIsPaused(domain: string): Promise<boolean> {
  const hit = cache.get(domain);
  const age = hit ? Date.now() - hit.at : Number.POSITIVE_INFINITY;
  if (hit && age < TTL_MS) return hit.paused;
  if (hit && age < MAX_STALE_MS) {
    void refresh(domain).catch((error) => console.error("Site status refresh failed:", { domain, error }));
    return hit.paused;
  }
  return refresh(domain);
}

export function forgetSiteStatus(domain: string): void {
  cache.delete(domain);
}
