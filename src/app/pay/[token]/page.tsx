"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";

const PAY_POLL_INTERVAL_MS = 3000;
const PAY_POLL_TIMEOUT_MS = 90_000;

// STK push stays behind byg-global's Daraja credentials -- this app only
// has a payToken-scoped, rate-limited public endpoint to call, not the
// M-PESA integration itself. See NEXT_PUBLIC_BYG_GLOBAL_BASE_URL.
const BYG_GLOBAL_BASE_URL = process.env.NEXT_PUBLIC_BYG_GLOBAL_BASE_URL || "";

type InvoiceStatus = "pending" | "paid" | "overdue" | "void";

type InvoiceData = {
  id: string;
  amountKes: number;
  dueDate: string;
  status: InvoiceStatus;
  customerName: string;
  domain: string;
  planName: string;
};

type PaymentState = "idle" | "submitting" | "awaiting_confirmation" | "succeeded" | "failed";

function formatKes(amountKes: number): string {
  return `KSh ${Math.round(amountKes).toLocaleString()}`;
}

export default function HostingInvoicePayPage() {
  const params = useParams();
  const token = typeof params?.token === "string" ? params.token : "";

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [invoice, setInvoice] = useState<InvoiceData | null>(null);
  const [phone, setPhone] = useState("");
  const [paymentState, setPaymentState] = useState<PaymentState>("idle");
  const [paymentMessage, setPaymentMessage] = useState<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollDeadlineRef = useRef<number>(0);

  const loadInvoice = useCallback(async () => {
    try {
      const response = await fetch(`/api/invoice/${encodeURIComponent(token)}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setLoadError(typeof data?.error === "string" ? data.error : "Invoice not found.");
        setInvoice(null);
        return;
      }
      setInvoice(data as InvoiceData);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Failed to load invoice.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) void loadInvoice();
  }, [loadInvoice, token]);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const pollInvoiceStatus = useCallback(() => {
    stopPolling();
    pollDeadlineRef.current = Date.now() + PAY_POLL_TIMEOUT_MS;

    pollTimerRef.current = setInterval(async () => {
      try {
        const response = await fetch(`/api/invoice/${encodeURIComponent(token)}`, { cache: "no-store" });
        const data = await response.json().catch(() => ({}));

        if (data?.status === "paid") {
          stopPolling();
          setPaymentState("succeeded");
          setPaymentMessage("Payment received. Thank you.");
          setInvoice(data as InvoiceData);
          return;
        }

        if (Date.now() > pollDeadlineRef.current) {
          stopPolling();
          setPaymentState("failed");
          setPaymentMessage("We didn't get a confirmation in time. Check your M-PESA messages, or try again.");
        }
      } catch {
        if (Date.now() > pollDeadlineRef.current) {
          stopPolling();
          setPaymentState("failed");
          setPaymentMessage("We couldn't confirm the payment status. Check your M-PESA messages, or try again.");
        }
      }
    }, PAY_POLL_INTERVAL_MS);
  }, [stopPolling, token]);

  const submitPayment = useCallback(async () => {
    if (!phone.trim()) {
      setPaymentState("failed");
      setPaymentMessage("Enter the M-PESA phone number to receive the STK prompt on.");
      return;
    }
    if (!BYG_GLOBAL_BASE_URL) {
      setPaymentState("failed");
      setPaymentMessage("Payments are not configured yet. Contact CAPTYN support.");
      return;
    }

    setPaymentState("submitting");
    setPaymentMessage(null);

    try {
      const response = await fetch(`${BYG_GLOBAL_BASE_URL}/api/payments/mpesa/hosting/initialize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payToken: token, phone: phone.trim() }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data?.success) {
        setPaymentState("failed");
        setPaymentMessage(typeof data?.error === "string" ? data.error : "Failed to start the payment.");
        return;
      }

      setPaymentState("awaiting_confirmation");
      setPaymentMessage("Check your phone and enter your M-PESA PIN to complete the payment.");
      pollInvoiceStatus();
    } catch (error) {
      setPaymentState("failed");
      setPaymentMessage(error instanceof Error ? error.message : "Failed to start the payment.");
    }
  }, [phone, pollInvoiceStatus, token]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="h-10 w-10 animate-spin rounded-full border-b-2 border-blue-600" />
      </div>
    );
  }

  if (loadError || !invoice) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <div className="max-w-md rounded-lg bg-white p-8 text-center shadow">
          <h1 className="text-lg font-semibold text-gray-900">Invoice not found</h1>
          <p className="mt-2 text-sm text-gray-600">{loadError || "This payment link is invalid or has expired."}</p>
        </div>
      </div>
    );
  }

  const isPaid = invoice.status === "paid" || paymentState === "succeeded";
  const isOverdue = invoice.status === "overdue";

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-lg">
        <div className="mb-6 text-center">
          <p className="text-sm font-medium text-blue-600">CAPTYN Hosting</p>
          <h1 className="mt-1 text-xl font-semibold text-gray-900">{invoice.domain}</h1>
          <p className="mt-1 text-sm text-gray-500">{invoice.planName}</p>
        </div>

        <div className="rounded-lg bg-gray-50 p-6 text-center">
          <p className="text-3xl font-bold text-gray-900">{formatKes(invoice.amountKes)}</p>
          <p className="mt-1 text-sm text-gray-500">
            {isPaid ? "Paid" : `Due ${new Date(invoice.dueDate).toLocaleDateString()}`}
          </p>
          {isOverdue && !isPaid && (
            <p className="mt-2 text-sm font-medium text-red-600">This invoice is overdue.</p>
          )}
        </div>

        {isPaid ? (
          <div className="mt-6 rounded-lg bg-green-50 p-4 text-center text-sm font-medium text-green-700">
            {paymentMessage || "This invoice has been paid. Thank you."}
          </div>
        ) : (
          <div className="mt-6 space-y-3">
            <label className="block text-sm font-medium text-gray-700">M-PESA phone number</label>
            <input
              type="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="07XX XXX XXX"
              disabled={paymentState === "submitting" || paymentState === "awaiting_confirmation"}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
            <button
              onClick={submitPayment}
              disabled={paymentState === "submitting" || paymentState === "awaiting_confirmation"}
              className="w-full rounded-md bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {paymentState === "submitting"
                ? "Starting payment..."
                : paymentState === "awaiting_confirmation"
                ? "Waiting for confirmation..."
                : "Pay with M-Pesa"}
            </button>
            {paymentMessage && (
              <p
                className={`text-center text-sm ${
                  paymentState === "failed" ? "text-red-600" : "text-gray-600"
                }`}
              >
                {paymentMessage}
              </p>
            )}
          </div>
        )}

        <p className="mt-6 text-center text-xs text-gray-400">
          Billed for {invoice.customerName} · No CAPTYN account needed to pay.
        </p>
      </div>
    </div>
  );
}
