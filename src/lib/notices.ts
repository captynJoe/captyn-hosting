import type { HostingService } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import type { Ledger } from "@/lib/ledger";
import { labelInvoices } from "@/lib/invoiceLabels";
import {
  formatDateLabel,
  generateBillEmail,
  generateHostingPaymentReceivedEmail,
  generateOverdueEmail,
  generatePausedEmail,
} from "@/lib/emailTemplates";

export function payUrlFor(payToken: string): string {
  const base = (process.env.HOSTING_APP_BASE_URL || "http://localhost:3100").replace(/\/+$/, "");
  return `${base}/p/${payToken}`;
}

type NoticeService = Pick<HostingService, "id" | "customerName" | "customerEmail" | "domain" | "setupFeeKes" | "status" | "suspendAfter">;

/**
 * The right email for where the account stands: paused, overdue (with the
 * pause date) or a plain bill. Returns false when nothing is owed or the
 * email failed.
 */
export async function sendBalanceNotice(service: NoticeService, ledger: Ledger, now: Date = new Date()): Promise<boolean> {
  const firstOpen = ledger.firstOpen;
  if (!firstOpen || ledger.balanceKes <= 0) return false;
  const payUrl = payUrlFor(firstOpen.payToken);

  let email;
  if (service.status === "suspended") {
    email = generatePausedEmail({
      customerName: service.customerName,
      domain: service.domain,
      overdueKes: ledger.overdueKes,
      payUrl,
    });
  } else if (ledger.overdueKes > 0 && service.suspendAfter) {
    email = generateOverdueEmail({
      customerName: service.customerName,
      domain: service.domain,
      overdueKes: ledger.overdueKes,
      balanceKes: ledger.balanceKes,
      suspendDateLabel: formatDateLabel(service.suspendAfter),
      payUrl,
    });
  } else {
    const labels = labelInvoices(ledger.invoices, service.setupFeeKes);
    email = generateBillEmail({
      customerName: service.customerName,
      domain: service.domain,
      balanceKes: ledger.balanceKes,
      overdueKes: ledger.overdueKes,
      dueDateLabel: formatDateLabel(firstOpen.dueDate),
      payUrl,
      lines: ledger.invoices
        .filter((row) => row.openKes > 0)
        .map((row) => ({ label: labels.get(row.id) || "Hosting", amountKes: row.openKes })),
    });
  }

  const sent = await sendEmail({ to: service.customerEmail, ...email });
  if (sent) {
    await prisma.hostingService.update({ where: { id: service.id }, data: { reminderSentAt: now } });
  }
  return sent;
}

export async function sendPaymentReceipt(
  service: Pick<HostingService, "customerName" | "customerEmail" | "domain">,
  amountKes: number,
  balanceKes: number,
  receiptNumber?: string | null
): Promise<boolean> {
  const email = generateHostingPaymentReceivedEmail({
    customerName: service.customerName,
    domain: service.domain,
    amountKes,
    balanceKes,
    receiptNumber,
  });
  return sendEmail({ to: service.customerEmail, ...email });
}
