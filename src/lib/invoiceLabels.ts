import { formatKes } from "@/lib/emailTemplates";

type LabelInvoice = {
  id: string;
  dueDate: Date;
  periodStartsAt: Date;
  periodEndsAt: Date;
  setupPortionKes: number;
  description: string | null;
};

function shortDate(date: Date): string {
  return date.toLocaleDateString("en-KE", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** "Website build · 6,000 of 12,000", "Hosting · 12 Oct – 12 Nov" or a one-off charge's description, by invoice id. */
export function labelInvoices(invoices: LabelInvoice[], setupFeeKes: number): Map<string, string> {
  const labels = new Map<string, string>();
  let setupBilled = 0;
  for (const invoice of [...invoices].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())) {
    if (invoice.description) {
      labels.set(invoice.id, invoice.description);
    } else if (invoice.setupPortionKes > 0) {
      setupBilled += invoice.setupPortionKes;
      labels.set(
        invoice.id,
        `Website build · ${formatKes(Math.min(setupBilled, setupFeeKes || setupBilled))} of ${formatKes(setupFeeKes || setupBilled)}`
      );
    } else {
      labels.set(invoice.id, `Hosting · ${shortDate(invoice.periodStartsAt)} – ${shortDate(invoice.periodEndsAt)}`);
    }
  }
  return labels;
}
