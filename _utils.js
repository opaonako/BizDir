// api/_utils.js — shared helper for all Vercel API functions

async function callAppsScript(action, payload = {}, method = "GET") {
  const URL = process.env.APPS_SCRIPT_URL;
  const SECRET = process.env.INTERNAL_SECRET;

  if (!URL) throw new Error("APPS_SCRIPT_URL is not set");

  const enriched = { ...payload, action, _secret: SECRET };

  let url = URL, options = {};

  if (method === "GET") {
    url = URL + "?" + new URLSearchParams(enriched).toString();
    options = { method: "GET" };
  } else {
    options = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(enriched),
    };
  }

  const res = await fetch(url, { ...options, redirect: "follow" });
  if (!res.ok) throw new Error("Apps Script error: " + res.status);

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
