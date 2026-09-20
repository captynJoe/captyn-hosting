function formatKes(amountKes: number): string {
  return `KSh ${Math.round(amountKes).toLocaleString()}`;
}

function emailShell(title: string, bodyHtml: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f4f4f4; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .header { background-color: #2563eb; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
        .content { padding: 30px; }
        .button { display: inline-block; padding: 12px 24px; background-color: #2563eb; color: white; text-decoration: none; border-radius: 4px; font-weight: bold; margin: 20px 0; }
        .amount { font-size: 28px; font-weight: bold; color: #111827; }
        .footer { background-color: #f8f9fa; padding: 20px; text-align: center; border-radius: 0 0 8px 8px; font-size: 12px; color: #666; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header"><h1>${title}</h1></div>
        <div class="content">${bodyHtml}</div>
        <div class="footer"><p>CAPTYN Hosting</p></div>
    </div>
</body>
</html>
  `;
}

export interface HostingInvoiceDueEmailData {
  customerName: string;
  domain: string;
  amountKes: number;
  dueDateLabel: string;
  payUrl: string;
  isOverdue?: boolean;
}

export function generateHostingInvoiceDueEmail(data: HostingInvoiceDueEmailData): { subject: string; html: string; text: string } {
  const { customerName, domain, amountKes, dueDateLabel, payUrl, isOverdue } = data;
  const amountLabel = formatKes(amountKes);
  const subject = isOverdue
    ? `Payment overdue: ${domain} hosting`
    : `Hosting invoice for ${domain} — ${amountLabel} due ${dueDateLabel}`;

  const html = emailShell(
    isOverdue ? "Hosting payment overdue" : "Your hosting invoice is ready",
    `
      <p>Hi ${customerName || "there"},</p>
      <p>${
        isOverdue
          ? `Your CAPTYN-managed hosting for <strong>${domain}</strong> has an overdue balance.`
          : `Here's your hosting invoice for <strong>${domain}</strong>, managed and maintained by CAPTYN.`
      }</p>
      <p class="amount">${amountLabel}</p>
      <p>Due ${dueDateLabel}</p>
      <div style="text-align: center;">
        <a href="${payUrl}" class="button">Pay with M-Pesa</a>
      </div>
      <p>You can pay directly from this link — no account or login needed.</p>
      <p>Best regards,<br>CAPTYN Team</p>
    `
  );

  const text = `Hi ${customerName || "there"},\n\n${
    isOverdue
      ? `Your CAPTYN-managed hosting for ${domain} has an overdue balance of ${amountLabel}.`
      : `Your hosting invoice for ${domain}: ${amountLabel}, due ${dueDateLabel}.`
  }\n\nPay here: ${payUrl}\n\nCAPTYN Team`;

  return { subject, html, text };
}

export interface HostingPaymentReceivedEmailData {
  customerName: string;
  domain: string;
  amountKes: number;
  note?: string | null;
}

export function generateHostingPaymentReceivedEmail(data: HostingPaymentReceivedEmailData): { subject: string; html: string; text: string } {
  const { customerName, domain, amountKes, note } = data;
  const amountLabel = formatKes(amountKes);
  const subject = `Payment received: ${domain} hosting`;

  const html = emailShell(
    "Payment received",
    `
      <p>Hi ${customerName || "there"},</p>
      <p>We've received your payment for hosting on <strong>${domain}</strong>. Your site stays online, secured, backed up and managed by CAPTYN.</p>
      <p class="amount">${amountLabel}</p>
      ${note ? `<p>${note}</p>` : ""}
      <p>Thank you for staying with CAPTYN.</p>
      <p>Best regards,<br>CAPTYN Team</p>
    `
  );

  const text = `Hi ${customerName || "there"},\n\nWe've received your payment of ${amountLabel} for hosting on ${domain}.${
    note ? ` ${note}` : ""
  }\n\nCAPTYN Team`;

  return { subject, html, text };
}
