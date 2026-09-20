"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";

type HostingServiceStatus = "active" | "payment_due" | "overdue" | "grace_period" | "suspended" | "cancelled";
type HostingInvoiceStatus = "pending" | "paid" | "overdue" | "void";

type HostingInvoice = {
  id: string;
  periodStartsAt: string;
  periodEndsAt: string;
  dueDate: string;
  amountKes: number;
  status: HostingInvoiceStatus;
  paidAt: string | null;
  mpesaReceiptNumber: string | null;
  payToken: string;
};

type HostingService = {
  id: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  domain: string;
  planName: string;
  monthlyPriceKes: number;
  billingDayOfMonth: number;
  graceDays: number;
  invoiceLeadDays: number;
  status: HostingServiceStatus;
  notes: string | null;
  invoices: HostingInvoice[];
};

const STATUS_OPTIONS: HostingServiceStatus[] = [
  "active",
  "payment_due",
  "overdue",
  "grace_period",
  "suspended",
  "cancelled",
];

function formatKes(value: number): string {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(value);
}

export default function ServiceDetailPage() {
  const params = useParams();
  const id = typeof params?.id === "string" ? params.id : "";

  const [service, setService] = useState<HostingService | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/services/${id}`, { cache: "no-store" });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Failed to load hosting service.");
      setService(data.service);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load hosting service.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function updateStatus(status: HostingServiceStatus) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/services/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Failed to update status.");
      setMessage(`Status updated to ${status.replace(/_/g, " ")}.`);
      await load();
    } catch (updateError) {
      setMessage(updateError instanceof Error ? updateError.message : "Failed to update status.");
    } finally {
      setBusy(false);
    }
  }

  async function sendInvoiceNow() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/services/${id}/invoices`, { method: "POST" });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Failed to send invoice.");
      setMessage(data.emailSent ? "Invoice created and emailed." : "Invoice created, but email failed to send.");
      await load();
    } catch (sendError) {
      setMessage(sendError instanceof Error ? sendError.message : "Failed to send invoice.");
    } finally {
      setBusy(false);
    }
  }

  async function markPaid(invoiceId: string) {
    const note = window.prompt("Note for this manual payment record (optional):") || undefined;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/services/${id}/invoices/${invoiceId}/mark-paid`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Failed to mark invoice paid.");
      setMessage("Invoice marked as paid.");
      await load();
    } catch (markError) {
      setMessage(markError instanceof Error ? markError.message : "Failed to mark invoice paid.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <div className="mx-auto max-w-5xl px-4 py-8 text-slate-500">Loading...</div>;
  }

  if (error || !service) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error || "Hosting service not found."}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <Link href="/" className="text-sm text-blue-600 hover:underline">
        ← All services
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{service.customerName}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {service.domain} · {service.planName} · {formatKes(service.monthlyPriceKes)}/month
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {service.customerEmail} {service.customerPhone ? `· ${service.customerPhone}` : ""}
          </p>
        </div>
        <select
          value={service.status}
          disabled={busy}
          onChange={(e) => updateStatus(e.target.value as HostingServiceStatus)}
          className="rounded-lg border px-3 py-2 text-sm"
        >
          {STATUS_OPTIONS.map((status) => (
            <option key={status} value={status}>
              {status.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </div>

      {message && (
        <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
          {message}
        </div>
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        <button
          onClick={sendInvoiceNow}
          disabled={busy}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
        >
          Send invoice now
        </button>
      </div>

      <div className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Invoices</h2>
        <div className="mt-3 overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-900">
                <th className="px-4 py-3">Period</th>
                <th className="px-4 py-3">Due date</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Receipt</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {service.invoices.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    No invoices yet.
                  </td>
                </tr>
              ) : (
                service.invoices.map((invoice) => (
                  <tr key={invoice.id} className="border-b last:border-0">
                    <td className="px-4 py-3">
                      {new Date(invoice.periodStartsAt).toLocaleDateString()} –{" "}
                      {new Date(invoice.periodEndsAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">{new Date(invoice.dueDate).toLocaleDateString()}</td>
                    <td className="px-4 py-3">{formatKes(invoice.amountKes)}</td>
                    <td className="px-4 py-3">
                      <span className={invoice.status === "overdue" ? "text-red-600" : ""}>{invoice.status}</span>
                    </td>
                    <td className="px-4 py-3">{invoice.mpesaReceiptNumber || "—"}</td>
                    <td className="px-4 py-3">
                      {invoice.status !== "paid" && (
                        <button
                          onClick={() => markPaid(invoice.id)}
                          disabled={busy}
                          className="text-xs font-medium text-blue-600 hover:underline disabled:opacity-60"
                        >
                          Mark paid
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
