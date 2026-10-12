import { HostingPaymentMethod, HostingPaymentStatus, type HostingPayment, type HostingService } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { Ledger } from "@/lib/ledger";
import { labelInvoices } from "@/lib/invoiceLabels";
import { syncService } from "@/lib/hostingBilling";
import { payUrlFor, sendPaymentReceipt } from "@/lib/notices";

/** A whole-shilling amount above zero, or 0. */
export function readAmount(value: unknown): number {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount) : 0;
}

export type ServiceSummary = ReturnType<typeof summarizeService>;

export function summarizeService(service: HostingService, ledger: Ledger) {
  const setupBilledKes = ledger.setupBilledKes;
  return {
    id: service.id,
    customerName: service.customerName,
    customerEmail: service.customerEmail,
    customerPhone: service.customerPhone,
    domain: service.domain,
    planName: service.planName,
    monthlyPriceKes: service.monthlyPriceKes,
    setupFeeKes: service.setupFeeKes,
    setupInstallmentKes: service.setupInstallmentKes,
    setupBilledKes,
    billingStartsAt: service.billingStartsAt,
    billingDayOfMonth: service.billingDayOfMonth,
    graceDays: service.graceDays,
    status: service.status,
    manualPause: service.manualPause,
    suspendAfter: service.suspendAfter,
    reminderSentAt: service.reminderSentAt,
    notes: service.notes,
    balanceKes: ledger.balanceKes,
    overdueKes: ledger.overdueKes,
    creditKes: ledger.creditKes,
    paidKes: ledger.paidKes,
    nextDueDate: ledger.firstOpen?.dueDate ?? null,
    payUrl: ledger.firstOpen ? payUrlFor(ledger.firstOpen.payToken) : null,
    invoiceUrl: (() => {
      const token = ledger.firstOpen?.payToken ?? ledger.invoices[ledger.invoices.length - 1]?.payToken;
      return token ? payUrlFor(token).replace("/p/", "/i/") : null;
    })(),
  };
}

export function serviceDetail(service: HostingService & { payments: HostingPayment[] }, ledger: Ledger) {
  const labels = labelInvoices([...ledger.invoices, ...ledger.upcoming], service.setupFeeKes);
  return {
    ...summarizeService(service, ledger),
    invoices: [
      ...[...ledger.upcoming].reverse().map((row) => ({
        id: row.id,
        label: labels.get(row.id) || "Hosting",
        isCharge: Boolean(row.description),
        description: row.description,
        dueDate: row.dueDate,
        amountKes: row.amountKes,
        paidKes: 0,
        openKes: row.amountKes,
        status: "upcoming" as const,
      })),
      ...[...ledger.invoices].reverse().map((row) => ({
      id: row.id,
      label: labels.get(row.id) || "Hosting",
      isCharge: Boolean(row.description),
      description: row.description,
      dueDate: row.dueDate,
      amountKes: row.amountKes,
      paidKes: row.paidKes,
      openKes: row.openKes,
      status: row.nextStatus,
      })),
    ],
    payments: service.payments
      .filter((payment) => payment.status === HostingPaymentStatus.completed)
      .map((payment) => ({
        id: payment.id,
        amountKes: payment.amountKes,
        method: payment.method,
        receipt: payment.mpesaReceiptNumber,
        note: payment.note,
        paidAt: payment.paidAt ?? payment.createdAt,
      })),
  };
}

export async function recordManualPayment(input: {
  serviceId: string;
  amountKes: number;
  note?: string | null;
  receipt?: string | null;
  paidAt?: Date | null;
  emailReceipt: boolean;
}) {
  const payment = await prisma.hostingPayment.create({
    data: {
      hostingServiceId: input.serviceId,
      amountKes: input.amountKes,
      method: HostingPaymentMethod.manual,
      status: HostingPaymentStatus.completed,
      mpesaReceiptNumber: input.receipt || null,
      note: input.note || null,
      paidAt: input.paidAt || new Date(),
    },
  });
  const synced = await syncService(input.serviceId);
  if (synced && input.emailReceipt) {
    const sent = await sendPaymentReceipt(synced.service, input.amountKes, synced.ledger.balanceKes, input.receipt);
    if (!sent) console.error("Failed to send manual payment receipt email:", { paymentId: payment.id });
  }
  return { payment, synced };
}
