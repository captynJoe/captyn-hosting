"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type HostingServiceStatus = "active" | "payment_due" | "overdue" | "grace_period" | "suspended" | "cancelled";

type HostingInvoiceSummary = {
  id: string;
  status: "pending" | "paid" | "overdue" | "void";
  dueDate: string;
  amountKes: number;
};

type HostingServiceRow = {
  id: string;
  customerName: string;
  customerEmail: string;
  domain: string;
  planName: string;
  monthlyPriceKes: number;
  status: HostingServiceStatus;
  createdAt: string;
  latestInvoice: HostingInvoiceSummary | null;
};

type Summary = {
  activeCount: number;
  totalCount: number;
  mrrKes: number;
  overdueInvoiceCount: number;
};

const STATUS_BADGE_CLASS: Record<HostingServiceStatus, string> = {
  active: "bg-emerald-100 text-emerald-800",
  payment_due: "bg-amber-100 text-amber-800",
  overdue: "bg-red-100 text-red-800",
  grace_period: "bg-orange-100 text-orange-800",
  suspended: "bg-slate-200 text-slate-700",
  cancelled: "bg-slate-100 text-slate-500",
};

function formatKes(value: number): string {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(value);
}

const EMPTY_FORM = {
  customerName: "",
  customerEmail: "",
  customerPhone: "",
  domain: "",
  planName: "",
  monthlyPriceKes: "",
  billingDayOfMonth: "1",
};

export default function DashboardPage() {
  const router = useRouter();
  const [services, setServices] = useState<HostingServiceRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/services", { cache: "no-store" });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Failed to load hosting services.");
      setServices(data.services || []);
      setSummary(data.summary || null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load hosting services.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createService() {
    setCreating(true);
    setMessage(null);
    try {
      const response = await fetch("/api/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          monthlyPriceKes: Number(form.monthlyPriceKes),
          billingDayOfMonth: Number(form.billingDayOfMonth),
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Failed to create hosting service.");
      setMessage("Hosting service created.");
      setForm(EMPTY_FORM);
      setShowCreate(false);
      await load();
    } catch (createError) {
      setMessage(createError instanceof Error ? createError.message : "Failed to create hosting service.");
    } finally {
      setCreating(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">CAPTYN Hosting</h1>
          <p className="mt-1 text-sm text-slate-500">
            Managed websites CAPTYN hosts and bills on behalf of customers.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowCreate((v) => !v)}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            {showCreate ? "Cancel" : "New service"}
          </button>
          <button
            onClick={logout}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Sign out
          </button>
        </div>
      </div>

      {summary && (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">Active services</p>
            <p className="mt-1 text-lg font-semibold">{summary.activeCount}</p>
          </div>
          <div className="rounded-xl border px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">MRR</p>
            <p className="mt-1 text-lg font-semibold">{formatKes(summary.mrrKes)}</p>
          </div>
          <div className="rounded-xl border px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">Overdue invoices</p>
            <p className="mt-1 text-lg font-semibold text-red-600">{summary.overdueInvoiceCount}</p>
          </div>
          <div className="rounded-xl border px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">Total services</p>
            <p className="mt-1 text-lg font-semibold">{summary.totalCount}</p>
          </div>
        </div>
      )}

      {message && (
        <div className="mt-6 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
          {message}
        </div>
      )}

      {showCreate && (
        <div className="mt-6 rounded-xl border p-5">
          <h2 className="text-sm font-semibold">Create hosting service</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <input
              placeholder="Customer name"
              value={form.customerName}
              onChange={(e) => setForm((f) => ({ ...f, customerName: e.target.value }))}
              className="rounded-md border px-3 py-2 text-sm"
            />
            <input
              placeholder="Customer email"
              value={form.customerEmail}
              onChange={(e) => setForm((f) => ({ ...f, customerEmail: e.target.value }))}
              className="rounded-md border px-3 py-2 text-sm"
            />
            <input
              placeholder="Customer phone (optional)"
              value={form.customerPhone}
              onChange={(e) => setForm((f) => ({ ...f, customerPhone: e.target.value }))}
              className="rounded-md border px-3 py-2 text-sm"
            />
            <input
              placeholder="Domain (e.g. devoilessentials.com)"
              value={form.domain}
              onChange={(e) => setForm((f) => ({ ...f, domain: e.target.value }))}
              className="rounded-md border px-3 py-2 text-sm"
            />
            <input
              placeholder="Plan name (e.g. Managed Basic)"
              value={form.planName}
              onChange={(e) => setForm((f) => ({ ...f, planName: e.target.value }))}
              className="rounded-md border px-3 py-2 text-sm"
            />
            <input
              type="number"
              placeholder="Monthly price (KES)"
              value={form.monthlyPriceKes}
              onChange={(e) => setForm((f) => ({ ...f, monthlyPriceKes: e.target.value }))}
              className="rounded-md border px-3 py-2 text-sm"
            />
            <input
              type="number"
              min={1}
              max={28}
              placeholder="Billing day of month"
              value={form.billingDayOfMonth}
              onChange={(e) => setForm((f) => ({ ...f, billingDayOfMonth: e.target.value }))}
              className="rounded-md border px-3 py-2 text-sm"
            />
          </div>
          <button
            onClick={createService}
            disabled={creating}
            className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {creating ? "Creating..." : "Create service"}
          </button>
        </div>
      )}

      {error && (
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mt-6 overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-900">
              <th className="px-4 py-3">Business</th>
              <th className="px-4 py-3">Domain</th>
              <th className="px-4 py-3">Plan</th>
              <th className="px-4 py-3">Monthly</th>
              <th className="px-4 py-3">Latest invoice</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">Loading...</td>
              </tr>
            ) : services.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">No hosting services yet.</td>
              </tr>
            ) : (
              services.map((service) => (
                <tr key={service.id} className="border-b last:border-0">
                  <td className="px-4 py-3">
                    <Link href={`/services/${service.id}`} className="font-medium text-blue-600 hover:underline">
                      {service.customerName}
                    </Link>
                    <p className="text-xs text-slate-400">{service.customerEmail}</p>
                  </td>
                  <td className="px-4 py-3">{service.domain}</td>
                  <td className="px-4 py-3">{service.planName}</td>
                  <td className="px-4 py-3">{formatKes(service.monthlyPriceKes)}</td>
                  <td className="px-4 py-3">
                    {service.latestInvoice ? (
                      <span className={service.latestInvoice.status === "overdue" ? "text-red-600" : ""}>
                        {formatKes(service.latestInvoice.amountKes)} · {service.latestInvoice.status}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_BADGE_CLASS[service.status]}`}>
                      {service.status.replace(/_/g, " ")}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
