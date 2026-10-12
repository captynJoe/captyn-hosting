import { HostingPaymentStatus, HostingServiceStatus, type HostingService } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { computeLedger, DAY_MS, nextInvoiceCharge, nextServiceState, type Ledger } from "@/lib/ledger";

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

export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export interface HostingInvoicePeriod {
  periodStartsAt: Date;
  periodEndsAt: Date;
  dueDate: Date;
}

export function computeNextInvoicePeriod(
  service: Pick<HostingService, "billingDayOfMonth" | "billingStartsAt">,
  lastInvoicePeriodStartsAt: Date | null,
  now: Date = new Date()
): HostingInvoicePeriod {
  const periodStartsAt = lastInvoicePeriodStartsAt
    ? addMonthsClamped(lastInvoicePeriodStartsAt, 1, service.billingDayOfMonth)
    : service.billingStartsAt
    ? startOfUtcDay(service.billingStartsAt)
    : (() => {
        const thisMonth = clampBillingDay(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          service.billingDayOfMonth
        );
        return thisMonth.getTime() >= startOfUtcDay(now).getTime()
          ? thisMonth
          : addMonthsClamped(thisMonth, 1, service.billingDayOfMonth);
      })();

  const periodEndsAt = addMonthsClamped(periodStartsAt, 1, service.billingDayOfMonth);

  return { periodStartsAt, periodEndsAt, dueDate: periodStartsAt };
}

const MAX_INVOICES_PER_RUN = 36;

/**
 * Creates every invoice due on or before now + invoiceLeadDays, including
 * back months when billingStartsAt is in the past. Idempotent: the unique
 * (hostingServiceId, periodStartsAt) constraint stops a concurrent run from
 * double-billing a period.
 */
export async function generateDueInvoices(
  service: Pick<
    HostingService,
    | "id"
    | "billingDayOfMonth"
    | "billingStartsAt"
    | "invoiceLeadDays"
    | "monthlyPriceKes"
    | "setupFeeKes"
    | "setupInstallmentKes"
  >,
  now: Date = new Date()
): Promise<{ id: string; dueDate: Date }[]> {
  const created: { id: string; dueDate: Date }[] = [];
  const leadCutoff = now.getTime() + service.invoiceLeadDays * DAY_MS;

  const [lastInvoice, setupBilled] = await Promise.all([
    prisma.hostingInvoice.findFirst({
      where: { hostingServiceId: service.id },
      orderBy: { periodStartsAt: "desc" },
      select: { periodStartsAt: true },
    }),
    prisma.hostingInvoice.aggregate({
      where: { hostingServiceId: service.id, status: { not: "void" } },
      _sum: { setupPortionKes: true },
    }),
  ]);
  let lastPeriodStartsAt = lastInvoice?.periodStartsAt ?? null;
  let setupBilledKes = setupBilled._sum.setupPortionKes || 0;

  for (let i = 0; i < MAX_INVOICES_PER_RUN; i += 1) {
    const period = computeNextInvoicePeriod(service, lastPeriodStartsAt, now);
    if (period.dueDate.getTime() > leadCutoff) break;

    const charge = nextInvoiceCharge(service, setupBilledKes);
    try {
      const invoice = await prisma.hostingInvoice.create({
        data: {
          hostingServiceId: service.id,
          periodStartsAt: period.periodStartsAt,
          periodEndsAt: period.periodEndsAt,
          dueDate: period.dueDate,
          amountKes: charge.amountKes,
          setupPortionKes: charge.setupPortionKes,
        },
        select: { id: true, dueDate: true },
      });
      created.push(invoice);
    } catch (error) {
      // Unique constraint hit: another concurrent run already created it.
      const existing = await prisma.hostingInvoice.findUnique({
        where: {
          hostingServiceId_periodStartsAt: {
            hostingServiceId: service.id,
            periodStartsAt: period.periodStartsAt,
          },
        },
        select: { id: true },
      });
      if (!existing) throw error;
    }
    lastPeriodStartsAt = period.periodStartsAt;
    setupBilledKes += charge.setupPortionKes;
  }

  return created;
}

export async function loadServiceLedger(serviceId: string, now: Date = new Date()) {
  const service = await prisma.hostingService.findUnique({
    where: { id: serviceId },
    include: {
      invoices: true,
      payments: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!service) return null;
  const paidKes = service.payments
    .filter((payment) => payment.status === HostingPaymentStatus.completed)
    .reduce((sum, payment) => sum + payment.amountKes, 0);
  const ledger = computeLedger(service.invoices, paidKes, now);
  return { service, ledger };
}

/**
 * Writes what the ledger implies: invoice statuses, the service status and
 * its pause date. Safe to call from anywhere, any number of times. Only the
 * daily run passes canPause, so a pause always goes out with its email.
 */
export async function syncService(
  serviceId: string,
  now: Date = new Date(),
  { canPause = false }: { canPause?: boolean } = {}
): Promise<{ service: HostingService; ledger: Ledger; previousStatus: HostingServiceStatus } | null> {
  const loaded = await loadServiceLedger(serviceId, now);
  if (!loaded) return null;
  const { service, ledger } = loaded;

  for (const row of ledger.invoices) {
    if (row.nextStatus !== row.status) {
      await prisma.hostingInvoice.update({
        where: { id: row.id },
        data: { status: row.nextStatus, paidAt: row.nextStatus === "paid" ? now : null },
      });
    }
  }

  const next = nextServiceState(service, ledger, now);
  if (next.status === HostingServiceStatus.suspended && service.status !== HostingServiceStatus.suspended && !canPause) {
    next.status = HostingServiceStatus.overdue;
  }
  const previousStatus = service.status;
  let updated: HostingService = service;
  const suspendChanged = (next.suspendAfter?.getTime() ?? null) !== (service.suspendAfter?.getTime() ?? null);
  if (next.status !== service.status || suspendChanged) {
    updated = await prisma.hostingService.update({
      where: { id: service.id },
      data: {
        status: next.status,
        suspendAfter: next.suspendAfter,
        // A cleared overdue balance resets the reminder clock.
        ...(next.suspendAfter === null ? { reminderSentAt: null } : {}),
      },
    });
  }

  return { service: updated, ledger, previousStatus };
}

/** For the site gate: paused only while money is actually overdue. */
export async function isSitePaused(domain: string, now: Date = new Date()): Promise<boolean> {
  const service = await prisma.hostingService.findFirst({
    where: { domain: { equals: domain, mode: "insensitive" }, status: HostingServiceStatus.suspended },
    select: { id: true },
  });
  if (!service) return false;
  const loaded = await loadServiceLedger(service.id, now);
  if (!loaded || loaded.ledger.overdueKes > 0) return true;
  // Paid since the pause: lift it now rather than at the next daily run.
  await syncService(service.id, now);
  return false;
}
