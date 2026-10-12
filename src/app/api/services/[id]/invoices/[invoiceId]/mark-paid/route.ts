import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadServiceLedger } from "@/lib/hostingBilling";
import { recordManualPayment } from "@/lib/serviceView";

/** Records a manual payment covering what is still open on one invoice. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; invoiceId: string }> }
) {
  const { id, invoiceId } = await params;

  try {
    const body = await request.json().catch(() => ({}));
    const invoice = await prisma.hostingInvoice.findFirst({ where: { id: invoiceId, hostingServiceId: id }, select: { id: true } });
    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }
    const loaded = await loadServiceLedger(id);
    // Payments settle oldest first, so covering this invoice means covering
    // everything open up to and including it.
    let amountKes = 0;
    for (const row of loaded?.ledger.invoices || []) {
      amountKes += row.openKes;
      if (row.id === invoiceId) break;
    }
    if (amountKes <= 0) {
      return NextResponse.json({ error: "Invoice is already paid" }, { status: 409 });
    }

    const { payment } = await recordManualPayment({
      serviceId: id,
      amountKes: Math.round(amountKes),
      note: typeof body?.note === "string" ? body.note.trim() : null,
      emailReceipt: true,
    });
    return NextResponse.json({ success: true, paymentId: payment.id });
  } catch (error) {
    console.error("Failed to mark hosting invoice paid:", error);
    return NextResponse.json({ error: "Failed to mark hosting invoice paid" }, { status: 500 });
  }
}
