import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadServiceLedger } from "@/lib/hostingBilling";
import { buildInvoice, invoiceKindFor, renderInvoiceHtml } from "@/lib/invoiceDoc";
import { renderNotFoundPage } from "@/lib/payPage";

const HTML_HEADERS = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" };

/** The current invoice for the account behind a pay token, printable. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const invoice = await prisma.hostingInvoice.findUnique({ where: { payToken: token }, select: { hostingServiceId: true } });
  const loaded = invoice ? await loadServiceLedger(invoice.hostingServiceId) : null;
  const doc = loaded ? await buildInvoice(loaded.service, loaded.ledger, invoiceKindFor(loaded.service, loaded.ledger)) : null;
  if (!doc) return new Response(renderNotFoundPage(), { status: 404, headers: HTML_HEADERS });
  return new Response(renderInvoiceHtml(doc, { printable: true }), { headers: HTML_HEADERS });
}
