import type { HostingService } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { parseEmails, type Ledger } from "@/lib/ledger";
import { generateHostingPaymentReceivedEmail, generateHostingSiteRestoredEmail } from "@/lib/emailTemplates";
import { buildInvoice, invoiceKindFor, invoiceSubject, renderInvoiceHtml, renderInvoiceText } from "@/lib/invoiceDoc";

/** Sends to every billing email; true when at least one went out. */
async function sendToAll(customerEmail: string, email: { subject: string; html: string; text: string }): Promise<boolean> {
  let any = false;
  for (const to of parseEmails(customerEmail)) {
    if (await sendEmail({ to, ...email })) any = true;
  }
  return any;
}

export function payUrlFor(payToken: string): string {
  const base = (process.env.HOSTING_APP_BASE_URL || "http://localhost:3100").replace(/\/+$/, "");
  return `${base}/p/${payToken}`;
}

type NoticeService = Parameters<typeof buildInvoice>[0];

/**
 * Emails the account's invoice: every bill and payment, the balance due and
 * a pay link, headed as a bill, an overdue notice (with the pause date) or a
 * paused notice. Returns false when nothing is owed or no email went out.
 */
export async function sendBalanceNotice(service: NoticeService, ledger: Ledger, now: Date = new Date()): Promise<boolean> {
  if (!ledger.firstOpen || ledger.balanceKes <= 0) return false;
  const doc = await buildInvoice(service, ledger, invoiceKindFor(service, ledger), now);
  if (!doc) return false;

  const sent = await sendToAll(service.customerEmail, {
    subject: invoiceSubject(doc),
    html: renderInvoiceHtml(doc),
    text: renderInvoiceText(doc),
  });
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
  return sendToAll(service.customerEmail, email);
}

export async function sendHostingSiteRestoredNotice(
  service: Pick<HostingService, "customerName" | "customerEmail" | "domain">
): Promise<boolean> {
  return sendToAll(service.customerEmail, generateHostingSiteRestoredEmail({
    customerName: service.customerName,
    domain: service.domain,
  }));
}
