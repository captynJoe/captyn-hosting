import { NextRequest, NextResponse } from "next/server";
import { generateDueInvoices, syncService } from "@/lib/hostingBilling";
import { prisma } from "@/lib/prisma";
import { sendBalanceNotice } from "@/lib/notices";

/** Send the customer their balance now: a bill, an overdue notice or a paused notice. */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const service = await prisma.hostingService.findUnique({ where: { id } });
    if (!service) {
      return NextResponse.json({ error: "Hosting service not found" }, { status: 404 });
    }
    await generateDueInvoices(service);
    const synced = await syncService(id);
    if (!synced || synced.ledger.balanceKes <= 0) {
      return NextResponse.json({ error: "Nothing is owed right now" }, { status: 409 });
    }
    const sent = await sendBalanceNotice(synced.service, synced.ledger);
    if (!sent) {
      return NextResponse.json({ error: "The email didn't send. Try again." }, { status: 502 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to send hosting reminder:", error);
    return NextResponse.json({ error: "Failed to send reminder" }, { status: 500 });
  }
}
