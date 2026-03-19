// api/voice/token.js
// Returns Telnyx WebRTC credentials for browser dialer
// POST /api/voice/token

const TELNYX_API_KEY          = process.env.TELNYX_API_KEY;
const TELNYX_SIP_USERNAME     = process.env.TELNYX_SIP_USERNAME; // userpaolollenado24209@sip.telnyx.com
const TELNYX_SIP_PASSWORD     = process.env.TELNYX_SIP_PASSWORD; // your SIP password
const TELNYX_SIP_CONNECTION_ID = process.env.TELNYX_SIP_CONNECTION_ID;

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // If SIP credentials are set directly, use them
  if (TELNYX_SIP_USERNAME && TELNYX_SIP_PASSWORD) {
    return res.status(200).json({
      login: TELNYX_SIP_USERNAME,
      token: TELNYX_SIP_PASSWORD,
    });
  }

  // Otherwise generate temporary credentials via API
  if (!TELNYX_API_KEY) {
    return res.status(500).json({ error: "Telnyx not configured" });
  }

  try {
    const response = await fetch("https://api.telnyx.com/v2/telephony_credentials", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${TELNYX_API_KEY}`,
      },
      body: JSON.stringify({
        connection_id: TELNYX_SIP_CONNECTION_ID,
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
    });

  } catch(e) {
    console.error("Token error:", e.message);
    return res.status(500).json({ error: e.message });
  }
};