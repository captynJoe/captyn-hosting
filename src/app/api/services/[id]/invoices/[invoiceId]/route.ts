import { NextRequest, NextResponse } from "next/server";
import { HostingInvoiceStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { startOfUtcDay, syncService } from "@/lib/hostingBilling";
import { readAmount } from "@/lib/serviceView";

async function findBill(id: string, invoiceId: string) {
  return prisma.hostingInvoice.findFirst({
    where: { id: invoiceId, hostingServiceId: id, status: { not: HostingInvoiceStatus.void } },
  });
}

/** Correct a bill: amount, due date, or (for one-off charges) what it's for. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; invoiceId: string }> }
) {
  const { id, invoiceId } = await params;
  try {
    const bill = await findBill(id, invoiceId);
    if (!bill) return NextResponse.json({ error: "Bill not found" }, { status: 404 });
    const body = await request.json().catch(() => ({}));
    const data: Record<string, unknown> = {};

    if (body?.amountKes !== undefined) {
      const amountKes = readAmount(body.amountKes);
      if (!amountKes) return NextResponse.json({ error: "Amount must be more than 0" }, { status: 400 });
      data.amountKes = amountKes;
      // A build installment stays a build installment at its new amount.
      if (bill.setupPortionKes > 0) data.setupPortionKes = amountKes;
    }
    if (typeof body?.dueDate === "string" && body.dueDate) {
      const due = new Date(body.dueDate);
      if (Number.isNaN(due.getTime())) return NextResponse.json({ error: "Due date is not a valid date" }, { status: 400 });
      data.dueDate = startOfUtcDay(due);
    }
    if (typeof body?.description === "string" && bill.description) {
      const description = body.description.trim().slice(0, 120);
      if (!description) return NextResponse.json({ error: "Say what the charge is for" }, { status: 400 });
      data.description = description;
    }
    if (Object.keys(data).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

    await prisma.hostingInvoice.update({ where: { id: invoiceId }, data });
    await syncService(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to update hosting bill:", error);
    return NextResponse.json({ error: "Failed to update bill" }, { status: 500 });
  }
}

/**
 * Removes a bill (kept as void for the record). A removed monthly bill is
 * not re-created: the schedule continues from the latest bill.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; invoiceId: string }> }
) {
  const { id, invoiceId } = await params;
  try {
    const bill = await findBill(id, invoiceId);
    if (!bill) return NextResponse.json({ error: "Bill not found" }, { status: 404 });
    await prisma.hostingInvoice.update({ where: { id: invoiceId }, data: { status: HostingInvoiceStatus.void } });
    await syncService(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to remove hosting bill:", error);
    return NextResponse.json({ error: "Failed to remove bill" }, { status: 500 });
  }
}
