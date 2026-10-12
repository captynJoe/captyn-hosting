// Client-side view helpers shared by the dashboard and the site page.

export type ServiceStatus = "active" | "payment_due" | "overdue" | "grace_period" | "suspended" | "cancelled";
export type Tone = "stop" | "warn" | "good" | "muted";

export type SiteSummary = {
  id: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  domain: string;
  planName: string;
  monthlyPriceKes: number;
  setupFeeKes: number;
  setupInstallmentKes: number;
  setupBilledKes: number;
  billingStartsAt: string | null;
  billingDayOfMonth: number;
  graceDays: number;
  status: ServiceStatus;
  suspendAfter: string | null;
  reminderSentAt: string | null;
  notes: string | null;
  balanceKes: number;
  overdueKes: number;
  creditKes: number;
  paidKes: number;
  nextDueDate: string | null;
  payUrl: string | null;
};

export function formatKes(value: number): string {
  return `KSh ${Math.round(value).toLocaleString("en-KE")}`;
}

export function formatDate(value: string | Date): string {
  return new Date(value).toLocaleDateString("en-KE", { day: "numeric", month: "short", timeZone: "Africa/Nairobi" });
}

export const TONE_TEXT: Record<Tone, string> = {
  stop: "text-[var(--stop)]",
  warn: "text-[var(--warn)]",
  good: "text-[var(--good)]",
  muted: "text-[var(--muted)]",
};

export const TONE_DOT: Record<Tone, string> = {
  stop: "bg-[var(--stop)]",
  warn: "bg-[var(--warn)]",
  good: "bg-[var(--good)]",
  muted: "bg-[var(--muted)]",
};

/** One line that says where the account stands and what happens next. */
export function standing(site: SiteSummary): { text: string; tone: Tone } {
  if (site.status === "cancelled") return { text: "Cancelled · not billed", tone: "muted" };
  if (site.status === "suspended") return { text: `Paused · ${formatKes(site.overdueKes)} overdue`, tone: "stop" };
  if (site.overdueKes > 0) {
    return {
      text: site.suspendAfter
        ? `${formatKes(site.overdueKes)} overdue · pauses ${formatDate(site.suspendAfter)}`
        : `${formatKes(site.overdueKes)} overdue · notice goes out on the next daily run`,
      tone: "warn",
    };
  }
  if (site.balanceKes > 0) {
    return { text: `${formatKes(site.balanceKes)} due${site.nextDueDate ? ` ${formatDate(site.nextDueDate)}` : ""}`, tone: "muted" };
  }
  return { text: site.creditKes > 0 ? `Paid up · ${formatKes(site.creditKes)} credit` : "Paid up", tone: "good" };
}

/** Build fee paid so far: payments settle the oldest bills (the build) first. */
export function buildProgress(site: SiteSummary): { paidKes: number; totalKes: number } | null {
  if (site.setupFeeKes <= 0) return null;
  return { paidKes: Math.min(site.paidKes, site.setupFeeKes), totalKes: site.setupFeeKes };
}
