import { NextRequest } from "next/server";
import { loadPayState } from "@/lib/payState";
import { renderNotFoundPage, renderPayPage } from "@/lib/payPage";

const HTML_HEADERS = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" };

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const state = await loadPayState({ payToken: token });
  if (!state) return new Response(renderNotFoundPage(), { status: 404, headers: HTML_HEADERS });
  return new Response(renderPayPage(state, `/api/invoice/${encodeURIComponent(token)}`), { headers: HTML_HEADERS });
}
