import { NextRequest, NextResponse } from "next/server";
import { HostingInvoiceStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { computeNextInvoicePeriod } from "@/lib/hostingBilling";
import { generateHostingInvoiceDueEmail } from "@/lib/emailTemplates";
import { sendEmail } from "@/lib/email";

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

    const lastInvoice = await prisma.hostingInvoice.findFirst({
      where: { hostingServiceId: id },
      orderBy: { periodStartsAt: "desc" },
      select: { periodStartsAt: true },
    });
    const period = computeNextInvoicePeriod(service, lastInvoice?.periodStartsAt ?? null);

    const invoice = await prisma.hostingInvoice.upsert({
      where: {
        hostingServiceId_periodStartsAt: {
          hostingServiceId: id,
          periodStartsAt: period.periodStartsAt,
        },
      },
      update: {},
      create: {
        hostingServiceId: id,
        periodStartsAt: period.periodStartsAt,
        periodEndsAt: period.periodEndsAt,
        dueDate: period.dueDate,
        amountKes: service.monthlyPriceKes,
        status: HostingInvoiceStatus.pending,
      },
    });

    const baseUrl = process.env.HOSTING_APP_BASE_URL || "http://localhost:3100";
    const payUrl = `${baseUrl}/pay/${invoice.payToken}`;
    const { subject, html, text } = generateHostingInvoiceDueEmail({
      customerName: service.customerName,
      domain: service.domain,
      amountKes: invoice.amountKes,
      dueDateLabel: invoice.dueDate.toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" }),
      payUrl,
      isOverdue: invoice.status === HostingInvoiceStatus.overdue,
    });
    const sent = await sendEmail({ to: service.customerEmail, subject, html, text });

    if (sent) {
      const reminders = (invoice.remindersSentAt as Record<string, string> | null) || {};
      await prisma.hostingInvoice.update({
        where: { id: invoice.id },
        data: { remindersSentAt: { ...reminders, due: new Date().toISOString() } },
      });
    }

    return NextResponse.json({ success: true, invoice, emailSent: sent });
  } catch (error) {
    console.error("Failed to create/send hosting invoice:", error);
    return NextResponse.json({ error: "Failed to create/send hosting invoice" }, { status: 500 });
  }
}
