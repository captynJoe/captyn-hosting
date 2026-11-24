import { NextRequest, NextResponse } from "next/server";
import { HostingServiceStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DAY_MS, isValidDomain, isValidEmail, normalizeDomain, parseEmails } from "@/lib/ledger";
import { generateDueInvoices, loadServiceLedger, startOfUtcDay, syncService } from "@/lib/hostingBilling";
import { readAmount, serviceDetail } from "@/lib/serviceView";
import { sendHostingSiteRestoredNotice } from "@/lib/notices";
import { forgetSiteStatus } from "@/lib/siteStatusCache";

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
 * Edits details and prices (future bills only), plus actions: `extendDays`
 * pushes the pause date (and lifts a payment pause), `pause` true/false
 * pauses or resumes the site by hand, `cancel` stops billing, `reactivate`
 * resumes it.
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

    if (typeof body?.customerEmail === "string" && body.customerEmail.trim()) {
      const emails = parseEmails(body.customerEmail);
      const badEmail = emails.find((email) => !isValidEmail(email));
      if (badEmail) {
        return NextResponse.json({ error: `"${badEmail}" isn't an email address` }, { status: 400 });
      }
      data.customerEmail = emails.join(", ");
    }
    for (const field of ["customerName", "planName"] as const) {
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
    if (body?.repause === true) {
      const isInGracePeriod = service.status === HostingServiceStatus.overdue;
      const isAdminPausedWithOverdueBalance = service.status === HostingServiceStatus.suspended && service.manualPause;
      if ((!isInGracePeriod && !isAdminPausedWithOverdueBalance) || !service.suspendAfter) {
        return NextResponse.json({ error: "Only an overdue service in its grace period can be repaused" }, { status: 409 });
      }
      data.status = HostingServiceStatus.suspended;
      data.manualPause = false;
    }
    if (typeof body?.pause === "boolean") {
      data.manualPause = body.pause;
      if (!body.pause && service.status === HostingServiceStatus.suspended) data.status = HostingServiceStatus.overdue;
    }
    if (body?.cancel === true) {
      data.status = HostingServiceStatus.cancelled;
      data.manualPause = false;
    }
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
    const synced = await syncService(id);
    if (
      body?.pause === false &&
      service.manualPause &&
      synced &&
      !synced.service.manualPause &&
      synced.service.status !== HostingServiceStatus.suspended
    ) {
      const sent = await sendHostingSiteRestoredNotice(synced.service);
      if (!sent) console.error("Failed to send hosting restoration email:", { serviceId: id });
    }
    forgetSiteStatus(service.domain);
    if (typeof data.domain === "string") forgetSiteStatus(data.domain);
    const loaded = await loadServiceLedger(id);
    return NextResponse.json({ success: true, service: loaded ? serviceDetail(loaded.service, loaded.ledger) : null });
  } catch (error) {
    console.error("Failed to update hosting service:", error);
    return NextResponse.json({ error: "Failed to update hosting service" }, { status: 500 });
  }
}


export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const service = await prisma.hostingService.findUnique({
      where: { id },
      select: { id: true, domain: true },
    });
    if (!service) return NextResponse.json({ error: "Hosting service not found" }, { status: 404 });

    await prisma.hostingService.delete({ where: { id } });
    forgetSiteStatus(service.domain);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to remove hosting service:", error);
    return NextResponse.json({ error: "Failed to remove hosting service" }, { status: 500 });
  }
}
