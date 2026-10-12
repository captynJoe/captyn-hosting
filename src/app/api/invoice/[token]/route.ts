import { NextRequest, NextResponse } from "next/server";
import { loadPayState } from "@/lib/payState";
import { startStkPush } from "@/lib/stk";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const state = await loadPayState({ payToken: token }, request.nextUrl.searchParams.get("checkout"));
  if (!state) {
    return NextResponse.json({ error: "This payment link is not valid." }, { status: 404 });
  }
  const { payToken: _payToken, ...publicState } = state;
  return NextResponse.json(publicState);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const body = await request.json().catch(() => ({}));
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
  if (!phone) {
    return NextResponse.json({ error: "Enter the M-Pesa number to pay from." }, { status: 400 });
  }
  const amountKes = Math.round(Number(body?.amountKes)) || undefined;
  const result = await startStkPush({ payToken: token, phone, amountKes });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ success: true, checkoutRequestId: result.checkoutRequestId, amountKes: result.amountKes });
}
