import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { readAmount, recordManualPayment } from "@/lib/serviceView";

/** Money received outside the pay link (cash, bank, M-Pesa to a till). */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await request.json().catch(() => ({}));
    const amountKes = readAmount(body?.amountKes);
    if (!amountKes) {
      return NextResponse.json({ error: "Enter the amount received" }, { status: 400 });
    }
    const paidAt = typeof body?.paidAt === "string" && body.paidAt ? new Date(body.paidAt) : null;
    if (paidAt && (Number.isNaN(paidAt.getTime()) || paidAt.getTime() > Date.now() + 60_000)) {
      return NextResponse.json({ error: "Payment date can't be in the future" }, { status: 400 });
    }

    const service = await prisma.hostingService.findUnique({ where: { id }, select: { id: true } });
    if (!service) {
      return NextResponse.json({ error: "Hosting service not found" }, { status: 404 });
    }

    const { payment, synced } = await recordManualPayment({
      serviceId: id,
      amountKes,
      note: typeof body?.note === "string" ? body.note.trim() : null,
      receipt: typeof body?.receipt === "string" ? body.receipt.trim().toUpperCase() : null,
      paidAt,
      emailReceipt: body?.emailReceipt !== false,
    });

    return NextResponse.json({ success: true, paymentId: payment.id, balanceKes: synced?.ledger.balanceKes ?? null });
  } catch (error) {
    console.error("Failed to record hosting payment:", error);
    return NextResponse.json({ error: "Failed to record payment" }, { status: 500 });
  }
}
