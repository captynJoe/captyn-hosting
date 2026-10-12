// Pure billing rules, no database access. Balance = invoices - completed
// payments; payments settle invoices oldest first, so a partial payment
// needs no allocation record and an overpayment carries forward.

export type ServiceStatus = "active" | "payment_due" | "overdue" | "grace_period" | "suspended" | "cancelled";
export type InvoiceStatus = "pending" | "paid" | "overdue" | "void";

export const DAY_MS = 24 * 60 * 60 * 1000;
const SETTLED_EPSILON_KES = 0.5;

export type LedgerInvoiceInput = {
  id: string;
  dueDate: Date;
  periodStartsAt: Date;
  periodEndsAt: Date;
  amountKes: number;
  setupPortionKes: number;
  status: InvoiceStatus;
  payToken: string;
};

export type LedgerInvoice = LedgerInvoiceInput & {
  paidKes: number;
  openKes: number;
  late: boolean;
  nextStatus: InvoiceStatus;
};

export type Ledger = {
  invoices: LedgerInvoice[];
  invoicedKes: number;
  paidKes: number;
  balanceKes: number;
  creditKes: number;
  overdueKes: number;
  oldestOverdueDueDate: Date | null;
  firstOpen: LedgerInvoice | null;
  setupBilledKes: number;
};

export function computeLedger(invoices: LedgerInvoiceInput[], paidKes: number, now: Date): Ledger {
  const live = invoices
    .filter((invoice) => invoice.status !== "void")
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());

  let unapplied = paidKes;
  const rows: LedgerInvoice[] = live.map((invoice) => {
    const applied = Math.min(invoice.amountKes, Math.max(0, unapplied));
    unapplied -= applied;
    const remaining = invoice.amountKes - applied;
    const openKes = remaining < SETTLED_EPSILON_KES ? 0 : remaining;
    // Late from the day after the due date.
    const late = openKes > 0 && now.getTime() >= invoice.dueDate.getTime() + DAY_MS;
    return {
      ...invoice,
      paidKes: applied,
      openKes,
      late,
      nextStatus: openKes === 0 ? "paid" : late ? "overdue" : "pending",
    };
  });

  const invoicedKes = rows.reduce((sum, row) => sum + row.amountKes, 0);
  const lateRows = rows.filter((row) => row.late);
  const balance = invoicedKes - paidKes;

  return {
    invoices: rows,
    invoicedKes,
    paidKes,
    balanceKes: balance < SETTLED_EPSILON_KES ? 0 : balance,
    creditKes: balance < 0 ? -balance : 0,
    overdueKes: lateRows.reduce((sum, row) => sum + row.openKes, 0),
    oldestOverdueDueDate: lateRows[0]?.dueDate ?? null,
    firstOpen: rows.find((row) => row.openKes > 0) ?? null,
    setupBilledKes: invoices
      .filter((invoice) => invoice.status !== "void")
      .reduce((sum, invoice) => sum + invoice.setupPortionKes, 0),
  };
}

export type ChargeRules = {
  monthlyPriceKes: number;
  setupFeeKes: number;
  setupInstallmentKes: number;
};

/**
 * What the next month bills: a build-fee installment while any of the build
 * fee is unbilled, then the monthly hosting price.
 */
export function nextInvoiceCharge(
  rules: ChargeRules,
  setupBilledKes: number
): { amountKes: number; setupPortionKes: number } {
  const setupLeft = Math.max(0, rules.setupFeeKes - setupBilledKes);
  if (setupLeft >= SETTLED_EPSILON_KES) {
    const installment = rules.setupInstallmentKes > 0 ? Math.min(rules.setupInstallmentKes, setupLeft) : setupLeft;
    return { amountKes: installment, setupPortionKes: installment };
  }
  return { amountKes: rules.monthlyPriceKes, setupPortionKes: 0 };
}

export type ServiceStateInput = {
  status: ServiceStatus;
  suspendAfter: Date | null;
};

/**
 * Status follows the ledger: paid up -> active, a bill not yet due ->
 * payment_due, past due -> overdue, and suspended once the pause date has
 * passed. The pause date is set only when the overdue notice carrying it is
 * sent (see the billing cycle), so a warning always comes first. Clearing
 * the overdue amount lifts a pause. Cancelled is the one status set by hand.
 */
export function nextServiceState(
  service: ServiceStateInput,
  ledger: Pick<Ledger, "overdueKes" | "balanceKes">,
  now: Date
): { status: ServiceStatus; suspendAfter: Date | null } {
  if (service.status === "cancelled") {
    return { status: "cancelled", suspendAfter: service.suspendAfter };
  }

  if (ledger.overdueKes > 0) {
    const { suspendAfter } = service;
    if (service.status === "suspended" || (suspendAfter && now.getTime() >= suspendAfter.getTime())) {
      return { status: "suspended", suspendAfter };
    }
    return { status: "overdue", suspendAfter };
  }

  return { status: ledger.balanceKes > 0 ? "payment_due" : "active", suspendAfter: null };
}

export function normalizeDomain(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .replace(/^www\./, "");
}

/** A bare hostname like example.co.ke: no @, spaces, scheme or path. */
export function isValidDomain(value: string): boolean {
  return /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(value);
}
