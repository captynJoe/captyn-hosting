import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const invoice = await prisma.hostingInvoice.findUnique({
    where: { payToken: token },
    select: {
      id: true,
      amountKes: true,
      dueDate: true,
      status: true,
      periodStartsAt: true,
      periodEndsAt: true,
      hostingService: {
        select: { customerName: true, domain: true, planName: true },
      },
    },
  });

  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: invoice.id,
    amountKes: invoice.amountKes,
    dueDate: invoice.dueDate,
    status: invoice.status,
    periodStartsAt: invoice.periodStartsAt,
    periodEndsAt: invoice.periodEndsAt,
    customerName: invoice.hostingService.customerName,
    domain: invoice.hostingService.domain,
    planName: invoice.hostingService.planName,
  });
}
