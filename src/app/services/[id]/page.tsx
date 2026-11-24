"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { buildProgress, formatDate, formatKes, standing, TONE_TEXT, type SiteSummary } from "@/app/ui";

type Bill = {
  id: string;
  label: string;
  isCharge: boolean;
  description: string | null;
  dueDate: string;
  amountKes: number;
  paidKes: number;
  openKes: number;
  status: "pending" | "paid" | "overdue" | "void" | "upcoming";
};

type Payment = {
  id: string;
  amountKes: number;
  method: "mpesa" | "manual";
  receipt: string | null;
  note: string | null;
  paidAt: string;
};

type SiteDetail = SiteSummary & { invoices: Bill[]; payments: Payment[] };

type StatementRow =
  | { kind: "bill"; date: string; bill: Bill }
  | { kind: "payment"; date: string; payment: Payment };

const inputClass =
  "w-full rounded-lg border border-[var(--line)] px-3 py-2 text-sm placeholder:text-[var(--muted)] focus:border-[var(--ink)] focus:outline-none";
const primaryButton = "rounded-lg bg-[var(--btn)] px-4 py-2 text-sm font-semibold text-[var(--btn-ink)] disabled:opacity-60";
const secondaryButton =
  "rounded-lg border border-[var(--line)] px-4 py-2 text-sm font-medium hover:border-[var(--muted)] disabled:opacity-60";

function billState(bill: Bill): { text: string; className: string } {
  if (bill.status === "upcoming") return { text: "Upcoming", className: "text-[var(--muted)]" };
  if (bill.openKes <= 0) return { text: "Paid", className: "text-[var(--good)]" };
  const part = bill.paidKes > 0 ? `${formatKes(bill.openKes)} left` : null;
  if (bill.status === "overdue") return { text: part || "Overdue", className: "text-[var(--warn)]" };
  return { text: part || "Due", className: "text-[var(--muted)]" };
}

export default function SitePage() {
  const params = useParams();
  const router = useRouter();
  const id = typeof params?.id === "string" ? params.id : "";

  const [site, setSite] = useState<SiteDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [paying, setPaying] = useState(false);
  const [charging, setCharging] = useState(false);
  const [charge, setCharge] = useState({ description: "", amountKes: "", dueDate: "" });
  const [payment, setPayment] = useState({ amountKes: "", paidAt: "", receipt: "", note: "", emailReceipt: true });
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<{ id: string; amountKes: string; dueDate: string; description: string } | null>(null);

  const applySite = useCallback((next: SiteDetail) => {
    setSite(next);
    setSettings({
      domain: next.domain,
      billingStartsAt: next.billingStartsAt ? next.billingStartsAt.slice(0, 10) : "",
      customerName: next.customerName,
      customerEmail: next.customerEmail,
      customerPhone: next.customerPhone || "",
      monthlyPriceKes: String(next.monthlyPriceKes),
      setupFeeKes: String(next.setupFeeKes || ""),
      setupInstallmentKes: String(next.setupInstallmentKes || ""),
      graceDays: String(next.graceDays),
      notes: next.notes || "",
    });
  }, []);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const response = await fetch(`/api/services/${id}`, { cache: "no-store" });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Couldn't load this site.");
      applySite(data.service);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Couldn't load this site.");
    } finally {
      setLoading(false);
    }
  }, [id, applySite]);

  useEffect(() => {
    void load();
  }, [load]);

  async function call(url: string, init: RequestInit, done: string) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(url, {
        ...init,
        headers: { "Content-Type": "application/json" },
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "That didn't work. Try again.");
      setMessage({ text: done, ok: true });
      await load();
      return true;
    } catch (callError) {
      setMessage({ text: callError instanceof Error ? callError.message : "That didn't work.", ok: false });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function recordPayment() {
    const ok = await call(
      `/api/services/${id}/payments`,
      { method: "POST", body: JSON.stringify({ ...payment, amountKes: Number(payment.amountKes) }) },
      `${formatKes(Number(payment.amountKes))} recorded.`
    );
    if (ok) {
      setPaying(false);
      setPayment({ amountKes: "", paidAt: "", receipt: "", note: "", emailReceipt: true });
    }
  }

  async function addCharge() {
    const ok = await call(
      `/api/services/${id}/charges`,
      { method: "POST", body: JSON.stringify({ ...charge, amountKes: Number(charge.amountKes) }) },
      `${formatKes(Number(charge.amountKes))} added for ${charge.description}.`
    );
    if (ok) {
      setCharging(false);
      setCharge({ description: "", amountKes: "", dueDate: "" });
    }
  }

  async function saveBill() {
    if (!editing) return;
    const ok = await call(
      `/api/services/${id}/invoices/${editing.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          amountKes: Number(editing.amountKes),
          dueDate: editing.dueDate,
          ...(editing.description ? { description: editing.description } : {}),
        }),
      },
      "Bill updated."
    );
    if (ok) setEditing(null);
  }

  function removeBill(bill: Bill) {
    if (window.confirm(`Remove "${bill.label}" (${formatKes(bill.amountKes)})? It stops counting toward the balance.`)) {
      void call(`/api/services/${id}/invoices/${bill.id}`, { method: "DELETE" }, "Bill removed.");
    }
  }

  function removePayment(p: Payment) {
    if (window.confirm(`Remove the ${formatKes(p.amountKes)} payment from ${formatDate(p.paidAt)}? The balance goes back up.`)) {
      void call(`/api/services/${id}/payments/${p.id}`, { method: "DELETE" }, "Payment removed.");
    }
  }

  async function removeSite() {
    if (!site || !window.confirm(`Permanently remove ${site.domain} from Captyn Hosting? Its invoices and payment history will also be deleted. This cannot be undone.`)) {
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/services/${id}`, { method: "DELETE" });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Couldn't remove this site.");
      router.push("/");
    } catch (removeError) {
      setMessage({ text: removeError instanceof Error ? removeError.message : "Couldn't remove this site.", ok: false });
    } finally {
      setBusy(false);
    }
  }

  function openPayment() {
    setCharging(false);
    setPaying((v) => !v);
    setPayment((p) => ({ ...p, amountKes: site && site.balanceKes > 0 ? String(Math.round(site.balanceKes)) : "" }));
  }

  async function copyPayLink() {
    if (!site?.payUrl) return;
    try {
      await navigator.clipboard.writeText(site.payUrl);
      setMessage({ text: "Pay link copied.", ok: true });
    } catch {
      setMessage({ text: site.payUrl, ok: true });
    }
  }

  if (loading) {
    return <div className="mx-auto max-w-4xl px-4 py-10 text-sm text-[var(--muted)]">Loading...</div>;
  }

  if (error || !site) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10">
        <Link href="/" className="text-sm text-[var(--muted)] hover:text-[var(--ink)]">
          ← Sites
        </Link>
        <p className="mt-4 text-sm text-[var(--stop)]">{error || "Site not found."}</p>
      </div>
    );
  }

  const state = standing(site);
  const build = buildProgress(site);
  const canExtend = site.status === "suspended" || (site.overdueKes > 0 && site.suspendAfter);
  const statement: StatementRow[] = [
    ...site.invoices.map((bill) => ({ kind: "bill" as const, date: bill.dueDate, bill })),
    ...site.payments.map((p) => ({ kind: "payment" as const, date: p.paidAt, payment: p })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:py-10">
      <Link href="/" className="text-sm text-[var(--muted)] hover:text-[var(--ink)]">
        ← Sites
      </Link>

      <header className="mt-3">
        <a
          href={`https://${site.domain}`}
          target="_blank"
          rel="noreferrer"
          className="break-all text-2xl font-semibold hover:underline"
        >
          {site.domain}
        </a>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {site.customerName} · {site.customerEmail}
          {site.customerPhone ? ` · ${site.customerPhone}` : ""}
        </p>
      </header>

      <section className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5">
        <p className="text-4xl font-bold tracking-tight">{formatKes(site.balanceKes)}</p>
        <p className={`mt-1 text-sm font-medium ${TONE_TEXT[state.tone]}`}>{state.text}</p>
        <p className="mt-1 text-xs text-[var(--muted)]">
          {site.status === "suspended" ? "Site paused" : site.status === "cancelled" ? "Not billed" : "Site online"}
          {site.reminderSentAt ? ` · last emailed ${formatDate(site.reminderSentAt)}` : " · not emailed yet"}
        </p>

        {build && (
          <div className="mt-4 max-w-sm">
            <div className="h-1.5 overflow-hidden rounded-full bg-[var(--soft)]">
              <div
                className="h-full rounded-full bg-[var(--ink)]"
                style={{ width: `${Math.round((build.paidKes / build.totalKes) * 100)}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Build {formatKes(build.paidKes)} of {formatKes(build.totalKes)} paid
              {site.setupInstallmentKes > 0 ? ` · ${formatKes(site.setupInstallmentKes)}/month` : ""}, then{" "}
              {formatKes(site.monthlyPriceKes)}/month hosting
            </p>
          </div>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          <button onClick={openPayment} disabled={busy} className={primaryButton}>
            Record payment
          </button>
          {site.balanceKes > 0 && site.status !== "cancelled" && (
            <button
              onClick={() => call(`/api/services/${id}/invoices`, { method: "POST" }, `Invoice sent to ${site.customerEmail}.`)}
              disabled={busy}
              className={secondaryButton}
            >
              Email invoice
            </button>
          )}
          {site.invoiceUrl && (
            <a href={site.invoiceUrl} target="_blank" rel="noreferrer" className={secondaryButton}>
              View invoice
            </a>
          )}
          {site.status === "suspended" && !site.manualPause && canExtend && (
            <button
              onClick={() =>
                call(
                  `/api/services/${id}`,
                  { method: "PATCH", body: JSON.stringify({ extendDays: 7 }) },
                  "Site back online for 7 days."
                )
              }
              disabled={busy}
              className={secondaryButton}
            >
              Unpause for 7 days
            </button>
          )}
          {site.suspendAfter &&
            site.overdueKes > 0 &&
            (site.status === "overdue" || (site.status === "suspended" && site.manualPause)) && (
            <button
              onClick={() =>
                call(`/api/services/${id}`, { method: "PATCH", body: JSON.stringify({ repause: true }) }, "Site paused for overdue balance.")
              }
              disabled={busy}
              className={secondaryButton}
            >
              Repause
            </button>
          )}
          {site.payUrl && site.balanceKes > 0 && (
            <button onClick={copyPayLink} className={secondaryButton}>
              Copy pay link
            </button>
          )}
          {site.status !== "cancelled" && (
            <button
              onClick={() => {
                setPaying(false);
                setCharging((v) => !v);
              }}
              disabled={busy}
              className={secondaryButton}
            >
              Add charge
            </button>
          )}
        </div>

        {message && (
          <p className={`mt-3 break-all text-sm ${message.ok ? "text-[var(--good)]" : "text-[var(--stop)]"}`}>{message.text}</p>
        )}

        {charging && (
          <div className="mt-5 border-t border-[var(--line)] pt-5">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="text-xs text-[var(--muted)] sm:col-span-3">
                What it's for
                <input
                  value={charge.description}
                  onChange={(e) => setCharge((c) => ({ ...c, description: e.target.value }))}
                  className={`${inputClass} mt-1`}
                />
              </label>
              <label className="text-xs text-[var(--muted)]">
                Amount (KSh)
                <input
                  type="number"
                  min={1}
                  value={charge.amountKes}
                  onChange={(e) => setCharge((c) => ({ ...c, amountKes: e.target.value }))}
                  className={`${inputClass} mt-1`}
                />
              </label>
              <label className="text-xs text-[var(--muted)]">
                Due
                <input
                  type="date"
                  value={charge.dueDate}
                  onChange={(e) => setCharge((c) => ({ ...c, dueDate: e.target.value }))}
                  className={`${inputClass} mt-1`}
                />
              </label>
            </div>
            <button
              onClick={addCharge}
              disabled={busy || !charge.description.trim() || !(Number(charge.amountKes) > 0)}
              className={`${primaryButton} mt-4`}
            >
              Add {Number(charge.amountKes) > 0 ? formatKes(Number(charge.amountKes)) : "charge"}
            </button>
          </div>
        )}

        {paying && (
          <div className="mt-5 border-t border-[var(--line)] pt-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-[var(--muted)]">
                Amount received (KSh)
                <input
                  type="number"
                  min={1}
                  value={payment.amountKes}
                  onChange={(e) => setPayment((p) => ({ ...p, amountKes: e.target.value }))}
                  className={`${inputClass} mt-1`}
                />
              </label>
              <label className="text-xs text-[var(--muted)]">
                Date received
                <input
                  type="date"
                  value={payment.paidAt}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setPayment((p) => ({ ...p, paidAt: e.target.value }))}
                  className={`${inputClass} mt-1`}
                />
              </label>
              <input
                placeholder="M-Pesa code (optional)"
                value={payment.receipt}
                onChange={(e) => setPayment((p) => ({ ...p, receipt: e.target.value }))}
                className={inputClass}
              />
              <input
                placeholder="Note (optional)"
                value={payment.note}
                onChange={(e) => setPayment((p) => ({ ...p, note: e.target.value }))}
                className={inputClass}
              />
            </div>
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={payment.emailReceipt}
                onChange={(e) => setPayment((p) => ({ ...p, emailReceipt: e.target.checked }))}
              />
              Email a receipt to {site.customerEmail}
            </label>
            <button
              onClick={recordPayment}
              disabled={busy || !(Number(payment.amountKes) > 0)}
              className={`${primaryButton} mt-4`}
            >
              Save {Number(payment.amountKes) > 0 ? formatKes(Number(payment.amountKes)) : "payment"}
            </button>
          </div>
        )}
      </section>

      <section className="mt-8">
        <h2 className="font-semibold">Statement</h2>
        <div className="mt-3 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)]">
          {statement.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-[var(--muted)]">No bills yet.</p>
          ) : (
            <ul className="divide-y divide-[var(--line)]">
              {statement.map((row) =>
                row.kind === "bill" ? (
                  <li key={`b-${row.bill.id}`} className="px-5 py-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                      <div className="min-w-0">
                        <p>{row.bill.label}</p>
                        <p className="text-xs text-[var(--muted)]">
                          Due {formatDate(row.bill.dueDate)}
                          {row.bill.openKes > 0 && editing?.id !== row.bill.id && (
                            <>
                              {" · "}
                              <button
                                onClick={() =>
                                  setEditing({
                                    id: row.bill.id,
                                    amountKes: String(row.bill.amountKes),
                                    dueDate: row.bill.dueDate.slice(0, 10),
                                    description: row.bill.description || "",
                                  })
                                }
                                className="underline hover:text-[var(--ink)]"
                              >
                                Edit
                              </button>
                              {" · "}
                              <button onClick={() => removeBill(row.bill)} className="underline hover:text-[var(--stop)]">
                                Remove
                              </button>
                            </>
                          )}
                        </p>
                      </div>
                      <div className="text-right">
                        <p>{formatKes(row.bill.amountKes)}</p>
                        <p className={`text-xs ${billState(row.bill).className}`}>{billState(row.bill).text}</p>
                      </div>
                    </div>
                    {editing?.id === row.bill.id && (
                      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_8rem_10rem_auto] sm:items-end">
                        {row.bill.isCharge ? (
                          <input
                            value={editing.description}
                            onChange={(e) => setEditing((b) => b && { ...b, description: e.target.value })}
                            className={inputClass}
                          />
                        ) : (
                          <span />
                        )}
                        <input
                          type="number"
                          min={1}
                          value={editing.amountKes}
                          onChange={(e) => setEditing((b) => b && { ...b, amountKes: e.target.value })}
                          className={inputClass}
                        />
                        <input
                          type="date"
                          value={editing.dueDate}
                          onChange={(e) => setEditing((b) => b && { ...b, dueDate: e.target.value })}
                          className={inputClass}
                        />
                        <div className="flex gap-2">
                          <button onClick={saveBill} disabled={busy} className={primaryButton}>
                            Save
                          </button>
                          <button onClick={() => setEditing(null)} className={secondaryButton}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                ) : (
                  <li key={`p-${row.payment.id}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 bg-[var(--soft)] px-5 py-3 text-sm">
                    <div className="min-w-0">
                      <p>
                        Payment · {row.payment.method === "mpesa" ? "M-Pesa" : "recorded"}
                        {row.payment.receipt ? ` · ${row.payment.receipt}` : ""}
                      </p>
                      <p className="text-xs text-[var(--muted)]">
                        {formatDate(row.payment.paidAt)}
                        {row.payment.note ? ` · ${row.payment.note}` : ""}
                        {" · "}
                        <button onClick={() => removePayment(row.payment)} className="underline hover:text-[var(--stop)]">
                          Remove
                        </button>
                      </p>
                    </div>
                    <p className="font-medium text-[var(--good)]">−{formatKes(row.payment.amountKes)}</p>
                  </li>
                )
              )}
            </ul>
          )}
        </div>
      </section>

      <details className="mt-8 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5">
        <summary className="cursor-pointer font-semibold">Settings</summary>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {(
            [
              ["domain", "Domain", "text"],
              ["billingStartsAt", "First bill date", "date"],
              ["customerName", "Business name", "text"],
              ["customerEmail", "Billing emails, comma-separated", "text"],
              ["customerPhone", "M-Pesa phone", "tel"],
              ["monthlyPriceKes", "Hosting per month (KSh)", "number"],
              ["setupFeeKes", "Build fee (KSh)", "number"],
              ["setupInstallmentKes", "Build fee per month (KSh)", "number"],
              ["graceDays", "Days from first overdue notice to pause", "number"],
            ] as const
          ).map(([key, label, type]) => (
            <label key={key} className="text-xs text-[var(--muted)]">
              {label}
              <input
                type={type}
                value={settings[key] ?? ""}
                onChange={(e) => setSettings((s) => ({ ...s, [key]: e.target.value }))}
                className={`${inputClass} mt-1`}
              />
            </label>
          ))}
        </div>
        <label className="mt-3 block text-xs text-[var(--muted)]">
          Notes (only you see these)
          <textarea
            rows={3}
            value={settings.notes ?? ""}
            onChange={(e) => setSettings((s) => ({ ...s, notes: e.target.value }))}
            className={`${inputClass} mt-1`}
          />
        </label>
        <p className="mt-3 text-xs text-[var(--muted)]">Price changes apply to bills not yet created. The first bill date can only change before a payment is recorded.</p>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <button
            onClick={() => call(`/api/services/${id}`, { method: "PATCH", body: JSON.stringify(settings) }, "Saved.")}
            disabled={busy}
            className={primaryButton}
          >
            Save
          </button>
          <div className="flex flex-wrap items-center gap-4">
          {site.status !== "cancelled" &&
            (site.manualPause ? (
              <button
                onClick={() => call(`/api/services/${id}`, { method: "PATCH", body: JSON.stringify({ pause: false }) }, "Site resumed.")}
                disabled={busy}
                className="text-sm font-medium text-[var(--good)] hover:underline"
              >
                Resume site
              </button>
            ) : (
              <button
                onClick={() => {
                  if (window.confirm(`Pause ${site.domain} now? Visitors see "temporarily unavailable" until you resume it.`)) {
                    void call(`/api/services/${id}`, { method: "PATCH", body: JSON.stringify({ pause: true }) }, "Site paused.");
                  }
                }}
                disabled={busy}
                className="text-sm text-[var(--stop)] hover:underline"
              >
                Pause site now
              </button>
            ))}
          {site.status === "cancelled" ? (
            <button
              onClick={() => call(`/api/services/${id}`, { method: "PATCH", body: JSON.stringify({ reactivate: true }) }, "Billing resumed.")}
              disabled={busy}
              className="text-sm text-[var(--muted)] hover:text-[var(--ink)]"
            >
              Resume billing
            </button>
          ) : (
            <button
              onClick={() => {
                if (window.confirm(`Stop billing ${site.domain}? No more bills or reminders go out.`)) {
                  void call(`/api/services/${id}`, { method: "PATCH", body: JSON.stringify({ cancel: true }) }, "Billing stopped.");
                }
              }}
              disabled={busy}
              className="text-sm text-[var(--stop)] hover:underline"
            >
              Stop billing
            </button>
          )}
          </div>
        </div>
        <div className="mt-5 border-t border-[var(--line)] pt-4">
          <button
            onClick={() => void removeSite()}
            disabled={busy}
            className="text-sm font-medium text-[var(--stop)] hover:underline disabled:opacity-60"
          >
            Remove site from Captyn Hosting
          </button>
        </div>
      </details>
    </div>
  );
}
