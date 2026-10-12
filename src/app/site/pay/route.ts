import { NextRequest } from "next/server";
import { loadPayState } from "@/lib/payState";
import { renderNotFoundPage, renderPayPage } from "@/lib/payPage";
import { SITE_PATH_PREFIX, siteDomainOf } from "@/lib/siteDomain";

const HTML_HEADERS = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" };

/** https://<customer domain>/captyn-hosting/pay */
export async function GET(request: NextRequest) {
  const domain = siteDomainOf(request);
  const state = domain ? await loadPayState({ domain }) : null;
  if (!state) return new Response(renderNotFoundPage(), { status: 404, headers: HTML_HEADERS });
  return new Response(renderPayPage(state, `${SITE_PATH_PREFIX}/api/pay`, `https://${domain}/`), { headers: HTML_HEADERS });
}
