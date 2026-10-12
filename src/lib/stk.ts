/**
 * Starts an M-Pesa STK push through byg-global, which holds the Daraja
 * credentials and receives Safaricom's callback. Server-side, so pages
 * served on a customer's own domain need no CORS allowance.
 */
export async function startStkPush(input: {
  payToken: string;
  phone: string;
  amountKes?: number;
}): Promise<{ ok: true; checkoutRequestId: string; amountKes: number } | { ok: false; error: string; status: number }> {
  const base = (process.env.BYG_GLOBAL_INTERNAL_URL || process.env.NEXT_PUBLIC_BYG_GLOBAL_BASE_URL || "").replace(/\/+$/, "");
  if (!base) {
    return { ok: false, error: "Payments are not configured yet. Contact CAPTYN.", status: 503 };
  }
  try {
    const response = await fetch(`${base}/api/payments/mpesa/hosting/initialize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(30_000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.success || typeof data?.checkoutRequestId !== "string") {
      return {
        ok: false,
        error: typeof data?.error === "string" ? data.error : "Couldn't start the payment. Try again.",
        status: response.ok ? 502 : response.status,
      };
    }
    return { ok: true, checkoutRequestId: data.checkoutRequestId, amountKes: Number(data.amountKes) || 0 };
  } catch (error) {
    console.error("Hosting STK push failed:", error);
    return { ok: false, error: "M-Pesa is unreachable right now. Try again shortly.", status: 503 };
  }
}
