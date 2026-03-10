/**
 * Quovi Waitlist API — Cloudflare Pages Function
 * Endpoint: POST /api/waitlist
 *
 * Setup (one-time, in Cloudflare Dashboard):
 * ─────────────────────────────────────────────
 * 1. KV Namespace
 *    Pages → quovi-web → Settings → Functions → KV namespace bindings
 *    Variable name : WAITLIST_KV
 *    Create a new namespace called "quovi-waitlist"
 *
 * 2. Resend API Key
 *    Pages → quovi-web → Settings → Environment variables
 *    Variable name : RESEND_API_KEY
 *    Value         : re_xxxxxxxxxxxx  (from resend.com)
 *
 * 3. Verify quovi.ai domain in Resend
 *    Resend → Domains → Add Domain → quovi.ai
 *    Add the 3 DNS records Resend gives you in Cloudflare DNS
 *    (takes ~5 minutes to verify)
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });

// ── CORS preflight ─────────────────────────────────────────────────────────
export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}

// ── POST /api/waitlist ─────────────────────────────────────────────────────
export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }

  const { email, source, website } = body;

  // 1. Honeypot — bots fill the hidden "website" field, humans don't
  if (website) {
    // Return 200 silently so bots think they succeeded
    return json({ status: 'ok' });
  }

  // 2. Email format validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  if (!email || !emailRegex.test(email.trim())) {
    return json({ error: 'invalid_email' }, 422);
  }

  const normalised = email.trim().toLowerCase();

  // 3. Duplicate check via KV
  try {
    const existing = await env.WAITLIST_KV.get(normalised);
    if (existing) {
      return json({ error: 'already_registered' }, 409);
    }
  } catch {
    // KV unavailable — fail open so we don't lose leads
    console.error('KV read failed');
  }

  // 4. Persist to KV
  const entry = {
    email:       normalised,
    source:      source || 'unknown',
    signed_up_at: new Date().toISOString(),
    consent:     true,
  };

  try {
    await env.WAITLIST_KV.put(normalised, JSON.stringify(entry));
  } catch {
    console.error('KV write failed for', normalised);
    // Continue — still send the confirmation email
  }

  // 5. Send confirmation email via Resend
  try {
    await sendConfirmation(normalised, env.RESEND_API_KEY);
  } catch (err) {
    console.error('Resend failed:', err.message);
    // Don't fail the request — lead is stored, email can be resent manually
  }

  return json({ status: 'ok' });
}

// ── Resend confirmation email ──────────────────────────────────────────────
async function sendConfirmation(email, apiKey) {
  const html = buildEmailHtml(email);

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from:    'Quovi <hello@quovi.ai>',
      to:      email,
      subject: "You're on the Quovi waitlist",
      html,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend ${res.status}: ${err}`);
  }

  return res.json();
}

// ── Email HTML template ────────────────────────────────────────────────────
function buildEmailHtml(email) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>You're on the Quovi waitlist</title>
</head>
<body style="margin:0;padding:0;background:#000000;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">

  <!-- Wrapper -->
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#000000;padding:40px 0;">
    <tr>
      <td align="center">

        <!-- Card -->
        <table width="560" cellpadding="0" cellspacing="0" border="0"
               style="max-width:560px;width:100%;background:#04090F;border-radius:16px;border:1px solid rgba(255,255,255,0.08);overflow:hidden;">

          <!-- Top accent bar -->
          <tr>
            <td style="height:3px;background:linear-gradient(90deg,#1D4ED8,#0EA5E9,#06B6D4);"></td>
          </tr>

          <!-- Header -->
          <tr>
            <td style="padding:40px 48px 32px;border-bottom:1px solid rgba(255,255,255,0.06);">
              <!-- Wordmark (text-based for email client compatibility) -->
              <table cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-size:28px;font-weight:900;letter-spacing:-1px;color:#FFFFFF;">
                    quov<span style="color:#06B6D4;">i</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:36px 48px;">

              <!-- Badge -->
              <table cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
                <tr>
                  <td style="background:rgba(34,211,238,0.1);border:1px solid rgba(34,211,238,0.2);
                             border-radius:40px;padding:5px 14px;
                             font-size:11px;font-weight:600;color:#22D3EE;letter-spacing:0.08em;
                             text-transform:uppercase;">
                    ✦ &nbsp;You're on the list
                  </td>
                </tr>
              </table>

              <!-- Headline -->
              <p style="margin:0 0 16px;font-size:24px;font-weight:800;
                         letter-spacing:-0.5px;color:#FFFFFF;line-height:1.2;">
                We'll be in touch soon.
              </p>

              <!-- Body copy -->
              <p style="margin:0 0 20px;font-size:15px;color:#6B8FAF;line-height:1.75;">
                Thanks for joining the Quovi early access list. We're onboarding a small
                number of teams first — so you're ahead of the queue.
              </p>

              <!-- Divider -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
                <tr>
                  <td style="height:1px;background:rgba(255,255,255,0.06);"></td>
                </tr>
              </table>

              <!-- What is Quovi -->
              <p style="margin:0 0 12px;font-size:12px;font-weight:600;color:#6B8FAF;
                         letter-spacing:0.12em;text-transform:uppercase;">
                What you're getting early access to
              </p>

              <!-- Feature list -->
              <table cellpadding="0" cellspacing="0" border="0" style="width:100%;">
                <tr>
                  <td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
                    <table cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="width:28px;font-size:16px;vertical-align:top;padding-top:1px;">💬</td>
                        <td>
                          <p style="margin:0;font-size:14px;font-weight:600;color:#FFFFFF;">Ask your data in plain English</p>
                          <p style="margin:4px 0 0;font-size:13px;color:#6B8FAF;line-height:1.6;">
                            No SQL. No Tableau seat. Just a question.
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
                    <table cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="width:28px;font-size:16px;vertical-align:top;padding-top:1px;">🔗</td>
                        <td>
                          <p style="margin:0;font-size:14px;font-weight:600;color:#FFFFFF;">Works on top of Tableau &amp; Power BI</p>
                          <p style="margin:4px 0 0;font-size:13px;color:#6B8FAF;line-height:1.6;">
                            Zero migration. Your data stays exactly where it is.
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:10px 0;">
                    <table cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="width:28px;font-size:16px;vertical-align:top;padding-top:1px;">👥</td>
                        <td>
                          <p style="margin:0;font-size:14px;font-weight:600;color:#FFFFFF;">Unlimited users, one flat rate</p>
                          <p style="margin:4px 0 0;font-size:13px;color:#6B8FAF;line-height:1.6;">
                            Give your whole team access — not just the people with seats.
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Divider -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
                <tr>
                  <td style="height:1px;background:rgba(255,255,255,0.06);"></td>
                </tr>
              </table>

              <!-- What happens next -->
              <p style="margin:0 0 12px;font-size:12px;font-weight:600;color:#6B8FAF;
                         letter-spacing:0.12em;text-transform:uppercase;">
                What happens next
              </p>
              <p style="margin:0;font-size:14px;color:#6B8FAF;line-height:1.75;">
                We're reaching out to early access members personally to understand your setup
                and get you onboarded. Keep an eye on this inbox.
              </p>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 48px 32px;border-top:1px solid rgba(255,255,255,0.06);">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-size:11px;color:#2A3F58;line-height:1.7;">
                    You're receiving this because <span style="color:#3A5570;">${email}</span>
                    signed up at <a href="https://quovi.ai" style="color:#06B6D4;text-decoration:none;">quovi.ai</a>.
                    &nbsp;·&nbsp;
                    <a href="https://quovi.ai/unsubscribe?email=${encodeURIComponent(email)}"
                       style="color:#2A3F58;text-decoration:underline;">Unsubscribe</a>
                  </td>
                  <td align="right" style="font-size:11px;color:#2A3F58;white-space:nowrap;">
                    © 2026 Quovi Inc.
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
        <!-- /Card -->

      </td>
    </tr>
  </table>

</body>
</html>`;
}
