import { NextRequest, NextResponse } from "next/server";
import { HostingServiceStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const services = await prisma.hostingService.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        invoices: { orderBy: { periodStartsAt: "desc" }, take: 1 },
      },
    });

    const activeStatuses: HostingServiceStatus[] = [
      HostingServiceStatus.active,
      HostingServiceStatus.payment_due,
      HostingServiceStatus.overdue,
      HostingServiceStatus.grace_period,
    ];
    const activeServices = services.filter((service) => activeStatuses.includes(service.status));
    const mrr = activeServices.reduce((sum, service) => sum + service.monthlyPriceKes, 0);
    const overdueCount = services.reduce(
      (count, service) => count + service.invoices.filter((invoice) => invoice.status === "overdue").length,
      0
    );

    return NextResponse.json({
      services: services.map((service) => ({
        id: service.id,
        customerName: service.customerName,
        customerEmail: service.customerEmail,
        customerPhone: service.customerPhone,
        domain: service.domain,
        planName: service.planName,
        monthlyPriceKes: service.monthlyPriceKes,
        billingDayOfMonth: service.billingDayOfMonth,
        status: service.status,
        createdAt: service.createdAt,
        latestInvoice: service.invoices[0] ?? null,
      })),
      summary: {
        activeCount: activeServices.length,
        totalCount: services.length,
        mrrKes: mrr,
        overdueInvoiceCount: overdueCount,
      },
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
    const domain = typeof body?.domain === "string" ? body.domain.trim() : "";
    const planName = typeof body?.planName === "string" ? body.planName.trim() : "";
    const monthlyPriceKes = Number(body?.monthlyPriceKes);
    const billingDayOfMonth = Math.min(28, Math.max(1, Math.round(Number(body?.billingDayOfMonth) || 1)));
    const businessProfileId = typeof body?.businessProfileId === "string" ? body.businessProfileId.trim() || null : null;
    const userId = typeof body?.userId === "string" ? body.userId.trim() || null : null;
    const notes = typeof body?.notes === "string" ? body.notes.trim() || null : null;

    if (!customerName || !customerEmail || !domain || !planName) {
      return NextResponse.json(
        { error: "customerName, customerEmail, domain and planName are required" },
        { status: 400 }
      );
    }
    if (!Number.isFinite(monthlyPriceKes) || monthlyPriceKes <= 0) {
      return NextResponse.json({ error: "monthlyPriceKes must be a positive number" }, { status: 400 });
    }

    const service = await prisma.hostingService.create({
      data: {
        customerName,
        customerEmail,
        customerPhone,
        domain,
        planName,
        monthlyPriceKes,
        billingDayOfMonth,
        businessProfileId,
        userId,
        notes,
      },
    });

    return NextResponse.json({ success: true, service });
  } catch (error) {
    console.error("Failed to create hosting service:", error);
    return NextResponse.json({ error: "Failed to create hosting service" }, { status: 500 });
  }
}
