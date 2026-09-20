import { NextRequest, NextResponse } from "next/server";
import { HostingInvoiceStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { generateHostingPaymentReceivedEmail } from "@/lib/emailTemplates";
import { sendEmail } from "@/lib/email";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; invoiceId: string }> }
) {
  const { id, invoiceId } = await params;

  try {
    const body = await request.json().catch(() => ({}));
    const note = typeof body?.note === "string" ? body.note.trim() : null;

    const invoice = await prisma.hostingInvoice.findFirst({
      where: { id: invoiceId, hostingServiceId: id },
      include: { hostingService: { select: { customerName: true, customerEmail: true, domain: true } } },
    });
    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }
    if (invoice.status === HostingInvoiceStatus.paid) {
      return NextResponse.json({ error: "Invoice is already paid" }, { status: 409 });
    }

    const updated = await prisma.hostingInvoice.update({
      where: { id: invoiceId },
      data: {
        status: HostingInvoiceStatus.paid,
        paidAt: new Date(),
        metadata: {
          ...(typeof invoice.metadata === "object" && invoice.metadata ? invoice.metadata : {}),
          manualSettlement: { markedAt: new Date().toISOString(), note },
        },
      },
    });

    const { subject, html, text } = generateHostingPaymentReceivedEmail({
      customerName: invoice.hostingService.customerName,
      domain: invoice.hostingService.domain,
      amountKes: invoice.amountKes,
      note,
    });
    const sent = await sendEmail({ to: invoice.hostingService.customerEmail, subject, html, text });
    if (!sent) {
      console.error("Failed to send manual payment receipt email:", { invoiceId });
    }

    return NextResponse.json({ success: true, invoice: updated });
  } catch (error) {
    console.error("Failed to mark hosting invoice paid:", error);
    return NextResponse.json({ error: "Failed to mark hosting invoice paid" }, { status: 500 });
  }
}
