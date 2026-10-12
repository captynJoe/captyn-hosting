export function formatKes(amountKes: number): string {
  return `KSh ${Math.round(amountKes).toLocaleString("en-KE")}`;
}

export function formatDateLabel(date: Date): string {
  return date.toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Nairobi" });
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

type EmailParts = { subject: string; html: string; text: string };

type ShellInput = {
  domain: string;
  amountLabel: string;
  amountCaption: string;
  tone: "neutral" | "warn" | "stop" | "good";
  paragraphs: string[];
  button?: { label: string; url: string };
  rows?: { label: string; value: string }[];
};

const TONE_COLOR: Record<ShellInput["tone"], string> = {
  neutral: "#0f172a",
  warn: "#b45309",
  stop: "#b91c1c",
  good: "#047857",
};

function emailShell(input: ShellInput): string {
  const color = TONE_COLOR[input.tone];
  const rows = (input.rows || [])
    .map(
      (row) =>
        `<tr><td style="padding:6px 0;color:#475569;">${escapeHtml(row.label)}</td><td style="padding:6px 0;text-align:right;color:#0f172a;">${escapeHtml(row.value)}</td></tr>`
    )
    .join("");
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escapeHtml(input.domain)}</title></head>
<body style="margin:0;padding:24px 12px;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0f172a;line-height:1.55;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0;">
    <div style="padding:20px 24px;border-bottom:1px solid #e2e8f0;">
      <div style="font-size:13px;color:#64748b;">CAPTYN Hosting</div>
      <div style="font-size:18px;font-weight:600;">${escapeHtml(input.domain)}</div>
    </div>
    <div style="padding:24px;">
      <div style="font-size:32px;font-weight:700;color:${color};">${escapeHtml(input.amountLabel)}</div>
      <div style="font-size:14px;color:${color};margin-bottom:16px;">${escapeHtml(input.amountCaption)}</div>
      ${input.paragraphs.map((p) => `<p style="margin:0 0 12px;">${p}</p>`).join("")}
      ${rows ? `<table style="width:100%;border-collapse:collapse;font-size:14px;margin:8px 0 4px;border-top:1px solid #e2e8f0;">${rows}</table>` : ""}
      ${
        input.button
          ? `<div style="margin:22px 0 6px;"><a href="${input.button.url}" style="display:inline-block;padding:12px 22px;background:#0f172a;color:#ffffff;text-decoration:none;border-radius:10px;font-weight:600;">${escapeHtml(input.button.label)}</a></div>
             <div style="font-size:12px;color:#64748b;">M-Pesa. No account or login needed.</div>`
          : ""
      }
    </div>
  </div>
</body>
</html>`;
}

function greeting(customerName: string): string {
  return `Hi ${escapeHtml(customerName || "there")},`;
}

export type BillLine = { label: string; amountKes: number };

export function generateBillEmail(data: {
  customerName: string;
  domain: string;
  balanceKes: number;
  overdueKes: number;
  dueDateLabel: string;
  payUrl: string;
  lines: BillLine[];
}): EmailParts {
  const amountLabel = formatKes(data.balanceKes);
  const subject = `${data.domain}: ${amountLabel} due ${data.dueDateLabel}`;
  const paragraphs = [greeting(data.customerName)];
  if (data.overdueKes > 0) {
    paragraphs.push(`This includes <strong>${formatKes(data.overdueKes)}</strong> that is already overdue.`);
  }
  const html = emailShell({
    domain: data.domain,
    amountLabel,
    amountCaption: `Due ${data.dueDateLabel}`,
    tone: data.overdueKes > 0 ? "warn" : "neutral",
    paragraphs,
    rows: data.lines.map((line) => ({ label: line.label, value: formatKes(line.amountKes) })),
    button: { label: `Pay ${amountLabel}`, url: data.payUrl },
  });
  const text = `${data.domain}: ${amountLabel} due ${data.dueDateLabel}.${
    data.overdueKes > 0 ? ` ${formatKes(data.overdueKes)} of it is already overdue.` : ""
  }\n\n${data.lines.map((line) => `${line.label}: ${formatKes(line.amountKes)}`).join("\n")}\n\nPay with M-Pesa: ${data.payUrl}\n\nCAPTYN Hosting`;
  return { subject, html, text };
}

export function generateOverdueEmail(data: {
  customerName: string;
  domain: string;
  overdueKes: number;
  balanceKes: number;
  suspendDateLabel: string;
  payUrl: string;
}): EmailParts {
  const amountLabel = formatKes(data.overdueKes);
  const subject = `Action needed: pay ${amountLabel} by ${data.suspendDateLabel} to keep ${data.domain} online`;
  const paragraphs = [
    greeting(data.customerName),
    `Your payment for <strong>${escapeHtml(data.domain)}</strong> is overdue. Pay <strong>${amountLabel}</strong> by <strong>${data.suspendDateLabel}</strong> to avoid service interruption.`,
  ];
  if (data.balanceKes > data.overdueKes + 0.5) {
    paragraphs.push(`Total balance including the current bill: ${formatKes(data.balanceKes)}.`);
  }
  const html = emailShell({
    domain: data.domain,
    amountLabel,
    amountCaption: `Overdue · site pauses ${data.suspendDateLabel} if unpaid`,
    tone: "warn",
    paragraphs,
    button: { label: `Pay ${amountLabel}`, url: data.payUrl },
  });
  const text = `Your payment for ${data.domain} is overdue. Pay ${amountLabel} by ${data.suspendDateLabel} to avoid service interruption.\n\nPay with M-Pesa: ${data.payUrl}\n\nCAPTYN Hosting`;
  return { subject, html, text };
}

export function generatePausedEmail(data: {
  customerName: string;
  domain: string;
  overdueKes: number;
  payUrl: string;
}): EmailParts {
  const amountLabel = formatKes(data.overdueKes);
  const subject = `${data.domain} is paused: pay ${amountLabel} to bring it back`;
  const html = emailShell({
    domain: data.domain,
    amountLabel,
    amountCaption: "Overdue · site paused",
    tone: "stop",
    paragraphs: [
      greeting(data.customerName),
      `<strong>${escapeHtml(data.domain)}</strong> is paused for non-payment. Visitors see a "temporarily unavailable" page.`,
      `Pay <strong>${amountLabel}</strong> and the site comes back online within a minute.`,
    ],
    button: { label: `Pay ${amountLabel}`, url: data.payUrl },
  });
  const text = `${data.domain} is paused for non-payment. Pay ${amountLabel} and it comes back online within a minute.\n\nPay with M-Pesa: ${data.payUrl}\n\nCAPTYN Hosting`;
  return { subject, html, text };
}

export function generateHostingPaymentReceivedEmail(data: {
  customerName: string;
  domain: string;
  amountKes: number;
  balanceKes: number;
  receiptNumber?: string | null;
}): EmailParts {
  const amountLabel = formatKes(data.amountKes);
  const subject = `Payment received: ${amountLabel} for ${data.domain}`;
  const balanceLine = data.balanceKes >= 1 ? `Still to pay: ${formatKes(data.balanceKes)}.` : "You're fully paid up.";
  const html = emailShell({
    domain: data.domain,
    amountLabel,
    amountCaption: "Received, thank you",
    tone: "good",
    paragraphs: [greeting(data.customerName), balanceLine],
    rows: data.receiptNumber ? [{ label: "M-Pesa receipt", value: data.receiptNumber }] : [],
  });
  const text = `We've received ${amountLabel} for ${data.domain}.${
    data.receiptNumber ? ` M-Pesa receipt: ${data.receiptNumber}.` : ""
  } ${balanceLine}\n\nCAPTYN Hosting`;
  return { subject, html, text };
}
