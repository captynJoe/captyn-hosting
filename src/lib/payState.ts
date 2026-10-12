import { prisma } from "@/lib/prisma";
import { loadServiceLedger, syncService } from "@/lib/hostingBilling";

export type PayState = {
  domain: string;
  customerName: string;
  balanceKes: number;
  overdueKes: number;
  dueDate: Date | null;
  suspendAfter: Date | null;
  paused: boolean;
  payToken: string | null;
  payment: "pending" | "completed" | "failed" | null;
};

/**
 * What a payer needs: the balance for the service behind a pay token or a
 * domain, and (with a checkout id) whether that M-Pesa attempt has landed.
 */
export async function loadPayState(
  where: { payToken: string } | { domain: string },
  checkoutRequestId?: string | null
): Promise<PayState | null> {
  let serviceId: string | null = null;
  if ("payToken" in where) {
    const invoice = await prisma.hostingInvoice.findUnique({
      where: { payToken: where.payToken },
      select: { hostingServiceId: true },
    });
    serviceId = invoice?.hostingServiceId ?? null;
  } else {
    const service = await prisma.hostingService.findFirst({
      where: { domain: { equals: where.domain, mode: "insensitive" }, status: { not: "cancelled" } },
      select: { id: true },
    });
    serviceId = service?.id ?? null;
  }
  if (!serviceId) return null;

  let payment: PayState["payment"] = null;
  if (checkoutRequestId) {
    const attempt = await prisma.hostingPayment.findFirst({
      where: { checkoutRequestId, hostingServiceId: serviceId },
      select: { status: true },
    });
    payment = attempt?.status ?? null;
    // A landed payment can lift a pause right away.
    if (payment === "completed") await syncService(serviceId);
  }

  const loaded = await loadServiceLedger(serviceId);
  if (!loaded) return null;
  const { service, ledger } = loaded;
  return {
    domain: service.domain,
    customerName: service.customerName,
    balanceKes: Math.round(ledger.balanceKes),
    overdueKes: Math.round(ledger.overdueKes),
    dueDate: ledger.firstOpen?.dueDate ?? null,
    suspendAfter: service.suspendAfter,
    paused: service.status === "suspended" && ledger.overdueKes > 0,
    // Any of the service's invoices pays its balance; use the oldest open
    // one, or the latest for a fully paid account so the link still works.
    payToken: ledger.firstOpen?.payToken ?? ledger.invoices[ledger.invoices.length - 1]?.payToken ?? null,
    payment,
  };
}
