"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { buildProgress, formatDate, formatKes, standing, TONE_DOT, TONE_TEXT, type SiteSummary } from "@/app/ui";

type Summary = {
  owedKes: number;
  overdueKes: number;
  collectedThisMonthKes: number;
  monthlyHostingKes: number;
};

const EMPTY_FORM = {
  customerName: "",
  customerEmail: "",
  customerPhone: "",
  domain: "",
  monthlyPriceKes: "",
  billingStartsAt: new Date().toISOString().slice(0, 10),
  setupFeeKes: "",
  setupInstallmentKes: "",
};

const inputClass =
  "w-full rounded-lg border border-[var(--line)] px-3 py-2 text-sm placeholder:text-[var(--muted)] focus:border-[var(--ink)] focus:outline-none";

/** "3 past bills (KSh 9,000) are added now", so the operator sees the effect of the date before saving. */
function billingPreview(form: typeof EMPTY_FORM): string | null {
  const hosting = Number(form.monthlyPriceKes) || 0;
  const build = Number(form.setupFeeKes) || 0;
  const installment = Number(form.setupInstallmentKes) || build;
  if (!hosting) return null;
  const parts: string[] = [];
  if (build > 0) {
    const months = Math.ceil(build / Math.max(1, installment));
    parts.push(
      `${formatKes(Math.min(installment, build))}/month for ${months} month${months === 1 ? "" : "s"} (build), then ${formatKes(hosting)}/month`
    );
  } else {
    parts.push(`${formatKes(hosting)}/month`);
  }
  const start = new Date(`${form.billingStartsAt}T00:00:00Z`);
  if (!Number.isNaN(start.getTime())) {
    const now = new Date();
    let past = 0;
    const cursor = new Date(start);
    while (cursor.getTime() <= now.getTime() && past < 36) {
      past += 1;
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    if (past > 0) parts.push(`${past} bill${past === 1 ? "" : "s"} from ${formatDate(start)} to today are added now`);
  }
  return parts.join(" · ");
}

export default function DashboardPage() {
  const router = useRouter();
  const [sites, setSites] = useState<SiteSummary[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch("/api/services", { cache: "no-store" });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Couldn't load sites.");
      setSites(data.services || []);
      setSummary(data.summary || null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Couldn't load sites.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const preview = useMemo(() => billingPreview(form), [form]);
  const monthName = new Date().toLocaleDateString("en-KE", { month: "long" });

  async function addSite() {
    setSaving(true);
    setFormError(null);
    try {
      const response = await fetch("/api/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Couldn't add the site.");
      router.push(`/services/${data.service.id}`);
    } catch (addError) {
      setFormError(addError instanceof Error ? addError.message : "Couldn't add the site.");
      setSaving(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const field = (key: keyof typeof EMPTY_FORM) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value })),
  });

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:py-10">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">CAPTYN Hosting</h1>
        <div className="flex items-center gap-4">
          <button onClick={logout} className="text-sm text-[var(--muted)] hover:text-[var(--ink)]">
            Sign out
          </button>
          <button
            onClick={() => setAdding((v) => !v)}
            className="rounded-lg bg-[var(--btn)] px-4 py-2 text-sm font-semibold text-[var(--btn-ink)]"
          >
            {adding ? "Close" : "Add site"}
          </button>
        </div>
      </header>

      {summary && (
        <div className="mt-6 grid grid-cols-1 divide-y divide-[var(--line)] rounded-2xl border border-[var(--line)] bg-[var(--card)] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <div className="px-5 py-4">
            <p className="text-2xl font-semibold">{formatKes(summary.owedKes)}</p>
            <p className="text-sm text-[var(--muted)]">
              owed
              {summary.overdueKes > 0 && (
                <span className="text-[var(--warn)]"> · {formatKes(summary.overdueKes)} overdue</span>
              )}
            </p>
          </div>
          <div className="px-5 py-4">
            <p className="text-2xl font-semibold">{formatKes(summary.collectedThisMonthKes)}</p>
            <p className="text-sm text-[var(--muted)]">collected in {monthName}</p>
          </div>
          <div className="px-5 py-4">
            <p className="text-2xl font-semibold">{formatKes(summary.monthlyHostingKes)}</p>
            <p className="text-sm text-[var(--muted)]">hosting a month</p>
          </div>
        </div>
      )}

      {adding && (
        <section className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5">
          <h2 className="font-semibold">Add site</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <input placeholder="Domain" className={inputClass} {...field("domain")} />
            <input placeholder="Business name" className={inputClass} {...field("customerName")} />
            <input type="email" placeholder="Billing email" className={inputClass} {...field("customerEmail")} />
            <input type="tel" placeholder="M-Pesa phone" className={inputClass} {...field("customerPhone")} />
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-[var(--muted)]">
              Hosting per month (KSh)
              <input type="number" min={1} className={`${inputClass} mt-1`} {...field("monthlyPriceKes")} />
            </label>
            <label className="text-xs text-[var(--muted)]">
              First bill date
              <input type="date" className={`${inputClass} mt-1`} {...field("billingStartsAt")} />
            </label>
            <label className="text-xs text-[var(--muted)]">
              Build fee (KSh), if any
              <input type="number" min={0} className={`${inputClass} mt-1`} {...field("setupFeeKes")} />
            </label>
            <label className="text-xs text-[var(--muted)]">
              Build fee paid per month (KSh)
              <input type="number" min={0} className={`${inputClass} mt-1`} {...field("setupInstallmentKes")} />
            </label>
          </div>
          {preview && <p className="mt-3 text-sm text-[var(--muted)]">{preview}</p>}
          {formError && <p className="mt-3 text-sm text-[var(--stop)]">{formError}</p>}
          <button
            onClick={addSite}
            disabled={saving}
            className="mt-4 rounded-lg bg-[var(--btn)] px-4 py-2 text-sm font-semibold text-[var(--btn-ink)] disabled:opacity-60"
          >
            {saving ? "Adding..." : "Add site"}
          </button>
        </section>
      )}

      {error && <p className="mt-6 text-sm text-[var(--stop)]">{error}</p>}

      <ul className="mt-6 space-y-2">
        {loading ? (
          <li className="py-10 text-center text-sm text-[var(--muted)]">Loading...</li>
        ) : sites.length === 0 ? (
          <li className="py-10 text-center text-sm text-[var(--muted)]">No sites yet.</li>
        ) : (
          sites.map((site) => {
            const state = standing(site);
            const build = buildProgress(site);
            return (
              <li key={site.id}>
                <Link
                  href={`/services/${site.id}`}
                  className={`block rounded-2xl border border-[var(--line)] bg-[var(--card)] px-5 py-4 transition hover:border-[var(--muted)] ${
                    site.status === "cancelled" ? "opacity-60" : ""
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{site.domain}</p>
                      <p className="truncate text-sm text-[var(--muted)]">{site.customerName}</p>
                    </div>
                    <p className="text-sm text-[var(--muted)]">{formatKes(site.monthlyPriceKes)}/mo</p>
                  </div>
                  <p className={`mt-2 flex items-center gap-2 text-sm font-medium ${TONE_TEXT[state.tone]}`}>
                    <span className={`h-2 w-2 shrink-0 rounded-full ${TONE_DOT[state.tone]}`} />
                    {state.text}
                  </p>
                  {build && build.paidKes < build.totalKes && (
                    <div className="mt-3">
                      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--soft)]">
                        <div
                          className="h-full rounded-full bg-[var(--ink)]"
                          style={{ width: `${Math.round((build.paidKes / build.totalKes) * 100)}%` }}
                        />
                      </div>
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        Build {formatKes(build.paidKes)} of {formatKes(build.totalKes)} paid
                      </p>
                    </div>
                  )}
                </Link>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
