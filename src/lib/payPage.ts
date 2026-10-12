import type { PayState } from "@/lib/payState";
import { formatDateLabel, formatKes } from "@/lib/emailTemplates";

// Plain HTML + a small inline script, no Next.js assets: the same page is
// served on hosting.captyn.shop and, through nginx, on a customer's own
// domain (where /_next/ belongs to their site, not this app).

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const STYLES = `
:root { --bg:#f1f5f9; --card:#ffffff; --ink:#0f172a; --muted:#64748b; --line:#e2e8f0; --warn:#b45309; --stop:#b91c1c; --good:#047857; --btn:#0f172a; --btn-ink:#ffffff; }
@media (prefers-color-scheme: dark) {
  :root { --bg:#0b1120; --card:#111827; --ink:#f1f5f9; --muted:#94a3b8; --line:#1f2937; --warn:#fbbf24; --stop:#f87171; --good:#34d399; --btn:#f1f5f9; --btn-ink:#0b1120; }
}
* { box-sizing:border-box; }
body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px 16px; background:var(--bg); color:var(--ink); font-family:-apple-system,"Segoe UI",Roboto,Arial,sans-serif; line-height:1.5; }
.card { width:100%; max-width:420px; background:var(--card); border:1px solid var(--line); border-radius:18px; padding:28px 24px; }
.brand { font-size:13px; color:var(--muted); }
.domain { font-size:20px; font-weight:650; margin:2px 0 22px; word-break:break-all; }
.amount { font-size:40px; font-weight:750; letter-spacing:-0.02em; }
.caption { font-size:14px; margin-top:2px; }
.warn { color:var(--warn); } .stop { color:var(--stop); } .good { color:var(--good); } .muted { color:var(--muted); }
form { margin-top:22px; display:grid; gap:12px; }
label { font-size:13px; color:var(--muted); display:grid; gap:4px; }
input { font:inherit; color:var(--ink); background:transparent; border:1px solid var(--line); border-radius:10px; padding:11px 12px; width:100%; }
input:focus { outline:2px solid var(--ink); outline-offset:-1px; }
button, .btn { font:inherit; font-weight:650; border:0; border-radius:12px; padding:13px 16px; background:var(--btn); color:var(--btn-ink); cursor:pointer; text-align:center; text-decoration:none; display:block; }
button:disabled { opacity:.55; cursor:default; }
.msg { font-size:14px; min-height:1.5em; margin:4px 0 0; }
.foot { margin-top:22px; font-size:12px; color:var(--muted); }
a { color:inherit; }
`;

function shell(title: string, body: string, script = ""): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${escapeHtml(title)}</title><style>${STYLES}</style></head>
<body>${body}${script ? `<script>${script}</script>` : ""}</body></html>`;
}

function caption(state: PayState): { text: string; tone: string } {
  if (state.balanceKes <= 0) return { text: "Paid up. Thank you.", tone: "good" };
  if (state.paused) return { text: "Site paused · pay to bring it back online", tone: "stop" };
  if (state.overdueKes > 0) {
    return {
      text: state.suspendAfter
        ? `Overdue · pay by ${formatDateLabel(state.suspendAfter)} to keep the site online`
        : "Overdue",
      tone: "warn",
    };
  }
  return { text: state.dueDate ? `Due ${formatDateLabel(state.dueDate)}` : "Due", tone: "muted" };
}

/**
 * The pay page. `apiPath` answers GET (?checkout=id for an attempt's status)
 * and POST {phone, amountKes} to start an STK push.
 */
export function renderPayPage(state: PayState, apiPath: string, siteUrl?: string): string {
  const { text, tone } = caption(state);
  const body = `<main class="card">
  <div class="brand">CAPTYN Hosting</div>
  <div class="domain">${escapeHtml(state.domain)}</div>
  <div class="amount" id="amount">${formatKes(state.balanceKes)}</div>
  <div class="caption ${tone}" id="caption">${escapeHtml(text)}</div>
  ${
    state.balanceKes > 0
      ? `<form id="pay">
    <label>M-Pesa number<input name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="07XX XXX XXX" required></label>
    <label>Amount (KSh)<input name="amountKes" type="number" inputmode="numeric" min="1" max="${state.balanceKes}" value="${state.balanceKes}" required></label>
    <button type="submit" id="go">Pay ${formatKes(state.balanceKes)}</button>
    <p class="msg muted" id="msg" role="status"></p>
  </form>`
      : siteUrl
      ? `<p style="margin-top:22px"><a class="btn" href="${escapeHtml(siteUrl)}">Go to ${escapeHtml(state.domain)}</a></p>`
      : ""
  }
  <div class="foot">Billed to ${escapeHtml(state.customerName)}. No account needed.</div>
</main>`;

  const script = `
(function(){
  var api=${JSON.stringify(apiPath)}, siteUrl=${JSON.stringify(siteUrl || "")};
  var form=document.getElementById("pay"); if(!form) return;
  var go=document.getElementById("go"), msg=document.getElementById("msg");
  var kes=function(n){return "KSh "+Math.round(n).toLocaleString("en-KE");};
  form.amountKes.addEventListener("input",function(){var n=Number(form.amountKes.value);go.textContent=n>0?"Pay "+kes(n):"Pay";});
  function say(t,c){msg.textContent=t;msg.className="msg "+(c||"muted");}
  form.addEventListener("submit",function(e){
    e.preventDefault(); go.disabled=true; say("Starting payment...");
    fetch(api,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({phone:form.phone.value,amountKes:Number(form.amountKes.value)})})
      .then(function(r){return r.json().then(function(d){return {ok:r.ok,d:d};});})
      .then(function(x){
        if(!x.ok||!x.d.checkoutRequestId){go.disabled=false;say(x.d.error||"Couldn't start the payment. Try again.","stop");return;}
        say("Check your phone and enter your M-Pesa PIN.");
        var until=Date.now()+120000;
        (function poll(){
          fetch(api+"?checkout="+encodeURIComponent(x.d.checkoutRequestId),{cache:"no-store"}).then(function(r){return r.json();}).then(function(s){
            if(s.payment==="completed"){
              document.getElementById("amount").textContent=kes(s.balanceKes);
              var c=document.getElementById("caption"); c.className="caption good";
              c.textContent=s.balanceKes>0?"Received. "+kes(s.balanceKes)+" still to pay.":"Paid up. Thank you.";
              say(siteUrl?"Payment received. Your site is back within a minute.":"Payment received. A receipt is on its way by email.","good");
              form.phone.disabled=form.amountKes.disabled=true; go.style.display="none";
              if(siteUrl&&s.balanceKes<=0){setTimeout(function(){location.href=siteUrl;},4000);}
              return;
            }
            if(s.payment==="failed"){go.disabled=false;say("The payment was cancelled or didn't go through. Try again.","stop");return;}
            if(Date.now()>until){go.disabled=false;say("No confirmation yet. If M-Pesa took the money, it will show here shortly; otherwise try again.","warn");return;}
            setTimeout(poll,3000);
          }).catch(function(){setTimeout(poll,3000);});
        })();
      })
      .catch(function(){go.disabled=false;say("Network error. Try again.","stop");});
  });
})();`;

  return shell(`Pay ${state.domain} hosting`, body, script);
}

/** What visitors see on a paused site. Debt details stay on the pay page. */
export function renderPausedPage(domain: string, payPath: string): string {
  return shell(
    `${domain} is temporarily unavailable`,
    `<main class="card">
  <div class="domain" style="margin-bottom:8px">${escapeHtml(domain)}</div>
  <p style="margin:0 0 4px;font-size:18px;font-weight:600">This site is temporarily unavailable.</p>
  <p class="muted" style="margin:0">Please check back soon.</p>
  <p class="foot"><a href="${escapeHtml(payPath)}">Site owner? Pay your hosting bill</a></p>
</main>`
  );
}

export function renderNotFoundPage(): string {
  return shell("Payment link not valid", `<main class="card"><div class="domain">Payment link not valid</div><p class="muted">Ask CAPTYN for a new link.</p></main>`);
}
