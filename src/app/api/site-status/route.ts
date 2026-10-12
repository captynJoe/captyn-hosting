import { NextRequest } from "next/server";
import { siteDomainOf } from "@/lib/siteDomain";
import { siteIsPaused } from "@/lib/siteStatusCache";

/**
 * nginx auth_request target for gated customer domains: 204 serves the
 * site, 403 serves the paused page. Any failure here serves the site
 * (nginx maps errors to 204), so an outage never takes customers down.
 */
export async function GET(request: NextRequest) {
  const domain = siteDomainOf(request);
  if (!domain) return new Response(null, { status: 204 });
  try {
    return new Response(null, { status: (await siteIsPaused(domain)) ? 403 : 204 });
  } catch (error) {
    console.error("Site status check failed:", { domain, error });
    return new Response(null, { status: 204 });
  }
}
