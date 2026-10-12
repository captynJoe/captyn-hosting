import { NextRequest } from "next/server";
import { renderPausedPage } from "@/lib/payPage";
import { SITE_PATH_PREFIX, siteDomainOf } from "@/lib/siteDomain";

/** nginx serves this for every URL on a paused customer domain. */
function paused(request: NextRequest) {
  const domain = siteDomainOf(request) || "This site";
  return new Response(renderPausedPage(domain, `${SITE_PATH_PREFIX}/pay`), {
    status: 503,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Retry-After": "3600" },
  });
}

export const GET = paused;
export const HEAD = paused;
export const POST = paused;
export const PUT = paused;
export const PATCH = paused;
export const DELETE = paused;
