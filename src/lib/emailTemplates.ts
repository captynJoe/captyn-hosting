export function formatKes(amountKes: number): string {
  return `KSh ${Math.round(amountKes).toLocaleString("en-KE")}`;
}

export function formatDateLabel(date: Date): string {
  return date.toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Nairobi" });
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function brandMarkUrl(): string {
  const base = (process.env.HOSTING_APP_BASE_URL || "https://hosting.captyn.shop").replace(/\/+$/, "");
  return `${base}/captyn-mark.png`;
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
      <table role="presentation" style="border-collapse:collapse;"><tr>
        <td style="padding:0 10px 0 0;vertical-align:middle;"><img src="${brandMarkUrl()}" width="34" height="34" alt="CAPTYN" style="display:block;border-radius:9px;"></td>
        <td style="vertical-align:middle;font-size:13px;font-weight:800;letter-spacing:2px;color:#0f172a;">CAPTYN HOSTING</td>
      </tr></table>
      <div style="font-size:18px;font-weight:600;margin-top:14px;">${escapeHtml(input.domain)}</div>
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

export function generateHostingSiteRestoredEmail(data: { customerName: string; domain: string }): EmailParts {
  const subject = `Your website is back online: ${data.domain}`;
  const html = emailShell({
    domain: data.domain,
    amountLabel: "Site restored",
    amountCaption: "Your website is back online",
    tone: "good",
    paragraphs: [greeting(data.customerName), `Access to ${escapeHtml(data.domain)} has been restored.`],
  });
  const text = `Hi ${data.customerName || "there"}, access to ${data.domain} has been restored and your website is back online.\n\nCAPTYN Hosting`;
  return { subject, html, text };
}
