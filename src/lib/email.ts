interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * byg-global's stored N8N_EMAIL_WEBHOOK_URL / N8N_WEBHOOK_SEND_EMAIL are
 * both a dead, double-percent-encoded webhook path ("...checkout%2520
 * email%2520webhook/send-email" -- an old workflow's custom webhook ID
 * that's no longer registered in n8n, confirmed 404 regardless of
 * encoding). The webhook that's actually active is the plain
 * "/webhook/send-email" path off N8N_BASE_URL -- confirmed 200 OK
 * directly against n8n. byg-global's own sender already falls through
 * to this same base-URL candidate last in its list, which is why its
 * real emails still go out; this app's list must include it too.
 */
function resolveWebhookUrlCandidates(): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const add = (url: string | null | undefined) => {
    const trimmed = url?.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      candidates.push(trimmed);
    }
  };

  const configured = process.env.N8N_EMAIL_WEBHOOK_URL?.trim();
  add(configured);
  if (configured) {
    try {
      add(decodeURIComponent(configured));
    } catch {
      // Not URI-encoded beyond what's already valid; ignore.
    }
  }
  add(process.env.N8N_WEBHOOK_SEND_EMAIL);

  const base = process.env.N8N_BASE_URL?.trim().replace(/\/+$/, "") || "http://n8n:5678";
  add(`${base}/webhook/send-email`);

  return candidates;
}

/**
 * Same n8n "send-email" webhook byg-global uses (shared infra, not a
 * cross-project dependency) -- HOSTING_EMAIL_WEBHOOK_SECRET must match
 * byg-global's N8N_WEBHOOK_SECRET for the HMAC signature to be accepted.
 */
export async function sendEmail(input: SendEmailInput): Promise<boolean> {
  const webhookUrls = resolveWebhookUrlCandidates();
  const secret = process.env.HOSTING_EMAIL_WEBHOOK_SECRET?.trim();
  const timestamp = Date.now().toString();

  const payload = {
    to: input.to,
    type: "generic",
    subject: input.subject,
    message: input.text,
    text: input.text,
    html: input.html,
    emailHtml: input.html,
    fromEmail: process.env.HOSTING_EMAIL_FROM || "hosting@captyn.shop",
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Source": "captyn-hosting",
  };

  if (secret) {
    const payloadString = JSON.stringify({ to: input.to, type: "generic", timestamp });
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payloadString));
    headers["X-Timestamp"] = timestamp;
    headers["X-Signature"] = Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  const n8nUser = process.env.N8N_BASIC_AUTH_USER;
  const n8nPassword = process.env.N8N_BASIC_AUTH_PASSWORD;
  if (n8nUser && n8nPassword) {
    headers["Authorization"] = `Basic ${btoa(`${n8nUser}:${n8nPassword}`)}`;
  }

  for (const webhookUrl of webhookUrls) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const response = await fetch(webhookUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
        });
        if (response.ok) return true;
        console.error("Hosting email webhook returned non-OK status:", webhookUrl, response.status, await response.text());
      } catch (error) {
        console.error(`Hosting email send attempt ${attempt} failed:`, webhookUrl, error);
      }
    }
  }
  return false;
}
