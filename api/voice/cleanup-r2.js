// api/voice/cleanup-r2.js
// Scheduled cleanup endpoint for Cloudflare R2 audio files.
// Called by Vercel cron (hourly) or manually with INTERNAL_SECRET.
// Replaces the unreliable setTimeout that was previously in webhook.js.
//
// Auth: Accepts either Vercel cron (x-vercel-cron header)
//       or manual invocation with ?secret=INTERNAL_SECRET

const R2_ACCOUNT_ID       = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID    = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY= process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME      = process.env.R2_BUCKET_NAME || "bizdir-audio";
const INTERNAL_SECRET     = process.env.INTERNAL_SECRET;

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  // Auth: accept Vercel cron header OR manual secret query param
  const isVercelCron = req.headers["x-vercel-cron"] === "true";
  const secret = req.query.secret;
  if (!isVercelCron && secret !== INTERNAL_SECRET) {
    return res.status(403).json({ error: "Unauthorized — provide ?secret= or run via Vercel cron" });
  }

  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    return res.status(500).json({ error: "R2 credentials not configured" });
  }

  const crypto = require("crypto");
  const ONE_HOUR_AGO = Date.now() - 60 * 60 * 1000;

  try {
    const endpoint = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
    const listUrl  = `${endpoint}/${R2_BUCKET_NAME}`;

    const now       = new Date();
    const amzDate   = now.toISOString().replace(/[:\-]|\.\d{3}/g, "").slice(0, 15) + "Z";
    const dateStamp = amzDate.slice(0, 8);
    const host      = `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

    const bodyHash = crypto.createHash("sha256").update("").digest("hex");
    const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${bodyHash}\nx-amz-date:${amzDate}\n`;
    const signedHeadersList = "host;x-amz-content-sha256;x-amz-date";
    const canonicalRequest = ["GET", `/${R2_BUCKET_NAME}`, "", canonicalHeaders, signedHeadersList, bodyHash].join("\n");
    const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, crypto.createHash("sha256").update(canonicalRequest).digest("hex")].join("\n");

    function hmac(key, data) { return crypto.createHmac("sha256", key).update(data).digest(); }
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${R2_SECRET_ACCESS_KEY}`, dateStamp), "auto"), "s3"), "aws4_request");
    const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");

    const listRes = await fetch(listUrl, {
      method: "GET",
      headers: {
        "x-amz-date":            amzDate,
        "x-amz-content-sha256":  bodyHash,
        "Authorization":         `AWS4-HMAC-SHA256 Credential=${R2_ACCESS_KEY_ID}/${dateStamp}/auto/s3/aws4_request, SignedHeaders=${signedHeadersList}, Signature=${signature}`,
        "Host":                  host,
      },
    });

    if (!listRes.ok) {
      const errText = await listRes.text();
      return res.status(500).json({ error: "Failed to list R2 objects", details: errText });
    }

    const listXml = await listRes.text();

    const keyRegex  = /<Key>([^<]+)<\/Key>/g;
    const dateRegex = /<LastModified>([^<]+)<\/LastModified>/g;
    const keys   = [];
    const dates  = [];
    let m;
    while ((m = keyRegex.exec(listXml))  !== null) keys.push(m[1]);
    while ((m = dateRegex.exec(listXml)) !== null) dates.push(new Date(m[1]).getTime());

    let deleted = 0;
    for (let i = 0; i < keys.length; i++) {
      if (dates[i] < ONE_HOUR_AGO) {
        await deleteFromR2(keys[i]);
        deleted++;
      }
    }

    return res.status(200).json({ success: true, scanned: keys.length, deleted });
  } catch(e) {
    console.error("R2 cleanup error:", e.message);
    return res.status(500).json({ error: e.message });
  }
};

async function deleteFromR2(filename) {
  const crypto   = require("crypto");
  const endpoint = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const deleteUrl = `${endpoint}/${R2_BUCKET_NAME}/${filename}`;

  const now       = new Date();
  const amzDate   = now.toISOString().replace(/[:\-]|\.\d{3}/g, "").slice(0, 15) + "Z";
  const dateStamp = amzDate.slice(0, 8);
  const host      = `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

  const bodyHash = crypto.createHash("sha256").update("").digest("hex");
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${bodyHash}\nx-amz-date:${amzDate}\n`;
  const signedHeadersList = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = ["DELETE", `/${R2_BUCKET_NAME}/${filename}`, "", canonicalHeaders, signedHeadersList, bodyHash].join("\n");
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, crypto.createHash("sha256").update(canonicalRequest).digest("hex")].join("\n");

  function hmac(key, data) { return crypto.createHmac("sha256", key).update(data).digest(); }
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${R2_SECRET_ACCESS_KEY}`, dateStamp), "auto"), "s3"), "aws4_request");
  const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  await fetch(deleteUrl, {
    method: "DELETE",
    headers: {
      "x-amz-date":           amzDate,
      "x-amz-content-sha256": bodyHash,
      "Authorization":        `AWS4-HMAC-SHA256 Credential=${R2_ACCESS_KEY_ID}/${dateStamp}/auto/s3/aws4_request, SignedHeaders=${signedHeadersList}, Signature=${signature}`,
      "Host":                 host,
    },
  });
  console.log("[Cleanup] Deleted:", filename);
}
