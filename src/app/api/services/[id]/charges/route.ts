import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { startOfUtcDay, syncService } from "@/lib/hostingBilling";
import { readAmount } from "@/lib/serviceView";

const HOUR_MS = 60 * 60 * 1000;

/** A one-off charge on top of the build fee and hosting, e.g. extra features. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await request.json().catch(() => ({}));
    const description = typeof body?.description === "string" ? body.description.trim().slice(0, 120) : "";
    const amountKes = readAmount(body?.amountKes);
    const due = typeof body?.dueDate === "string" && body.dueDate ? new Date(body.dueDate) : new Date();
    if (!description) return NextResponse.json({ error: "Say what the charge is for" }, { status: 400 });
    if (!amountKes) return NextResponse.json({ error: "Enter the amount" }, { status: 400 });
    if (Number.isNaN(due.getTime())) return NextResponse.json({ error: "Due date is not a valid date" }, { status: 400 });

    const service = await prisma.hostingService.findUnique({ where: { id }, select: { id: true } });
    if (!service) return NextResponse.json({ error: "Hosting service not found" }, { status: 404 });

    const dueDate = startOfUtcDay(due);
    // periodStartsAt is unique per service; offset by the count of charges
    // already on that day so it never collides with a monthly bill (midnight).
    const sameDay = await prisma.hostingInvoice.count({
      where: { hostingServiceId: id, dueDate, description: { not: null } },
    });
    const periodStartsAt = new Date(dueDate.getTime() + (12 + sameDay) * HOUR_MS);
    const invoice = await prisma.hostingInvoice.create({
      data: {
        hostingServiceId: id,
        description,
        amountKes,
        dueDate,
        periodStartsAt,
        periodEndsAt: periodStartsAt,
      },
      select: { id: true },
    });
    await syncService(id);
    return NextResponse.json({ success: true, invoiceId: invoice.id });
  } catch (error) {
    console.error("Failed to add hosting charge:", error);
    return NextResponse.json({ error: "Failed to add charge" }, { status: 500 });
  }
}
