interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * byg-global's stored N8N_EMAIL_WEBHOOK_URL is double-percent-encoded
 * (e.g. "checkout%2520email%2520webhook" instead of "checkout%20email
 * %20webhook") -- sent as-is, the HTTP layer only decodes one level,
 * so n8n sees a literal "%20" in the path and 404s ("webhook is not
 * registered"). byg-global's own sender works around this by also
 * trying a decodeURIComponent'd candidate; replicate that here.
 */
function resolveWebhookUrlCandidates(): string[] {
  const candidates: string[] = [];
  const configured =
    process.env.N8N_EMAIL_WEBHOOK_URL?.trim() ||
    `${(process.env.N8N_BASE_URL?.trim().replace(/\/+$/, "")) || "http://n8n:5678"}/webhook/send-email`;

  candidates.push(configured);
  try {
    const decoded = decodeURIComponent(configured);
    if (decoded !== configured) candidates.push(decoded);
  } catch {
    // Not URI-encoded beyond what's already valid; ignore.
  }
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
