import type { NextRequest } from "next/server";
import { normalizeDomain } from "@/lib/ledger";

/**
 * The customer domain a /site/* request is for. nginx sets X-Hosting-Domain
 * from the matched server_name on the customer's own server block, and
 * clears it on hosting.captyn.shop, so a client can't pick a domain.
 */
export function siteDomainOf(request: NextRequest): string {
  return normalizeDomain(request.headers.get("x-hosting-domain") || "");
}

/** Where /site/* is mounted on a customer domain (see nginx/captyn-hosting-site.conf). */
export const SITE_PATH_PREFIX = "/captyn-hosting";
