import { HostingInvoiceStatus, HostingServiceStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type BillableService = {
  id: string;
  monthlyPriceKes: number;
  billingDayOfMonth: number;
  invoiceLeadDays: number;
};

function clampBillingDay(year: number, monthIndex: number, day: number): Date {
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const safeDay = Math.min(Math.max(1, day), daysInMonth);
  return new Date(Date.UTC(year, monthIndex, safeDay));
}

function addMonthsClamped(date: Date, months: number, billingDayOfMonth: number): Date {
  const year = date.getUTCFullYear();
  const monthIndex = date.getUTCMonth() + months;
  return clampBillingDay(year, monthIndex, billingDayOfMonth);
}

export interface HostingInvoicePeriod {
  periodStartsAt: Date;
  periodEndsAt: Date;
  dueDate: Date;
}

export function computeNextInvoicePeriod(
  service: Pick<BillableService, "billingDayOfMonth">,
  lastInvoicePeriodStartsAt: Date | null,
  now: Date = new Date()
): HostingInvoicePeriod {
  const periodStartsAt = lastInvoicePeriodStartsAt
    ? addMonthsClamped(lastInvoicePeriodStartsAt, 1, service.billingDayOfMonth)
    : (() => {
        const thisMonth = clampBillingDay(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          service.billingDayOfMonth
        );
        return thisMonth.getTime() >= now.getTime()
          ? thisMonth
          : addMonthsClamped(thisMonth, 1, service.billingDayOfMonth);
      })();

  const periodEndsAt = addMonthsClamped(periodStartsAt, 1, service.billingDayOfMonth);

  return { periodStartsAt, periodEndsAt, dueDate: periodStartsAt };
}

/**
 * Idempotent: HostingInvoice has a unique (hostingServiceId, periodStartsAt)
 * constraint, so a concurrent call racing this one fails on insert rather
 * than double-billing the same period.
 */
export async function ensureUpcomingInvoice(
  service: BillableService,
  now: Date = new Date()
): Promise<{ invoice: { id: string; payToken: string; dueDate: Date; amountKes: number }; created: boolean } | null> {
  const lastInvoice = await prisma.hostingInvoice.findFirst({
    where: { hostingServiceId: service.id },
    orderBy: { periodStartsAt: "desc" },
    select: { periodStartsAt: true },
  });

  const period = computeNextInvoicePeriod(service, lastInvoice?.periodStartsAt ?? null, now);
  const leadCutoff = new Date(now.getTime() + service.invoiceLeadDays * 24 * 60 * 60 * 1000);
  if (period.dueDate.getTime() > leadCutoff.getTime()) {
    return null;
  }

  const existing = await prisma.hostingInvoice.findUnique({
    where: {
      hostingServiceId_periodStartsAt: {
        hostingServiceId: service.id,
        periodStartsAt: period.periodStartsAt,
      },
    },
    select: { id: true, payToken: true, dueDate: true, amountKes: true },
  });
  if (existing) {
    return { invoice: existing, created: false };
  }

  try {
    const invoice = await prisma.hostingInvoice.create({
      data: {
        hostingServiceId: service.id,
        periodStartsAt: period.periodStartsAt,
        periodEndsAt: period.periodEndsAt,
        dueDate: period.dueDate,
        amountKes: service.monthlyPriceKes,
        status: HostingInvoiceStatus.pending,
      },
      select: { id: true, payToken: true, dueDate: true, amountKes: true },
    });
    return { invoice, created: true };
  } catch (error) {
    // Unique constraint hit: another concurrent run already created it.
    const fresh = await prisma.hostingInvoice.findUnique({
      where: {
        hostingServiceId_periodStartsAt: {
          hostingServiceId: service.id,
          periodStartsAt: period.periodStartsAt,
        },
      },
      select: { id: true, payToken: true, dueDate: true, amountKes: true },
    });
    if (fresh) return { invoice: fresh, created: false };
    throw error;
  }
}

export const BILLABLE_SERVICE_STATUSES: HostingServiceStatus[] = [
  HostingServiceStatus.active,
  HostingServiceStatus.payment_due,
  HostingServiceStatus.overdue,
  HostingServiceStatus.grace_period,
];
