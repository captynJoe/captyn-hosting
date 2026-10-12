import { NextRequest, NextResponse } from "next/server";
import { HostingServiceStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DAY_MS, isValidDomain, normalizeDomain } from "@/lib/ledger";
import { generateDueInvoices, loadServiceLedger, startOfUtcDay, syncService } from "@/lib/hostingBilling";
import { readAmount, serviceDetail } from "@/lib/serviceView";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const loaded = await loadServiceLedger(id);
    if (!loaded) {
      return NextResponse.json({ error: "Hosting service not found" }, { status: 404 });
    }
    return NextResponse.json({ service: serviceDetail(loaded.service, loaded.ledger) });
  } catch (error) {
    console.error("Failed to load hosting service:", error);
    return NextResponse.json({ error: "Failed to load hosting service" }, { status: 500 });
  }
}

/**
 * Edits details and prices (future bills only), plus three actions:
 * `extendDays` pushes the pause date (and lifts a pause), `cancel` stops
 * billing, `reactivate` resumes it.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await request.json().catch(() => ({}));
    const service = await prisma.hostingService.findUnique({ where: { id } });
    if (!service) {
      return NextResponse.json({ error: "Hosting service not found" }, { status: 404 });
    }
    const data: Record<string, unknown> = {};

    for (const field of ["customerName", "customerEmail", "planName"] as const) {
      if (typeof body?.[field] === "string" && body[field].trim()) data[field] = body[field].trim();
    }
    if (typeof body?.customerPhone === "string") data.customerPhone = body.customerPhone.trim() || null;
    if (typeof body?.notes === "string") data.notes = body.notes.trim() || null;
    if (typeof body?.domain === "string" && body.domain.trim()) {
      const domain = normalizeDomain(body.domain);
      if (!isValidDomain(domain)) {
        return NextResponse.json({ error: `"${domain}" isn't a domain. Enter the site address, like example.com` }, { status: 400 });
      }
      data.domain = domain;
    }
    let rebill = false;
    if (typeof body?.billingStartsAt === "string" && body.billingStartsAt) {
      const firstBill = startOfUtcDay(new Date(body.billingStartsAt));
      if (Number.isNaN(firstBill.getTime())) {
        return NextResponse.json({ error: "First bill date is not a valid date" }, { status: 400 });
      }
      if (firstBill.getTime() !== service.billingStartsAt?.getTime()) {
        // Moving the first bill date redraws every bill, so only before any
        // money is recorded; afterwards the statement would stop adding up.
        const payments = await prisma.hostingPayment.count({ where: { hostingServiceId: id, status: "completed" } });
        if (payments > 0) {
          return NextResponse.json(
            { error: "The first bill date can't change after a payment is recorded" },
            { status: 409 }
          );
        }
        data.billingStartsAt = firstBill;
        data.billingDayOfMonth = firstBill.getUTCDate();
        rebill = true;
      }
    }
    if (body?.monthlyPriceKes !== undefined) {
      const price = readAmount(body.monthlyPriceKes);
      if (!price) return NextResponse.json({ error: "Monthly price must be more than 0" }, { status: 400 });
      data.monthlyPriceKes = price;
    }
    if (body?.setupFeeKes !== undefined) data.setupFeeKes = readAmount(body.setupFeeKes);
    if (body?.setupInstallmentKes !== undefined) data.setupInstallmentKes = readAmount(body.setupInstallmentKes);
    if (body?.graceDays !== undefined) {
      data.graceDays = Math.min(60, Math.max(1, Math.round(Number(body.graceDays) || 1)));
    }

    const extendDays = Math.round(Number(body?.extendDays) || 0);
    if (extendDays > 0) {
      const now = Date.now();
      const from = Math.max(service.suspendAfter?.getTime() ?? now, now);
      data.suspendAfter = new Date(from + extendDays * DAY_MS);
      if (service.status === HostingServiceStatus.suspended) data.status = HostingServiceStatus.overdue;
    }
    if (body?.cancel === true) data.status = HostingServiceStatus.cancelled;
    if (body?.reactivate === true && service.status === HostingServiceStatus.cancelled) {
      data.status = HostingServiceStatus.active;
      data.suspendAfter = null;
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const updated = await prisma.hostingService.update({ where: { id }, data });
    if (rebill) {
      await prisma.hostingInvoice.deleteMany({ where: { hostingServiceId: id } });
      await generateDueInvoices(updated);
    }
    await syncService(id);
    const loaded = await loadServiceLedger(id);
    return NextResponse.json({ success: true, service: loaded ? serviceDetail(loaded.service, loaded.ledger) : null });
  } catch (error) {
    console.error("Failed to update hosting service:", error);
    return NextResponse.json({ error: "Failed to update hosting service" }, { status: 500 });
  }
}
