import { NextRequest, NextResponse } from "next/server";
import { HostingPaymentStatus, HostingServiceStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { computeLedger, normalizeDomain } from "@/lib/ledger";
import { generateDueInvoices, startOfUtcDay, syncService } from "@/lib/hostingBilling";
import { readAmount, summarizeService } from "@/lib/serviceView";

const ATTENTION_ORDER: Record<HostingServiceStatus, number> = {
  suspended: 0,
  overdue: 1,
  grace_period: 1,
  payment_due: 2,
  active: 3,
  cancelled: 4,
};

export async function GET() {
  try {
    const now = new Date();
    const services = await prisma.hostingService.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        invoices: true,
        payments: { where: { status: HostingPaymentStatus.completed } },
      },
    });

    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    let owedKes = 0;
    let overdueKes = 0;
    let collectedThisMonthKes = 0;
    let monthlyHostingKes = 0;

    const rows = services.map((service) => {
      const paidKes = service.payments.reduce((sum, payment) => sum + payment.amountKes, 0);
      const ledger = computeLedger(service.invoices, paidKes, now);
      if (service.status !== HostingServiceStatus.cancelled) {
        owedKes += ledger.balanceKes;
        overdueKes += ledger.overdueKes;
        monthlyHostingKes += service.monthlyPriceKes;
      }
      collectedThisMonthKes += service.payments
        .filter((payment) => (payment.paidAt ?? payment.createdAt) >= monthStart)
        .reduce((sum, payment) => sum + payment.amountKes, 0);
      return summarizeService(service, ledger);
    });

    rows.sort((a, b) => ATTENTION_ORDER[a.status] - ATTENTION_ORDER[b.status] || b.balanceKes - a.balanceKes);

    return NextResponse.json({
      services: rows,
      summary: { owedKes, overdueKes, collectedThisMonthKes, monthlyHostingKes },
    });
  } catch (error) {
    console.error("Failed to load hosting services:", error);
    return NextResponse.json({ error: "Failed to load hosting services" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const customerName = typeof body?.customerName === "string" ? body.customerName.trim() : "";
    const customerEmail = typeof body?.customerEmail === "string" ? body.customerEmail.trim() : "";
    const customerPhone = typeof body?.customerPhone === "string" ? body.customerPhone.trim() || null : null;
    const domain = typeof body?.domain === "string" ? normalizeDomain(body.domain) : "";
    const planName = (typeof body?.planName === "string" && body.planName.trim()) || "Managed hosting";
    const monthlyPriceKes = readAmount(body?.monthlyPriceKes);
    const setupFeeKes = readAmount(body?.setupFeeKes);
    const setupInstallmentKes = readAmount(body?.setupInstallmentKes);
    const firstBill = typeof body?.billingStartsAt === "string" && body.billingStartsAt ? new Date(body.billingStartsAt) : null;
    const businessProfileId = typeof body?.businessProfileId === "string" ? body.businessProfileId.trim() || null : null;
    const userId = typeof body?.userId === "string" ? body.userId.trim() || null : null;
    const notes = typeof body?.notes === "string" ? body.notes.trim() || null : null;

    if (!customerName || !customerEmail || !domain) {
      return NextResponse.json({ error: "Business name, email and domain are required" }, { status: 400 });
    }
    if (!monthlyPriceKes) {
      return NextResponse.json({ error: "Enter the monthly hosting price" }, { status: 400 });
    }
    if (firstBill && Number.isNaN(firstBill.getTime())) {
      return NextResponse.json({ error: "First bill date is not a valid date" }, { status: 400 });
    }
    const existing = await prisma.hostingService.findFirst({
      where: { domain: { equals: domain, mode: "insensitive" }, status: { not: HostingServiceStatus.cancelled } },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json({ error: `${domain} is already set up` }, { status: 409 });
    }

    const billingStartsAt = startOfUtcDay(firstBill || new Date());
    const service = await prisma.hostingService.create({
      data: {
        customerName,
        customerEmail,
        customerPhone,
        domain,
        planName,
        monthlyPriceKes,
        setupFeeKes,
        setupInstallmentKes: setupFeeKes ? setupInstallmentKes : 0,
        billingStartsAt,
        billingDayOfMonth: billingStartsAt.getUTCDate(),
        businessProfileId,
        userId,
        notes,
      },
    });

    // Bill past months now, without emails, so earlier payments can be
    // recorded against them before the daily run sends the first notice.
    await generateDueInvoices(service);
    await syncService(service.id);

    return NextResponse.json({ success: true, service: { id: service.id } });
  } catch (error) {
    console.error("Failed to create hosting service:", error);
    return NextResponse.json({ error: "Failed to create hosting service" }, { status: 500 });
  }
}
