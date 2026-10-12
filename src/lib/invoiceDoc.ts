import { HostingPaymentStatus, type HostingService } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseEmails, type Ledger } from "@/lib/ledger";
import { labelInvoices } from "@/lib/invoiceLabels";
import { formatDateLabel, formatKes } from "@/lib/emailTemplates";

// The hosting invoice: one statement of account per send (every bill and
// payment so far, balance due, how to pay). The same inline-styled HTML is
// the email body and the printable page at /i/[token].

export type InvoiceKind = "bill" | "overdue" | "paused";

type InvoiceService = Pick<
  HostingService,
  "id" | "customerName" | "customerEmail" | "customerPhone" | "domain" | "setupFeeKes" | "status" | "suspendAfter"
>;

export type InvoiceDoc = {
  number: string;
  issuedAt: Date;
  kind: InvoiceKind;
  service: InvoiceService;
  lines: { date: Date; description: string; amountKes: number; openKes: number }[];
  payments: { date: Date; description: string; amountKes: number }[];
  upcoming: { date: Date; description: string; amountKes: number }[];
  invoicedKes: number;
  paidKes: number;
  balanceKes: number;
  overdueKes: number;
  dueDate: Date | null;
  payBy: Date | null;
  payUrl: string;
  invoiceUrl: string;
};

const SUPPORT_EMAIL = "support@captyn.shop";

function baseUrl(): string {
  return (process.env.HOSTING_APP_BASE_URL || "https://hosting.captyn.shop").replace(/\/+$/, "");
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** CH-<service>-<yyyymmdd>: one number per account per day it is issued. */
function invoiceNumber(serviceId: string, issuedAt: Date): string {
  const ymd = issuedAt.toISOString().slice(0, 10).replace(/-/g, "");
  return `CH-${serviceId.slice(-5).toUpperCase()}-${ymd}`;
}

export function invoiceKindFor(service: Pick<HostingService, "status" | "suspendAfter">, ledger: Ledger): InvoiceKind {
  if (service.status === "suspended") return "paused";
  if (ledger.overdueKes > 0 && service.suspendAfter) return "overdue";
  return "bill";
}

export async function buildInvoice(
  service: InvoiceService,
  ledger: Ledger,
  kind: InvoiceKind,
  now: Date = new Date()
): Promise<InvoiceDoc | null> {
  const token = ledger.firstOpen?.payToken ?? ledger.invoices[ledger.invoices.length - 1]?.payToken;
  if (!token) return null;
  const labels = labelInvoices([...ledger.invoices, ...ledger.upcoming], service.setupFeeKes);
  const payments = await prisma.hostingPayment.findMany({
    where: { hostingServiceId: service.id, status: HostingPaymentStatus.completed },
    orderBy: { paidAt: "asc" },
  });
  return {
    number: invoiceNumber(service.id, now),
    issuedAt: now,
    kind,
    service,
    lines: ledger.invoices.map((row) => ({
      date: row.dueDate,
      description: labels.get(row.id) || "Hosting",
      amountKes: row.amountKes,
      openKes: row.openKes,
    })),
    payments: payments.map((payment) => ({
      date: payment.paidAt ?? payment.createdAt,
      description: [
        payment.method === "mpesa" ? "M-Pesa payment" : "Payment received",
        payment.mpesaReceiptNumber,
      ]
        .filter(Boolean)
        .join(" · "),
      amountKes: payment.amountKes,
    })),
    upcoming: ledger.upcoming.map((row) => ({
      date: row.dueDate,
      description: labels.get(row.id) || "Hosting",
      amountKes: row.amountKes,
    })),
    invoicedKes: ledger.invoicedKes,
    paidKes: ledger.paidKes,
    balanceKes: ledger.balanceKes,
    overdueKes: ledger.overdueKes,
    dueDate: ledger.firstOpen?.dueDate ?? null,
    payBy: kind === "overdue" ? service.suspendAfter : null,
    payUrl: `${baseUrl()}/p/${token}`,
    invoiceUrl: `${baseUrl()}/i/${token}`,
  };
}

const KIND_BANNER: Record<InvoiceKind, { bg: string; fg: string } | null> = {
  bill: null,
  overdue: { bg: "#fef3c7", fg: "#92400e" },
  paused: { bg: "#fee2e2", fg: "#991b1b" },
};

function banner(doc: InvoiceDoc): string | null {
  const domain = escapeHtml(doc.service.domain);
  if (doc.kind === "paused") {
    return `<strong>${domain} is paused for non-payment.</strong> Pay ${formatKes(doc.overdueKes)} and it comes back online within a minute.`;
  }
  if (doc.kind === "overdue" && doc.payBy) {
    return `<strong>Payment overdue.</strong> Pay ${formatKes(doc.overdueKes)} by ${formatDateLabel(doc.payBy)} to avoid interruption of ${domain}.`;
  }
  return null;
}

export function invoiceSubject(doc: InvoiceDoc): string {
  const domain = doc.service.domain;
  if (doc.kind === "paused") return `${domain} is paused: invoice ${doc.number}, ${formatKes(doc.overdueKes)} overdue`;
  if (doc.kind === "overdue" && doc.payBy) {
    return `Overdue invoice ${doc.number}: pay ${formatKes(doc.overdueKes)} by ${formatDateLabel(doc.payBy)} to keep ${domain} online`;
  }
  return `Invoice ${doc.number} from CAPTYN Hosting: ${formatKes(doc.balanceKes)} for ${domain}`;
}

const cell = "padding:9px 0;border-bottom:1px solid #e2e8f0;vertical-align:top;";
const num = `${cell}text-align:right;white-space:nowrap;`;

/** Inline-styled so it survives email clients; also the printable page body. */
export function renderInvoiceHtml(doc: InvoiceDoc, { printable = false }: { printable?: boolean } = {}): string {
  const tone = KIND_BANNER[doc.kind];
  const bannerHtml = banner(doc);
  const emails = parseEmails(doc.service.customerEmail).map(escapeHtml).join("<br>");
  const lines = doc.lines
    .map(
      (line) => `<tr>
        <td style="${cell}color:#475569;white-space:nowrap;padding-right:12px;">${formatDateLabel(line.date)}</td>
        <td style="${cell}">${escapeHtml(line.description)}${
          line.openKes > 0 && line.openKes < line.amountKes - 0.5
            ? `<div style="font-size:12px;color:#92400e;">${formatKes(line.openKes)} unpaid</div>`
            : ""
        }</td>
        <td style="${num}">${formatKes(line.amountKes)}</td>
      </tr>`
    )
    .join("");
  const payments = doc.payments
    .map(
      (payment) => `<tr>
        <td style="${cell}color:#475569;white-space:nowrap;padding-right:12px;">${formatDateLabel(payment.date)}</td>
        <td style="${cell}">${escapeHtml(payment.description)}</td>
        <td style="${num}color:#047857;">−${formatKes(payment.amountKes)}</td>
      </tr>`
    )
    .join("");
  const dueLine = doc.payBy
    ? `Pay by ${formatDateLabel(doc.payBy)}`
    : doc.overdueKes > 0
    ? "Overdue"
    : doc.dueDate
    ? `Due ${formatDateLabel(doc.dueDate)}`
    : "Paid up";

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="robots" content="noindex">
<title>Invoice ${doc.number} · ${escapeHtml(doc.service.domain)}</title>
${printable ? `<style>@media print { .noprint { display:none !important; } body { background:#fff !important; padding:0 !important; } .sheet { border:0 !important; } }</style>` : ""}
</head>
<body style="margin:0;padding:24px 12px;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0f172a;line-height:1.5;">
<div class="sheet" style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;">
  <div style="padding:24px 28px;border-bottom:1px solid #e2e8f0;">
    <table role="presentation" style="width:100%;border-collapse:collapse;"><tr>
      <td style="vertical-align:top;">
        <table role="presentation" style="border-collapse:collapse;"><tr>
          <td style="padding:0 10px 0 0;vertical-align:middle;"><img src="${baseUrl()}/captyn-mark.png" width="36" height="36" alt="CAPTYN" style="display:block;border-radius:9px;"></td>
          <td style="vertical-align:middle;font-size:14px;font-weight:800;letter-spacing:2px;">CAPTYN HOSTING</td>
        </tr></table>
        <div style="font-size:12px;color:#64748b;margin-top:8px;">${SUPPORT_EMAIL} · captyn.shop</div>
      </td>
      <td style="vertical-align:top;text-align:right;">
        <div style="font-size:22px;font-weight:700;letter-spacing:1px;">INVOICE</div>
        <div style="font-size:13px;color:#475569;">${doc.number}</div>
        <div style="font-size:13px;color:#475569;">Issued ${formatDateLabel(doc.issuedAt)}</div>
      </td>
    </tr></table>
  </div>

  ${
    bannerHtml && tone
      ? `<div style="padding:12px 28px;background:${tone.bg};color:${tone.fg};font-size:14px;">${bannerHtml}</div>`
      : ""
  }

  <div style="padding:22px 28px 6px;">
    <table role="presentation" style="width:100%;border-collapse:collapse;"><tr>
      <td style="vertical-align:top;padding-right:16px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:1px;color:#64748b;">BILLED TO</div>
        <div style="font-weight:600;margin-top:4px;">${escapeHtml(doc.service.customerName)}</div>
        <div style="font-size:13px;color:#475569;">${escapeHtml(doc.service.domain)}</div>
        <div style="font-size:13px;color:#475569;">${emails}</div>
        ${doc.service.customerPhone ? `<div style="font-size:13px;color:#475569;">${escapeHtml(doc.service.customerPhone)}</div>` : ""}
      </td>
      <td style="vertical-align:top;text-align:right;">
        <div style="font-size:11px;font-weight:700;letter-spacing:1px;color:#64748b;">AMOUNT DUE</div>
        <div style="font-size:30px;font-weight:700;margin-top:2px;color:${doc.overdueKes > 0 ? "#b45309" : "#0f172a"};">${formatKes(doc.balanceKes)}</div>
        <div style="font-size:13px;color:#475569;">${dueLine}</div>
      </td>
    </tr></table>
  </div>

  <div style="padding:8px 28px 0;">
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <thead><tr>
        <th style="text-align:left;font-size:11px;letter-spacing:1px;color:#64748b;padding:8px 0;border-bottom:2px solid #0f172a;">DATE</th>
        <th style="text-align:left;font-size:11px;letter-spacing:1px;color:#64748b;padding:8px 0;border-bottom:2px solid #0f172a;">DESCRIPTION</th>
        <th style="text-align:right;font-size:11px;letter-spacing:1px;color:#64748b;padding:8px 0;border-bottom:2px solid #0f172a;">AMOUNT</th>
      </tr></thead>
      <tbody>${lines}${payments}</tbody>
    </table>
    <table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px;margin-top:10px;">
      <tr><td style="padding:4px 0;color:#475569;">Total billed</td><td style="padding:4px 0;text-align:right;">${formatKes(doc.invoicedKes)}</td></tr>
      <tr><td style="padding:4px 0;color:#475569;">Paid</td><td style="padding:4px 0;text-align:right;color:#047857;">−${formatKes(doc.paidKes)}</td></tr>
      ${
        doc.overdueKes > 0
          ? `<tr><td style="padding:4px 0;color:#b45309;">Of which overdue</td><td style="padding:4px 0;text-align:right;color:#b45309;">${formatKes(doc.overdueKes)}</td></tr>`
          : ""
      }
      <tr><td style="padding:10px 0;font-weight:700;border-top:2px solid #0f172a;">Balance due</td><td style="padding:10px 0;text-align:right;font-weight:700;font-size:18px;border-top:2px solid #0f172a;">${formatKes(doc.balanceKes)}</td></tr>
    </table>
  </div>

  ${
    doc.upcoming.length
      ? `<div style="padding:4px 28px 0;font-size:13px;color:#64748b;">Coming up, not due yet: ${doc.upcoming
          .map((u) => `${escapeHtml(u.description)} ${formatKes(u.amountKes)} on ${formatDateLabel(u.date)}`)
          .join("; ")}.</div>`
      : ""
  }

  <div style="padding:16px 28px 26px;">
    ${
      doc.balanceKes > 0
        ? `<div class="noprint"><a href="${doc.payUrl}" style="display:inline-block;padding:13px 24px;background:#0f172a;color:#ffffff;text-decoration:none;border-radius:10px;font-weight:600;">Pay ${formatKes(doc.balanceKes)} with M-Pesa</a></div>
           <div style="font-size:12px;color:#64748b;margin-top:8px;">Pay online: ${doc.payUrl}</div>`
        : ""
    }
    ${
      printable
        ? `<div class="noprint" style="margin-top:14px;"><a href="javascript:window.print()" style="font-size:13px;color:#0f172a;">Print or save as PDF</a></div>`
        : `<div style="font-size:12px;color:#64748b;margin-top:6px;">View or print this invoice: <a href="${doc.invoiceUrl}" style="color:#0f172a;">${doc.invoiceUrl}</a></div>`
    }
    <div style="font-size:12px;color:#64748b;margin-top:14px;">Questions about this invoice? Reply to ${SUPPORT_EMAIL}.</div>
  </div>
</div>
</body>
</html>`;
}

export function renderInvoiceText(doc: InvoiceDoc): string {
  const banner = doc.kind === "paused"
    ? `${doc.service.domain} is paused for non-payment.\n\n`
    : doc.kind === "overdue" && doc.payBy
    ? `Payment overdue: pay ${formatKes(doc.overdueKes)} by ${formatDateLabel(doc.payBy)} to avoid interruption of ${doc.service.domain}.\n\n`
    : "";
  const rows = [
    ...doc.lines.map((l) => `${formatDateLabel(l.date)}  ${l.description}  ${formatKes(l.amountKes)}`),
    ...doc.payments.map((p) => `${formatDateLabel(p.date)}  ${p.description}  -${formatKes(p.amountKes)}`),
  ].join("\n");
  return `CAPTYN Hosting · Invoice ${doc.number} · Issued ${formatDateLabel(doc.issuedAt)}
Billed to: ${doc.service.customerName} (${doc.service.domain})

${banner}${rows}

Total billed: ${formatKes(doc.invoicedKes)}
Paid: -${formatKes(doc.paidKes)}
Balance due: ${formatKes(doc.balanceKes)}
${doc.upcoming.length ? `Coming up, not due yet: ${doc.upcoming.map((u) => `${u.description} ${formatKes(u.amountKes)} on ${formatDateLabel(u.date)}`).join("; ")}\n` : ""}
Pay with M-Pesa: ${doc.payUrl}
View or print: ${doc.invoiceUrl}

Questions? ${SUPPORT_EMAIL}`;
}
