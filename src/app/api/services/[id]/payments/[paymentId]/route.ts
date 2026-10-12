import { NextRequest, NextResponse } from "next/server";
import { HostingPaymentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { syncService } from "@/lib/hostingBilling";

/** Removes a payment recorded by mistake (kept as failed, with a note). */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; paymentId: string }> }
) {
  const { id, paymentId } = await params;
  try {
    const payment = await prisma.hostingPayment.findFirst({
      where: { id: paymentId, hostingServiceId: id, status: HostingPaymentStatus.completed },
    });
    if (!payment) return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    await prisma.hostingPayment.update({
      where: { id: paymentId },
      data: {
        status: HostingPaymentStatus.failed,
        note: [payment.note, `Removed by admin ${new Date().toISOString().slice(0, 10)}`].filter(Boolean).join(" · "),
      },
    });
    await syncService(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to remove hosting payment:", error);
    return NextResponse.json({ error: "Failed to remove payment" }, { status: 500 });
  }
}
