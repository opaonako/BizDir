// api/_utils.js — shared helper for all Vercel API functions

async function callAppsScript(action, payload = {}, method = "GET") {
  const URL = process.env.APPS_SCRIPT_URL;
  const SECRET = process.env.INTERNAL_SECRET;

  if (!URL) throw new Error("APPS_SCRIPT_URL is not set");

  const enriched = { ...payload, action, _secret: SECRET };

  // ── WHY ALL REQUESTS USE GET ─────────────────────────────
  // Apps Script Web Apps always respond with a 302 redirect.
  // fetch() follows redirects but POST-to-GET redirect drops
  // the request body, so the second request arrives with no
  // _secret and Apps Script returns "Unauthorized" → 500.
  // Sending everything as GET query params sidesteps this
  // entirely. URLSearchParams safely encodes all values.
  // For large payloads (createLead etc.) this is fine because
  // the payload is small. For getLeads the response is large
  // but the REQUEST is tiny — no URL length issue.
  const qs = new URLSearchParams(
    // URLSearchParams needs string values
    Object.fromEntries(
      Object.entries(enriched).map(([k, v]) => [k, String(v ?? "")])
    )
  ).toString();

  const res = await fetch(URL + "?" + qs, {
    method: "GET",
    redirect: "follow",
  });

  if (!res.ok) throw new Error("Apps Script HTTP error: " + res.status);

  const data = await res.json();
  if (data.success === false) throw new Error(data.error || "Apps Script failed");

  return data;
}

function ok(res, body, statusCode = 200) {
  res.status(statusCode).json({ success: true, ...body });
}

function err(res, message, statusCode = 400) {
  res.status(statusCode).json({ success: false, error: message });
}

module.exports = { callAppsScript, ok, err };