import { NextRequest, NextResponse } from "next/server";
import { loadPayState } from "@/lib/payState";
import { startStkPush } from "@/lib/stk";
import { siteDomainOf } from "@/lib/siteDomain";
import { forgetSiteStatus } from "@/lib/siteStatusCache";

export async function GET(request: NextRequest) {
  const domain = siteDomainOf(request);
  const state = domain ? await loadPayState({ domain }, request.nextUrl.searchParams.get("checkout")) : null;
  if (!state) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (state.payment === "completed") forgetSiteStatus(domain);
  const { payToken: _payToken, ...publicState } = state;
  return NextResponse.json(publicState, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const domain = siteDomainOf(request);
  const state = domain ? await loadPayState({ domain }) : null;
  if (!state?.payToken) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
  if (!phone) return NextResponse.json({ error: "Enter the M-Pesa number to pay from." }, { status: 400 });
  const result = await startStkPush({
    payToken: state.payToken,
    phone,
    amountKes: Math.round(Number(body?.amountKes)) || undefined,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ success: true, checkoutRequestId: result.checkoutRequestId, amountKes: result.amountKes });
}
