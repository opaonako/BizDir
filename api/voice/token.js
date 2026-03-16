// api/voice/token.js
// Generates Telnyx WebRTC credentials for browser dialer
// POST /api/voice/token

const TELNYX_API_KEY = process.env.TELNYX_API_KEY;
const TELNYX_SIP_USERNAME = process.env.TELNYX_SIP_USERNAME; // e.g. "bizdir"
const TELNYX_SIP_PASSWORD = process.env.TELNYX_SIP_PASSWORD;

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Check auth
  const token = req.headers.authorization?.replace("Bearer ", "") ||
                req.body?.token;

  if (!TELNYX_API_KEY) {
    return res.status(500).json({ error: "Telnyx not configured" });
  }

  try {
    // Create a WebRTC token via Telnyx API
    const response = await fetch("https://api.telnyx.com/v2/telephony_credentials", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${TELNYX_API_KEY}`,
      },
      body: JSON.stringify({
        connection_id: process.env.TELNYX_APP_ID,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Telnyx credential error:", data);
      return res.status(500).json({ 
        error: "Failed to create WebRTC credentials",
        details: data?.errors?.[0]?.detail || "Unknown error"
      });
    }

    return res.status(200).json({
      token: data.data?.sip_password,
      login: data.data?.sip_username,
      expires: data.data?.expired_at,
    });

  } catch(e) {
    console.error("Token error:", e.message);
    return res.status(500).json({ error: e.message });
  }
};