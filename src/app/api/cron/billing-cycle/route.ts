import { NextRequest, NextResponse } from "next/server";
import { HostingInvoiceStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hasValidInternalKey } from "@/lib/internalKey";
import { BILLABLE_SERVICE_STATUSES, ensureUpcomingInvoice } from "@/lib/hostingBilling";
import { generateHostingInvoiceDueEmail } from "@/lib/emailTemplates";
import { sendEmail } from "@/lib/email";

type RunStats = {
  servicesChecked: number;
  invoicesCreated: number;
  dueRemindersSent: number;
  overdueMarked: number;
  overdueRemindersSent: number;
};

function formatDueDateLabel(date: Date): string {
  return date.toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" });
}

export async function POST(request: NextRequest) {
  if (!hasValidInternalKey(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const stats: RunStats = {
    servicesChecked: 0,
    invoicesCreated: 0,
    dueRemindersSent: 0,
    overdueMarked: 0,
    overdueRemindersSent: 0,
  };

  try {
    const now = new Date();

    const services = await prisma.hostingService.findMany({
      where: { status: { in: BILLABLE_SERVICE_STATUSES } },
      select: {
        id: true,
        monthlyPriceKes: true,
        billingDayOfMonth: true,
        invoiceLeadDays: true,
        customerEmail: true,
        customerName: true,
        domain: true,
      },
    });
    stats.servicesChecked = services.length;

    const baseUrl = process.env.HOSTING_APP_BASE_URL || "http://localhost:3100";

    for (const service of services) {
      const result = await ensureUpcomingInvoice(service, now);
      if (!result) continue;
      if (result.created) stats.invoicesCreated += 1;

      const invoice = await prisma.hostingInvoice.findUnique({
        where: { id: result.invoice.id },
        select: { id: true, payToken: true, dueDate: true, amountKes: true, status: true, remindersSentAt: true },
      });
      if (!invoice || invoice.status !== HostingInvoiceStatus.pending) continue;

      const reminders = (invoice.remindersSentAt as Record<string, string> | null) || {};
      if (!reminders.due) {
        const payUrl = `${baseUrl}/pay/${invoice.payToken}`;
        const { subject, html, text } = generateHostingInvoiceDueEmail({
          customerName: service.customerName,
          domain: service.domain,
          amountKes: invoice.amountKes,
          dueDateLabel: formatDueDateLabel(invoice.dueDate),
          payUrl,
        });
        const sent = await sendEmail({ to: service.customerEmail, subject, html, text });
        if (sent) {
          stats.dueRemindersSent += 1;
          await prisma.hostingInvoice.update({
            where: { id: invoice.id },
            data: { remindersSentAt: { ...reminders, due: now.toISOString() } },
          });
        }
      }
    }

    const overdueInvoices = await prisma.hostingInvoice.findMany({
      where: { status: HostingInvoiceStatus.pending, dueDate: { lt: now } },
      select: {
        id: true,
        payToken: true,
        dueDate: true,
        amountKes: true,
        remindersSentAt: true,
        hostingService: {
          select: { id: true, customerEmail: true, customerName: true, domain: true },
        },
      },
    });

    for (const invoice of overdueInvoices) {
      await prisma.hostingInvoice.update({
        where: { id: invoice.id },
        data: { status: HostingInvoiceStatus.overdue },
      });
      stats.overdueMarked += 1;

      const reminders = (invoice.remindersSentAt as Record<string, string> | null) || {};
      if (!reminders.overdue) {
        const payUrl = `${baseUrl}/pay/${invoice.payToken}`;
        const { subject, html, text } = generateHostingInvoiceDueEmail({
          customerName: invoice.hostingService.customerName,
          domain: invoice.hostingService.domain,
          amountKes: invoice.amountKes,
          dueDateLabel: formatDueDateLabel(invoice.dueDate),
          payUrl,
          isOverdue: true,
        });
        const sent = await sendEmail({ to: invoice.hostingService.customerEmail, subject, html, text });
        if (sent) {
          stats.overdueRemindersSent += 1;
          await prisma.hostingInvoice.update({
            where: { id: invoice.id },
            data: { remindersSentAt: { ...reminders, overdue: now.toISOString() } },
          });
        }
      }

      // Ops alerting (e.g. into byg-global's Ops Inbox) is intentionally not
      // wired from here yet -- this app has no admin session or internal-key
      // trust relationship with byg-global's ops-event API in that direction.
      console.warn("Hosting invoice overdue:", {
        invoiceId: invoice.id,
        domain: invoice.hostingService.domain,
        amountKes: invoice.amountKes,
      });
    }

    return NextResponse.json({ success: true, stats });
  } catch (error) {
    console.error("Failed to run hosting billing cycle:", error);
    return NextResponse.json({ error: "Failed to run hosting billing cycle", stats }, { status: 500 });
  }
}
